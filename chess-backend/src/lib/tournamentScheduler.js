/**
 * Tournament Scheduler — Hourly Auto-Tournaments
 *
 * 3 tier per jam:
 *   Bronze  — Rp 10.000  | 3+2  | max 32 players
 *   Silver  — Rp 25.000  | 5+3  | max 32 players
 *   Gold    — Rp 50.000  | 10+5 | max 16 players
 *
 * Jadwal per jam:
 *   :55 → CREATE 3 tournament (registration window dibuka)
 *   :05 → ACTIVATE: upcoming → active, hitung prize_pool dari registrasi
 *   :00 → FINISH: active hourly → finished, distribusi hadiah
 *
 * Prize split (dari total tiket terkumpul):
 *   80% → juara 1
 *   10% → juara 2
 *   10% → platform fee (tidak dibagikan)
 */

const { supabase, wallets, transactions, notifications } = require('./db');

// ── Tier definitions ─────────────────────────────────────────────────────────
const TIERS = [
  {
    key: 'bronze',
    name: 'Hourly Bronze',
    entry_fee: 10_000,
    time_control: { type: 'blitz', initial: 180, increment: 2, label: '3+2' },
    max_players: 32,
  },
  {
    key: 'silver',
    name: 'Hourly Silver',
    entry_fee: 25_000,
    time_control: { type: 'blitz', initial: 300, increment: 3, label: '5+3' },
    max_players: 32,
  },
  {
    key: 'gold',
    name: 'Hourly Gold',
    entry_fee: 50_000,
    time_control: { type: 'rapid', initial: 600, increment: 5, label: '10+5' },
    max_players: 16,
  },
];

const PRIZE_DISTRIBUTION = { '1': 0.80, '2': 0.10 };
// 10% sisanya adalah platform fee — tidak didistribusikan

// ── Idempotency tracking ──────────────────────────────────────────────────────
// Key: 'YYYY-MM-DDTHH-action' — mencegah double-fire dalam jam yang sama
const done = new Set();

function slotKey(date, action) {
  const d = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const h = date.getHours();
  return `${d}T${h}-${action}`;
}

// ── Step 1: CREATE ────────────────────────────────────────────────────────────
/**
 * Buat 3 tournament untuk slot :05 jam berikutnya.
 * Dipanggil di menit :55 setiap jam.
 */
async function createHourlyTournaments() {
  const now = new Date();
  const startsAt = new Date(now);
  startsAt.setHours(startsAt.getHours() + 1, 5, 0, 0);

  const label = `${String(startsAt.getHours()).padStart(2, '0')}:05`;

  for (const tier of TIERS) {
    const name = `${tier.name} — ${label}`;

    // Idempotent: skip jika sudah ada
    const { data: existing } = await supabase
      .from('tournaments')
      .select('id')
      .eq('name', name)
      .maybeSingle();

    if (existing) {
      console.log(`[Scheduler] Already exists: ${name}`);
      continue;
    }

    const { error } = await supabase.from('tournaments').insert({
      name,
      description: `Tournament otomatis tier ${tier.key}. Tiket: Rp ${tier.entry_fee.toLocaleString('id-ID')} · ${tier.time_control.label} · max ${tier.max_players} pemain.`,
      format: 'swiss',
      time_control: tier.time_control,
      prize_pool: 0,               // Dihitung saat aktivasi
      prize_distribution: PRIZE_DISTRIBUTION,
      entry_fee: tier.entry_fee,
      max_players: tier.max_players,
      min_elo: null,
      max_elo: null,
      status: 'upcoming',
      starts_at: startsAt.toISOString(),
      ends_at: null,               // Ditetapkan saat aktivasi
      created_by: null,
    });

    if (error) {
      console.error(`[Scheduler] Failed to create ${name}:`, error.message);
    } else {
      console.log(`[Scheduler] Created ${name} | starts: ${startsAt.toISOString()}`);
    }
  }
}

// ── Step 2: ACTIVATE ──────────────────────────────────────────────────────────
/**
 * Aktifkan semua hourly tournament yang starts_at <= now dan masih upcoming.
 * Hitung prize_pool dari jumlah registrasi × entry_fee.
 * Dipanggil di menit :05 setiap jam.
 */
async function activateHourlyTournaments() {
  const now = new Date();

  const { data: toActivate, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'upcoming')
    .ilike('name', 'Hourly %')
    .lte('starts_at', now.toISOString());

  if (error) {
    console.error('[Scheduler] activateHourlyTournaments query error:', error.message);
    return;
  }
  if (!toActivate || toActivate.length === 0) return;

  for (const tournament of toActivate) {
    // Hitung jumlah registrasi yang sudah bayar
    const { count } = await supabase
      .from('tournament_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournament.id)
      .eq('paid', true);

    const registeredCount = count || 0;
    const prizePool = registeredCount * (tournament.entry_fee || 0);

    // Tournament berakhir 55 menit setelah mulai
    const endsAt = new Date(tournament.starts_at);
    endsAt.setMinutes(endsAt.getMinutes() + 55);

    const { error: updateErr } = await supabase
      .from('tournaments')
      .update({
        status: 'active',
        prize_pool: prizePool,
        ends_at: endsAt.toISOString(),
      })
      .eq('id', tournament.id);

    if (updateErr) {
      console.error(`[Scheduler] Failed to activate ${tournament.name}:`, updateErr.message);
    } else {
      console.log(
        `[Scheduler] Activated ${tournament.name} | players: ${registeredCount} | pool: Rp ${prizePool.toLocaleString('id-ID')}`
      );
    }
  }
}

// ── Step 3: FINISH ────────────────────────────────────────────────────────────
/**
 * Selesaikan hourly tournament yang ends_at-nya sudah lewat.
 * Distribusi hadiah ke pemain terbaik.
 * Dipanggil di menit :00 setiap jam.
 */
async function finishHourlyTournaments() {
  const now = new Date();

  const { data: toFinish, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('status', 'active')
    .ilike('name', 'Hourly %')
    .lte('ends_at', now.toISOString());

  if (error) {
    console.error('[Scheduler] finishHourlyTournaments query error:', error.message);
    return;
  }
  if (!toFinish || toFinish.length === 0) return;

  for (const tournament of toFinish) {
    await distributePrizesAndFinish(tournament).catch(e =>
      console.error(`[Scheduler] distributePrizesAndFinish failed for ${tournament.name}:`, e.message)
    );
  }
}

async function distributePrizesAndFinish(tournament) {
  // Ambil semua pemain terurut by score desc
  const { data: registrations, error: regErr } = await supabase
    .from('tournament_registrations')
    .select('user_id, score')
    .eq('tournament_id', tournament.id)
    .order('score', { ascending: false });

  if (regErr) throw regErr;

  if (!registrations || registrations.length === 0) {
    // Tournament kosong — langsung finished
    await supabase.from('tournaments').update({
      status: 'finished',
      ends_at: new Date().toISOString(),
    }).eq('id', tournament.id);
    console.log(`[Scheduler] Finished ${tournament.name} (no players)`);
    return;
  }

  const prizePool = tournament.prize_pool || 0;
  const winnerId = registrations[0].user_id;

  // Distribusi hadiah
  if (prizePool > 0) {
    for (const [rank, pct] of Object.entries(PRIZE_DISTRIBUTION)) {
      const idx = parseInt(rank) - 1;
      if (idx >= registrations.length) continue;

      const player = registrations[idx];
      const prize = Math.floor(prizePool * pct);
      if (prize <= 0) continue;

      // Credit wallet
      await wallets.credit(player.user_id, prize);

      // Record transaction
      await transactions.create({
        user_id: player.user_id,
        type: 'tournament_prize',
        amount: prize,
        status: 'completed',
        description: `Prize juara #${rank} — ${tournament.name}`,
        metadata: { tournament_id: tournament.id, rank: parseInt(rank) },
      });

      // Kirim notifikasi
      await notifications.create(
        player.user_id,
        'tournament_prize',
        'Selamat! Kamu menang tournament!',
        `Kamu finish juara #${rank} di "${tournament.name}" dan mendapat Rp ${prize.toLocaleString('id-ID')}!`,
        { tournament_id: tournament.id, rank: parseInt(rank), prize }
      );
    }
  }

  // Update status tournament
  await supabase.from('tournaments').update({
    status: 'finished',
    winner_id: winnerId,
    ends_at: new Date().toISOString(),
  }).eq('id', tournament.id);

  console.log(
    `[Scheduler] Finished ${tournament.name} | winner: ${winnerId} | distributed: Rp ${prizePool.toLocaleString('id-ID')}`
  );
}

// ── Scheduler tick ────────────────────────────────────────────────────────────
async function tick() {
  const now = new Date();
  const min = now.getMinutes();

  // :55 → create tournaments for next hour
  if (min >= 55) {
    const key = slotKey(now, 'create');
    if (!done.has(key)) {
      done.add(key);
      createHourlyTournaments().catch(e =>
        console.error('[Scheduler] createHourlyTournaments error:', e.message)
      );
    }
  }

  // :05–:08 → activate (window lebar agar tidak miss jika server restart)
  if (min >= 5 && min <= 8) {
    const key = slotKey(now, 'activate');
    if (!done.has(key)) {
      done.add(key);
      activateHourlyTournaments().catch(e =>
        console.error('[Scheduler] activateHourlyTournaments error:', e.message)
      );
    }
  }

  // :00–:03 → finish previous hour's tournaments
  if (min >= 0 && min <= 3) {
    const key = slotKey(now, 'finish');
    if (!done.has(key)) {
      done.add(key);
      finishHourlyTournaments().catch(e =>
        console.error('[Scheduler] finishHourlyTournaments error:', e.message)
      );
    }
  }

  // Bersihkan done set jika terlalu besar
  if (done.size > 200) {
    const arr = [...done];
    arr.slice(0, arr.length - 100).forEach(k => done.delete(k));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
function startTournamentScheduler() {
  console.log('[Scheduler] Hourly tournament scheduler started');

  // Run immediately saat server start (tangani missed ticks)
  tick().catch(e => console.error('[Scheduler] Initial tick failed:', e.message));

  // Jalankan setiap 30 detik
  setInterval(() => {
    tick().catch(e => console.error('[Scheduler] Tick failed:', e.message));
  }, 30_000);
}

module.exports = { startTournamentScheduler, TIERS };

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
 *   :05 → ACTIVATE: upcoming → active, hitung prize_pool, buat Round 1
 *   :00 → FINISH: active hourly → finished, distribusi hadiah
 *
 * Auto-progression (setiap 2 menit):
 *   Cek apakah semua pairing di round saat ini sudah ada hasil.
 *   Jika ya → buat round berikutnya (atau finish jika sudah 5 round).
 *
 * Prize split (dari total tiket terkumpul):
 *    4% → platform fee
 *   96% net pool:
 *     50% → juara 1
 *     30% → juara 2
 *     20% → juara 3
 */

const { supabase, games, users, wallets, transactions, notifications } = require('./db');

// ── Tier definitions ─────────────────────────────────────────────────────────
const TIERS = [
  {
    key: 'bronze',
    name: 'Hourly Bronze',
    entry_fee: 10_000,
    time_control: { type: 'blitz', initial: 180, increment: 2, label: '3+2' },
    max_players: 32,
    max_rounds: 5,
  },
  {
    key: 'silver',
    name: 'Hourly Silver',
    entry_fee: 25_000,
    time_control: { type: 'blitz', initial: 300, increment: 3, label: '5+3' },
    max_players: 32,
    max_rounds: 5,
  },
  {
    key: 'gold',
    name: 'Hourly Gold',
    entry_fee: 50_000,
    time_control: { type: 'rapid', initial: 600, increment: 5, label: '10+5' },
    max_players: 16,
    max_rounds: 4,
  },
];

const PLATFORM_FEE_PCT   = 0.04; // 4% platform fee
const PRIZE_DISTRIBUTION = { '1': 0.50, '2': 0.30, '3': 0.20 }; // dari net pool (setelah fee)

// ── Module-level io reference (set by startTournamentScheduler) ───────────────
let _io = null;

// ── Idempotency tracking ──────────────────────────────────────────────────────
// Key: 'YYYY-MM-DDTHH-action' — mencegah double-fire dalam jam yang sama
const done = new Set();

function slotKey(date, action) {
  const d = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const h = date.getHours();
  return `${d}T${h}-${action}`;
}

// ── Socket emitters ───────────────────────────────────────────────────────────

function emitTournamentEvent(tournamentId, event, payload) {
  if (!_io) return;
  _io.to(`tournament:${tournamentId}`).emit(event, payload);
  // Also emit to global room for lobby/tournament list updates
  _io.emit(`tournament:update`, { tournamentId, event, ...payload });
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

    const { data: created, error } = await supabase.from('tournaments').insert({
      name,
      description: `Tournament otomatis tier ${tier.key}. Tiket: Rp ${tier.entry_fee.toLocaleString('id-ID')} · ${tier.time_control.label} · max ${tier.max_players} pemain.`,
      format: 'swiss',
      time_control: tier.time_control,
      prize_pool: 0,               // Dihitung saat aktivasi
      prize_distribution: PRIZE_DISTRIBUTION, // 50/30/20 dari net pool (setelah 4% fee)
      entry_fee: tier.entry_fee,
      max_players: tier.max_players,
      min_elo: null,
      max_elo: null,
      status: 'upcoming',
      starts_at: startsAt.toISOString(),
      ends_at: null,               // Ditetapkan saat aktivasi
      created_by: null,
    }).select().single();

    if (error) {
      console.error(`[Scheduler] Failed to create ${name}:`, error.message);
    } else {
      console.log(`[Scheduler] Created ${name} | starts: ${startsAt.toISOString()}`);
      // Emit to all connected clients so tournament list updates
      if (_io) _io.emit('tournament:created', { tournament: created });
    }
  }
}

// ── Step 2: ACTIVATE ──────────────────────────────────────────────────────────
/**
 * Aktifkan semua hourly tournament yang starts_at <= now dan masih upcoming.
 * Hitung prize_pool dari jumlah registrasi × entry_fee.
 * Generate Round 1 pairings + game records.
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
        current_round: 0,
      })
      .eq('id', tournament.id);

    if (updateErr) {
      console.error(`[Scheduler] Failed to activate ${tournament.name}:`, updateErr.message);
      continue;
    }

    console.log(
      `[Scheduler] Activated ${tournament.name} | players: ${registeredCount} | pool: Rp ${prizePool.toLocaleString('id-ID')}`
    );

    // Emit activation event
    emitTournamentEvent(tournament.id, 'tournament:started', {
      tournamentId: tournament.id,
      name: tournament.name,
      prizePool,
      playerCount: registeredCount,
    });

    // Notify all registered players
    const { data: registrations } = await supabase
      .from('tournament_registrations')
      .select('user_id')
      .eq('tournament_id', tournament.id);

    if (registrations && registrations.length > 0) {
      for (const reg of registrations) {
        await notifications.create(
          reg.user_id,
          'tournament_started',
          'Turnamen Dimulai!',
          `"${tournament.name}" telah dimulai! Siapkan dirimu untuk ronde pertama.`,
          { tournament_id: tournament.id }
        ).catch(() => {});
      }
    }

    // Generate Round 1 if there are enough players
    if (registeredCount >= 2) {
      await generateRound(tournament.id, 1, tournament.time_control).catch(e =>
        console.error(`[Scheduler] generateRound(1) failed for ${tournament.name}:`, e.message)
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
    emitTournamentEvent(tournament.id, 'tournament:finished', {
      tournamentId: tournament.id,
      name: tournament.name,
      standings: [],
    });
    return;
  }

  const grossPool = tournament.prize_pool || 0;
  const winnerId  = registrations[0].user_id;

  // Distribusi hadiah (potong 4% platform fee dulu)
  if (grossPool > 0) {
    const platformFee = Math.floor(grossPool * PLATFORM_FEE_PCT);
    const netPool     = grossPool - platformFee;

    // Catat platform fee
    if (platformFee > 0) {
      await transactions.create({
        user_id: null,
        type: 'platform_fee',
        amount: platformFee,
        status: 'completed',
        description: `Platform fee 4% — ${tournament.name}`,
        metadata: { tournament_id: tournament.id, gross_pool: grossPool },
      }).catch(() => {}); // non-fatal jika user_id null tidak diizinkan
    }

    for (const [rank, pct] of Object.entries(PRIZE_DISTRIBUTION)) {
      const idx = parseInt(rank) - 1;
      if (idx >= registrations.length) continue;

      const player = registrations[idx];
      const prize  = Math.floor(netPool * pct);
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

  // Build standings for socket event
  const standings = registrations.slice(0, 10).map((reg, idx) => ({
    rank: idx + 1,
    userId: reg.user_id,
    score: reg.score,
  }));

  emitTournamentEvent(tournament.id, 'tournament:finished', {
    tournamentId: tournament.id,
    name: tournament.name,
    winnerId,
    prizePool,
    standings,
  });
}

// ── Step 4: AUTO ROUND PROGRESSION ───────────────────────────────────────────
/**
 * Cek semua active tournament — jika semua pairing di round saat ini
 * sudah punya hasil, buat round berikutnya atau akhiri tournament.
 * Dipanggil setiap 2 menit.
 */
async function checkRoundProgression() {
  const { data: activeTournaments, error } = await supabase
    .from('tournaments')
    .select('id, name, current_round, time_control, ends_at, entry_fee, prize_pool')
    .eq('status', 'active');

  if (error || !activeTournaments || activeTournaments.length === 0) return;

  for (const tournament of activeTournaments) {
    try {
      await checkAndAdvanceRound(tournament);
    } catch (e) {
      console.error(`[Scheduler] checkAndAdvanceRound failed for ${tournament.name}:`, e.message);
    }
  }
}

async function checkAndAdvanceRound(tournament) {
  const currentRound = tournament.current_round || 0;
  if (currentRound === 0) return; // No rounds started yet

  // Check if all pairings for current round have a result
  const { data: pairings } = await supabase
    .from('tournament_pairings')
    .select('id, result')
    .eq('tournament_id', tournament.id)
    .eq('round', currentRound);

  if (!pairings || pairings.length === 0) return;

  const allDone = pairings.every(p => p.result !== null && p.result !== undefined && p.result !== '');
  if (!allDone) return;

  // All pairings done — determine if we continue or finish
  // Get player count to determine max rounds (Swiss: ceil(log2(n)) rounds)
  const { count: playerCount } = await supabase
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournament.id);

  const maxRounds = playerCount <= 4 ? 3
    : playerCount <= 8  ? 4
    : playerCount <= 16 ? 5
    : 6;

  if (currentRound >= maxRounds) {
    // Tournament complete — finish it
    const { data: fullTournament } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', tournament.id)
      .single();

    if (fullTournament) {
      await distributePrizesAndFinish(fullTournament);
    }
  } else {
    // Advance to next round
    await generateRound(tournament.id, currentRound + 1, tournament.time_control);
  }
}

// ── Round generator ────────────────────────────────────────────────────────────
/**
 * Generate Swiss pairings for the given round, create game records,
 * and emit socket event to notify players.
 */
async function generateRound(tournamentId, round, timeControl) {
  // Fetch players ordered by score
  const { data: registrations, error: regErr } = await supabase
    .from('tournament_registrations')
    .select('user_id, score')
    .eq('tournament_id', tournamentId)
    .order('score', { ascending: false });

  if (regErr) throw regErr;
  if (!registrations || registrations.length < 2) {
    console.log(`[Scheduler] Not enough players for round ${round} in tournament ${tournamentId}`);
    return;
  }

  const players = [...registrations];
  const pairingsToInsert = [];
  let boardNumber = 1;

  for (let i = 0; i + 1 < players.length; i += 2) {
    const [p1, p2] = [players[i], players[i + 1]];
    const whiteId = boardNumber % 2 === 1 ? p1.user_id : p2.user_id;
    const blackId = boardNumber % 2 === 1 ? p2.user_id : p1.user_id;
    pairingsToInsert.push({
      tournament_id: tournamentId,
      round,
      board_number: boardNumber++,
      white_id: whiteId,
      black_id: blackId,
      result: null,
    });
  }

  // Bye player (odd count)
  let byeUserId = null;
  if (players.length % 2 === 1) {
    byeUserId = players[players.length - 1].user_id;
    await supabase
      .from('tournament_registrations')
      .update({ score: (players[players.length - 1].score || 0) + 1 })
      .eq('tournament_id', tournamentId)
      .eq('user_id', byeUserId);
  }

  // Insert pairings
  const { data: insertedPairings, error: pairErr } = await supabase
    .from('tournament_pairings')
    .insert(pairingsToInsert)
    .select();

  if (pairErr) throw pairErr;

  // Create game records for each pairing
  const gamesByPairing = [];
  for (const pairing of (insertedPairings || [])) {
    try {
      const whiteUser = await users.findById(pairing.white_id);
      const blackUser = await users.findById(pairing.black_id);
      if (!whiteUser || !blackUser) continue;

      const tc = timeControl || { type: 'blitz', initial: 180, increment: 2 };
      const game = await games.create({
        white_id: pairing.white_id,
        black_id: pairing.black_id,
        time_control: tc,
        stakes: 0,
        white_elo_before: whiteUser.elo,
        black_elo_before: blackUser.elo,
        white_time_left: tc.initial,
        black_time_left: tc.initial,
      });

      // Link game to pairing (if game_id column exists)
      await supabase
        .from('tournament_pairings')
        .update({ game_id: game.id })
        .eq('id', pairing.id)
        .then(() => {})
        .catch(() => {}); // Silently ignore if column doesn't exist

      // Link game to tournament via tournament_games table
      await supabase.from('tournament_games').insert({
        tournament_id: tournamentId,
        game_id: game.id,
        round,
        board: pairing.board_number,
      }).then(() => {}).catch(() => {});

      gamesByPairing.push({ pairingId: pairing.id, gameId: game.id, whiteId: pairing.white_id, blackId: pairing.black_id });

      // Notify each player about their game
      await notifications.create(
        pairing.white_id,
        'tournament_round',
        `Ronde ${round} Dimulai`,
        `Ronde ${round} telah dimulai. Kamu bermain sebagai Putih melawan ${blackUser.username}.`,
        { tournament_id: tournamentId, game_id: game.id, round }
      ).catch(() => {});

      await notifications.create(
        pairing.black_id,
        'tournament_round',
        `Ronde ${round} Dimulai`,
        `Ronde ${round} telah dimulai. Kamu bermain sebagai Hitam melawan ${whiteUser.username}.`,
        { tournament_id: tournamentId, game_id: game.id, round }
      ).catch(() => {});

      // Notify players directly via socket
      if (_io) {
        _io.to(pairing.white_id).emit('tournament:game_ready', {
          tournamentId, round, gameId: game.id, color: 'white', opponentId: pairing.black_id,
        });
        _io.to(pairing.black_id).emit('tournament:game_ready', {
          tournamentId, round, gameId: game.id, color: 'black', opponentId: pairing.white_id,
        });
      }
    } catch (e) {
      console.error(`[Scheduler] Failed to create game for pairing ${pairing.id}:`, e.message);
    }
  }

  // Update tournament's current_round
  await supabase
    .from('tournaments')
    .update({ current_round: round })
    .eq('id', tournamentId);

  console.log(`[Scheduler] Round ${round} generated for tournament ${tournamentId} | ${pairingsToInsert.length} boards | bye: ${byeUserId || 'none'}`);

  // Emit round start event
  emitTournamentEvent(tournamentId, 'tournament:round_start', {
    tournamentId,
    round,
    pairings: gamesByPairing,
    byeUserId,
  });
}

// ── Scheduler tick ────────────────────────────────────────────────────────────
let progressionTick = 0;

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

  // Every 4 ticks (2 min) → check round progression
  progressionTick++;
  if (progressionTick >= 4) {
    progressionTick = 0;
    checkRoundProgression().catch(e =>
      console.error('[Scheduler] checkRoundProgression error:', e.message)
    );
  }

  // Bersihkan done set jika terlalu besar
  if (done.size > 200) {
    const arr = [...done];
    arr.slice(0, arr.length - 100).forEach(k => done.delete(k));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
function startTournamentScheduler(io) {
  _io = io || null;
  console.log('[Scheduler] Hourly tournament scheduler started');

  // Run immediately saat server start (tangani missed ticks)
  tick().catch(e => console.error('[Scheduler] Initial tick failed:', e.message));

  // Jalankan setiap 30 detik
  setInterval(() => {
    tick().catch(e => console.error('[Scheduler] Tick failed:', e.message));
  }, 30_000);
}

module.exports = { startTournamentScheduler, generateRound, TIERS };

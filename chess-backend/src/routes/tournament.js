const express = require('express');
const router = express.Router();
const { supabase, wallets, transactions, notifications } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');

// ── GET /api/tournament ───────────────────────────────────────────────────────
// List tournaments, optionally filtered by status: upcoming | active | finished
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const validStatuses = ['upcoming', 'active', 'finished'];

    let query = supabase
      .from('tournaments')
      .select(`
        id, name, description, format, time_control,
        prize_pool, prize_distribution, entry_fee,
        max_players, min_elo, max_elo, status,
        starts_at, ends_at, winner_id, created_by, created_at
      `)
      .order('starts_at', { ascending: true });

    if (status) {
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status filter. Use: upcoming, active, finished' });
      }
      query = query.eq('status', status);
    }

    const { data: tournaments, error } = await query;
    if (error) throw error;

    res.json({ tournaments: tournaments || [] });
  } catch (err) {
    console.error('[tournament/list]', err);
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
});

// ── GET /api/tournament/:id ───────────────────────────────────────────────────
// Get a single tournament with registration count
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: tournament, error } = await supabase
      .from('tournaments')
      .select(`
        id, name, description, format, time_control,
        prize_pool, prize_distribution, entry_fee,
        max_players, min_elo, max_elo, status,
        starts_at, ends_at, winner_id, created_by, created_at
      `)
      .eq('id', id)
      .single();

    if (error || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const { count, error: countError } = await supabase
      .from('tournament_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', id);

    if (countError) throw countError;

    res.json({ tournament: { ...tournament, registrations_count: count ?? 0 } });
  } catch (err) {
    console.error('[tournament/get]', err);
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
});

// ── POST /api/tournament/:id/register ────────────────────────────────────────
// Register the authenticated user for a tournament, debiting the entry fee
router.post('/:id/register', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const user = req.user;

    // Fetch tournament
    const { data: tournament, error: tErr } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .single();

    if (tErr || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournament.status !== 'upcoming') {
      return res.status(400).json({ error: 'Registration is only open for upcoming tournaments' });
    }

    // ELO eligibility checks
    if (tournament.min_elo !== null && user.elo < tournament.min_elo) {
      return res.status(403).json({ error: `Your ELO (${user.elo}) is below the minimum required (${tournament.min_elo})` });
    }
    if (tournament.max_elo !== null && user.elo > tournament.max_elo) {
      return res.status(403).json({ error: `Your ELO (${user.elo}) exceeds the maximum allowed (${tournament.max_elo})` });
    }

    // Check for existing registration
    const { data: existing } = await supabase
      .from('tournament_registrations')
      .select('id')
      .eq('tournament_id', id)
      .eq('user_id', userId)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'You are already registered for this tournament' });
    }

    // Check player cap
    const { count: currentCount } = await supabase
      .from('tournament_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', id);

    if (tournament.max_players !== null && currentCount >= tournament.max_players) {
      return res.status(409).json({ error: 'Tournament is full' });
    }

    // Debit entry fee if applicable
    let paid = false;
    if (tournament.entry_fee && tournament.entry_fee > 0) {
      await wallets.debit(userId, tournament.entry_fee);

      await transactions.create({
        user_id: userId,
        type: 'tournament_entry',
        amount: -tournament.entry_fee,
        status: 'completed',
        description: `Entry fee for tournament: ${tournament.name}`,
        metadata: { tournament_id: id },
      });

      paid = true;
    }

    // Create registration record
    const { data: registration, error: regErr } = await supabase
      .from('tournament_registrations')
      .insert({
        tournament_id: id,
        user_id: userId,
        paid,
        score: 0,
      })
      .select()
      .single();

    if (regErr) throw regErr;

    // Notify the user
    await notifications.create(
      userId,
      'tournament_registered',
      'Tournament Registration',
      `You have successfully registered for "${tournament.name}".`,
      { tournament_id: id }
    );

    res.status(201).json({ message: 'Registration successful', registration });
  } catch (err) {
    console.error('[tournament/register]', err);
    // Surface wallet-related errors clearly
    if (err.message && err.message.toLowerCase().includes('insufficient')) {
      return res.status(402).json({ error: 'Insufficient wallet balance to pay entry fee' });
    }
    res.status(500).json({ error: 'Failed to register for tournament' });
  }
});

// ── GET /api/tournament/:id/players ──────────────────────────────────────────
// List registered players with their scores, ordered by score descending
router.get('/:id/players', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify tournament exists
    const { data: tournament, error: tErr } = await supabase
      .from('tournaments')
      .select('id')
      .eq('id', id)
      .single();

    if (tErr || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const { data: players, error } = await supabase
      .from('tournament_registrations')
      .select(`
        id, tournament_id, user_id, paid, score, registered_at,
        user:user_id (id, username, elo, avatar_url, title, country)
      `)
      .eq('tournament_id', id)
      .order('score', { ascending: false });

    if (error) throw error;

    res.json({ players: players || [] });
  } catch (err) {
    console.error('[tournament/players]', err);
    res.status(500).json({ error: 'Failed to fetch tournament players' });
  }
});

// ── POST /api/tournament ──────────────────────────────────────────────────────
// Create a tournament (requireAuth, admin placeholder: elo > 2000)
router.post('/', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    // Placeholder admin check: user must have ELO > 2000
    if (user.elo <= 2000) {
      return res.status(403).json({ error: 'Only administrators can create tournaments (ELO > 2000 required)' });
    }

    const {
      name,
      description,
      format,
      time_control,
      prize_pool,
      prize_distribution,
      entry_fee,
      max_players,
      min_elo,
      max_elo,
      starts_at,
      ends_at,
    } = req.body;

    // Basic validation
    if (!name || !format || !time_control || !starts_at) {
      return res.status(400).json({ error: 'name, format, time_control, and starts_at are required' });
    }

    if (starts_at && ends_at && new Date(ends_at) <= new Date(starts_at)) {
      return res.status(400).json({ error: 'ends_at must be after starts_at' });
    }

    const { data: tournament, error } = await supabase
      .from('tournaments')
      .insert({
        name,
        description: description || null,
        format,
        time_control,
        prize_pool: prize_pool ?? 0,
        prize_distribution: prize_distribution ?? null,
        entry_fee: entry_fee ?? 0,
        max_players: max_players ?? null,
        min_elo: min_elo ?? null,
        max_elo: max_elo ?? null,
        status: 'upcoming',
        starts_at,
        ends_at: ends_at ?? null,
        created_by: req.userId,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ message: 'Tournament created', tournament });
  } catch (err) {
    console.error('[tournament/create]', err);
    res.status(500).json({ error: 'Failed to create tournament' });
  }
});

// ── POST /api/tournament/:id/finish ──────────────────────────────────────────
// Admin endpoint: finish tournament, calculate standings, distribute prizes
router.post('/:id/finish', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Only admin (elo > 2000) can finish tournaments
    if (user.elo <= 2000) {
      return res.status(403).json({ error: 'Only administrators can finish tournaments' });
    }

    const { data: tournament, error: tErr } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .single();

    if (tErr || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournament.status !== 'active') {
      return res.status(400).json({ error: 'Tournament must be active to finish' });
    }

    // Get all registrations ordered by score descending
    const { data: registrations, error: regErr } = await supabase
      .from('tournament_registrations')
      .select(`
        id, user_id, score, paid,
        user:user_id (id, username, elo)
      `)
      .eq('tournament_id', id)
      .order('score', { ascending: false });

    if (regErr) throw regErr;
    if (!registrations || registrations.length === 0) {
      return res.status(400).json({ error: 'No registered players' });
    }

    // ── Prize Distribution ────────────────────────────────────────────────
    const prizes = [];
    const prizePool = tournament.prize_pool || 0;

    if (prizePool > 0) {
      // Default distribution if none specified: 50/30/20 for top 3
      const dist = tournament.prize_distribution || {
        '1': 0.5,
        '2': 0.3,
        '3': 0.2,
      };

      for (const [rank, pct] of Object.entries(dist)) {
        const idx = parseInt(rank) - 1;
        if (idx < registrations.length) {
          const player = registrations[idx];
          const prize = Math.floor(prizePool * pct);

          if (prize > 0) {
            await wallets.credit(player.user_id, prize);
            await transactions.create({
              user_id: player.user_id,
              type: 'tournament_prize',
              amount: prize,
              status: 'completed',
              description: `Tournament prize — #${rank} in "${tournament.name}"`,
              metadata: { tournament_id: id, rank: parseInt(rank) },
            });

            await notifications.create(
              player.user_id,
              'tournament_prize',
              'Tournament Prize',
              `You finished #${rank} in "${tournament.name}" and won Rp ${prize.toLocaleString('id-ID')}!`,
              { tournament_id: id, rank: parseInt(rank), prize }
            );

            prizes.push({ rank: parseInt(rank), userId: player.user_id, prize });
          }
        }
      }
    }

    // Determine winner (rank 1)
    const winnerId = registrations[0]?.user_id || null;

    // Mark tournament as finished
    await supabase.from('tournaments').update({
      status: 'finished',
      winner_id: winnerId,
      ends_at: new Date(),
    }).eq('id', id);

    // Build final standings
    const standings = registrations.map((reg, idx) => ({
      rank: idx + 1,
      userId: reg.user_id,
      username: reg.user?.username,
      elo: reg.user?.elo,
      score: reg.score,
      prize: prizes.find(p => p.userId === reg.user_id)?.prize || 0,
    }));

    res.json({
      message: 'Tournament finished successfully',
      winnerId,
      prizePool,
      prizesDistributed: prizes,
      standings,
    });
  } catch (err) {
    console.error('[tournament/finish]', err);
    if (err.message && err.message.toLowerCase().includes('insufficient')) {
      return res.status(402).json({ error: 'Insufficient prize pool funds' });
    }
    res.status(500).json({ error: 'Failed to finish tournament' });
  }
});

// ── PATCH /api/tournament/:id/score ──────────────────────────────────────────
// Update a player's score in a tournament (admin only, for manual Swiss round management)
router.patch('/:id/score', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, score } = req.body;
    const user = req.user;

    if (user.elo <= 2000) {
      return res.status(403).json({ error: 'Only administrators can update scores' });
    }

    if (typeof score !== 'number' || score < 0) {
      return res.status(400).json({ error: 'Invalid score' });
    }

    const { data, error } = await supabase
      .from('tournament_registrations')
      .update({ score })
      .eq('tournament_id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Registration not found' });

    res.json({ message: 'Score updated', registration: data });
  } catch (err) {
    console.error('[tournament/score]', err);
    res.status(500).json({ error: 'Failed to update score' });
  }
});

// ── GET /api/tournament/:id/standings ────────────────────────────────────────
// Get current standings with tiebreaking (Swiss: score → wins → opponent score)
router.get('/:id/standings', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: tournament, error: tErr } = await supabase
      .from('tournaments')
      .select('id, name, format, status, prize_pool, prize_distribution')
      .eq('id', id)
      .single();

    if (tErr || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const { data: registrations, error } = await supabase
      .from('tournament_registrations')
      .select(`
        id, user_id, score, registered_at,
        user:user_id (id, username, elo, avatar_url, title, country)
      `)
      .eq('tournament_id', id)
      .order('score', { ascending: false });

    if (error) throw error;

    // Calculate projected prize for each player
    const prizePool = tournament.prize_pool || 0;
    const dist = tournament.prize_distribution || { '1': 0.5, '2': 0.3, '3': 0.2 };

    const standings = (registrations || []).map((reg, idx) => {
      const rank = idx + 1;
      const pct = dist[String(rank)] || 0;
      const projectedPrize = prizePool > 0 ? Math.floor(prizePool * pct) : 0;

      return {
        rank,
        userId: reg.user_id,
        user: reg.user,
        score: reg.score || 0,
        projectedPrize,
      };
    });

    res.json({ standings, tournament });
  } catch (err) {
    console.error('[tournament/standings]', err);
    res.status(500).json({ error: 'Failed to fetch standings' });
  }
});

module.exports = router;


const express = require('express');
const router = express.Router();
const { users } = require('../lib/db');

const VALID_TC = ['global', 'bullet', 'blitz', 'rapid'];

/**
 * GET /api/leaderboard
 * Query params:
 *   limit      - max rows (default 50, max 100)
 *   timeControl - 'global' | 'bullet' | 'blitz' | 'rapid' (default 'global')
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const tc = VALID_TC.includes(req.query.timeControl) ? req.query.timeControl : 'global';

    const data = await users.getLeaderboard(limit, tc);

    const eloField = tc === 'global' ? 'elo' : `elo_${tc}`;

    const leaderboard = data
      .filter(u => (u[eloField] ?? u.elo) > 0)
      .sort((a, b) => (b[eloField] ?? b.elo) - (a[eloField] ?? a.elo))
      .map((u, i) => ({
        rank: i + 1,
        id: u.id,
        username: u.username,
        avatar_url: u.avatar_url,
        elo: u.elo,
        elo_bullet: u.elo_bullet,
        elo_blitz: u.elo_blitz,
        elo_rapid: u.elo_rapid,
        displayElo: u[eloField] ?? u.elo,
        title: u.title,
        country: u.country || 'ID',
        wins: u.wins,
        losses: u.losses,
        draws: u.draws,
        games_played: u.games_played,
        winRate: u.games_played > 0 ? Math.round((u.wins / u.games_played) * 100) : 0,
      }));

    res.json({ leaderboard, timeControl: tc });
  } catch (err) {
    console.error('[leaderboard]', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;

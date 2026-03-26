const express = require('express');
const router = express.Router();
const { games, eloHistory } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');

// ── PGN generator ─────────────────────────────────────────────────────────────
function buildPGN(game, whiteUsername, blackUsername) {
  const date = game.started_at
    ? new Date(game.started_at).toISOString().slice(0, 10).replace(/-/g, '.')
    : '????.??.??';

  const tc = game.time_control;
  const tcStr = tc ? `${tc.initial}+${tc.increment || 0}` : '-';

  const result = game.winner === 'white' ? '1-0'
    : game.winner === 'black' ? '0-1'
    : game.winner === 'draw'  ? '1/2-1/2'
    : '*';

  // Build PGN headers
  const headers = [
    `[Event "Chess Arena Rated Game"]`,
    `[Site "Chess Arena"]`,
    `[Date "${date}"]`,
    `[Round "-"]`,
    `[White "${whiteUsername || 'Unknown'}"]`,
    `[Black "${blackUsername || 'Unknown'}"]`,
    `[Result "${result}"]`,
    `[TimeControl "${tcStr}"]`,
    `[Termination "${game.end_reason || 'Normal'}"]`,
  ].join('\n');

  // Use stored PGN if available, otherwise reconstruct from move_history
  let movesStr = game.pgn || '';
  if (!movesStr && Array.isArray(game.move_history) && game.move_history.length > 0) {
    const pairs = [];
    for (let i = 0; i < game.move_history.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const white = game.move_history[i]?.san || '';
      const black = game.move_history[i + 1]?.san || '';
      pairs.push(`${moveNum}. ${white}${black ? ' ' + black : ''}`);
    }
    movesStr = pairs.join(' ') + ' ' + result;
  }

  return `${headers}\n\n${movesStr}\n`;
}

// ── GET /api/game/:gameId ────────────────────────────────────────────────────
router.get('/:gameId', requireAuth, async (req, res) => {
  try {
    const game = await games.findById(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    if (game.white_id !== req.userId && game.black_id !== req.userId) {
      return res.status(403).json({ error: 'Not a player in this game' });
    }
    res.json({ game });
  } catch (err) {
    console.error('[game/get]', err);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

// ── GET /api/game/history/me ─────────────────────────────────────────────────
router.get('/history/me', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const history = await games.getHistory(req.userId, limit);
    res.json({ history });
  } catch (err) {
    console.error('[game/history/me]', err);
    res.status(500).json({ error: 'Failed to fetch game history' });
  }
});

// ── GET /api/game/history/:userId ────────────────────────────────────────────
router.get('/history/:userId', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const history = await games.getHistory(req.params.userId, limit);
    res.json({ history });
  } catch (err) {
    console.error('[game/history/:userId]', err);
    res.status(500).json({ error: 'Failed to fetch game history' });
  }
});

// ── GET /api/game/elo-history/me ─────────────────────────────────────────────
router.get('/elo-history/me', requireAuth, async (req, res) => {
  try {
    const history = await eloHistory.getForUser(req.userId, 30);
    res.json({ history });
  } catch (err) {
    console.error('[game/elo-history]', err);
    res.status(500).json({ error: 'Failed to fetch ELO history' });
  }
});

// ── GET /api/game/:gameId/pgn ─────────────────────────────────────────────────
// Returns PGN file for download. Both players can download their own games.
router.get('/:gameId/pgn', requireAuth, async (req, res) => {
  try {
    const game = await games.findById(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    // Allow both players to download PGN
    if (game.white_id !== req.userId && game.black_id !== req.userId) {
      return res.status(403).json({ error: 'Not a player in this game' });
    }

    if (game.status === 'active') {
      return res.status(400).json({ error: 'Game is still in progress' });
    }

    const pgn = buildPGN(
      game,
      game.white?.username || game.white_id,
      game.black?.username || game.black_id,
    );

    const filename = `chess-arena-${req.params.gameId.slice(0, 8)}.pgn`;
    res.setHeader('Content-Type', 'application/x-chess-pgn');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pgn);
  } catch (err) {
    console.error('[game/pgn]', err);
    res.status(500).json({ error: 'Failed to generate PGN' });
  }
});

// ── GET /api/game/:gameId/replay ──────────────────────────────────────────────
// Returns game data formatted for the replay viewer (public endpoint for finished games)
router.get('/:gameId/replay', async (req, res) => {
  try {
    const game = await games.findById(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.status === 'active') return res.status(400).json({ error: 'Game still in progress' });

    res.json({
      gameId: game.id,
      white: game.white_id,
      black: game.black_id,
      moves: game.move_history || [],
      pgn: buildPGN(game, null, null),
      result: game.winner,
      endReason: game.end_reason,
      timeControl: game.time_control,
      startedAt: game.started_at,
      endedAt: game.ended_at,
      whiteEloBefore: game.white_elo_before,
      blackEloBefore: game.black_elo_before,
      whiteEloAfter: game.white_elo_after,
      blackEloAfter: game.black_elo_after,
    });
  } catch (err) {
    console.error('[game/replay]', err);
    res.status(500).json({ error: 'Failed to fetch game replay' });
  }
});

module.exports = router;

/**
 * Spectator mode — real-time game watching
 *
 * Socket events:
 *   Client → Server:
 *     game:spectate  { gameId }  — join as spectator
 *     game:unspectate{ gameId }  — leave spectator room
 *
 *   Server → Client (spectator):
 *     spectate:state { gameId, fen, moveHistory, whiteTimeLeft, blackTimeLeft, status, white, black }
 *     game:move      { move, fen, whiteTimeLeft, blackTimeLeft }  (same event as players)
 *     game:over      { gameId, winner, endReason, ... }           (same event as players)
 *     spectator:count{ gameId, count }
 *
 * Privacy:
 *   - Spectators see the FEN and moves but NOT the move nonce tokens
 *   - Spectators cannot send game events
 *   - Spectator sockets do NOT receive wallet:update or other private events
 */

const { games } = require('../lib/db');
const { gameCache } = require('./gameRoom');

// Map<gameId, Set<socketId>> — track spectators per game
const spectators = new Map();

function getSpectatorCount(gameId) {
  return spectators.get(gameId)?.size || 0;
}

function registerSpectator(io, socket) {
  // ── Join as spectator ──────────────────────────────────────────────────
  socket.on('game:spectate', async ({ gameId }) => {
    try {
      if (!gameId) return socket.emit('error', { message: 'gameId required' });

      // Load game state (in-memory first, then DB)
      let game = gameCache.get(gameId);
      if (!game) {
        const dbGame = await games.findById(gameId);
        if (!dbGame) return socket.emit('error', { message: 'Game not found' });
        // Don't add to gameCache for spectators — just serve state
        game = {
          id: dbGame.id,
          fen: dbGame.fen,
          moveHistory: dbGame.move_history || [],
          whiteTimeLeft: dbGame.white_time_left,
          blackTimeLeft: dbGame.black_time_left,
          status: dbGame.status,
          whiteId: dbGame.white_id,
          blackId: dbGame.black_id,
          timeControl: dbGame.time_control,
          stakes: dbGame.stakes,
        };
      }

      // Join spectator room (separate from game room to isolate events)
      const spectateRoom = `spectate:${gameId}`;
      socket.join(spectateRoom);

      // Track this spectator
      if (!spectators.has(gameId)) spectators.set(gameId, new Set());
      spectators.get(gameId).add(socket.id);

      const count = getSpectatorCount(gameId);

      // Send current game state to the new spectator
      socket.emit('spectate:state', {
        gameId,
        fen: game.fen,
        moveHistory: game.moveHistory,
        whiteTimeLeft: game.whiteTimeLeft,
        blackTimeLeft: game.blackTimeLeft,
        status: game.status,
        timeControl: game.timeControl,
        spectatorCount: count,
      });

      // Broadcast updated spectator count to everyone in the spectate room
      io.to(spectateRoom).emit('spectator:count', { gameId, count });

      console.log(`[Spectator] ${socket.id} joined game ${gameId} (${count} spectators)`);
    } catch (err) {
      console.error('[spectator/join]', err);
      socket.emit('error', { message: 'Failed to join as spectator' });
    }
  });

  // ── Leave spectator room ───────────────────────────────────────────────
  socket.on('game:unspectate', ({ gameId }) => {
    removeSpectator(io, socket, gameId);
  });

  // ── Cleanup on disconnect ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    // Remove from all spectate rooms this socket was in
    for (const [gameId, socketSet] of spectators.entries()) {
      if (socketSet.has(socket.id)) {
        removeSpectator(io, socket, gameId);
      }
    }
  });
}

function removeSpectator(io, socket, gameId) {
  const spectateRoom = `spectate:${gameId}`;
  socket.leave(spectateRoom);

  const set = spectators.get(gameId);
  if (set) {
    set.delete(socket.id);
    if (set.size === 0) spectators.delete(gameId);
  }

  const count = getSpectatorCount(gameId);
  io.to(spectateRoom).emit('spectator:count', { gameId, count });
  console.log(`[Spectator] ${socket.id} left game ${gameId} (${count} spectators)`);
}

module.exports = { registerSpectator, getSpectatorCount };

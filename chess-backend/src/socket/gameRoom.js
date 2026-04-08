'use strict';
/**
 * Game room socket handlers — Server-Authoritative Chess Engine
 *
 * Security layers implemented:
 *  [1] Move rate limiting        — max 1 move per 500ms per user (Redis-backed)
 *  [2] Anti multi-tab            — hanya 1 socket aktif per user per game
 *  [3] Move nonce/token          — anti-replay: server issuer token per move (Redis-backed)
 *  [4] Move sequence counter     — nomor urut untuk forensics & audit trail
 *  [5] Full audit trail          — setiap move dicatat ke move_audit_log
 *  [6] Real-time anticheat       — analisis setiap 10 move selama game
 *  [7] Post-game enforcement     — trust score penalty + flag/suspend otomatis
 *  [8] ELO anomaly detection     — deteksi lonjakan ELO mencurigakan (async)
 *  [9] Stockfish background      — engine comparison setelah game (async)
 * [10] Turn validation           — server cek giliran, bukan trust client
 * [11] Server-authoritative FEN  — client tidak bisa manipulasi board state
 *
 * Scaling: all mutable state backed by Redis. Local Maps are write-through caches.
 */

const crypto     = require('crypto');
const os         = require('os');
const { Chess }  = require('chess.js');
const { getTimeControlType: _getTimeControlType } = require('../lib/timeControl'); // M5: shared

// ── Cache layer (Redis-backed, replaces in-memory Maps) ──────────────────────
const GameStateCache    = require('../cache/GameStateCache');
const MoveTokenStore    = require('../cache/MoveTokenStore');
const MoveCooldownStore = require('../cache/MoveCooldownStore');
const LeaderboardCache  = require('../cache/LeaderboardCache');

// ── Zod payload validation ────────────────────────────────────────────────────
const { schemas, validateOrReject } = require('./payloadSchemas');

// ── Other dependencies ────────────────────────────────────────────────────────
const { getRedisClient }   = require('../lib/redis');
const { games, users, wallets, transactions, notifications, eloHistory } = require('../lib/db');
const { calculateBothElo } = require('../lib/elo');
const {
  analyzeGame, analyzeRealtime, enforceAnticheat,
  detectEloAnomaly, runStockfishBackground, detectDisconnectAbuse,
} = require('../lib/anticheat');
const { netWinnings }                 = require('../lib/midtrans');
const { logMove, logSecurityEvent }   = require('../lib/auditLog');
const { recordAndDetect, scoreFingerprintResult } = require('../lib/fingerprint');
const { runCollusionDetection }       = require('../lib/collusion');

// ── Instance identity (for distributed game lease) ───────────────────────────
const INSTANCE_ID      = `${os.hostname()}:${process.pid}`;
const GAME_LEASE_TTL_MS = 5000;

// ── Local-only state (socket-instance-specific, cannot be distributed) ───────

// Map<`${gameId}:${userId}`, socketId>  — anti multi-tab enforcement
const activeGameSockets = new Map();

// C4: Track consecutive DB write failures per game (circuit-breaker)
const dbWriteFailures = new Map();

// Reverse lookup for disconnect cleanup: Map<socketId, {gameId, userId}[]>
const socketGameRooms = new Map();

// Map<gameId, setInterval>  — clock timer per game (one instance owns via lease)
const timers = new Map();

// Map<`${gameId}:${userId}`, setTimeout>  — disconnect forfeit timers
const disconnectTimers = new Map();

// Disconnect history for abuse detection (per-instance, acceptable)
const disconnectHistory = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function withTimeout(promise, ms, label) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
  );
  return Promise.race([promise, timeout]);
}

// M5: Use shared function from lib/timeControl.js — no longer duplicated
const getTimeControlType = _getTimeControlType;

function eloColumnForType(tcType) {
  return `elo_${tcType}`;
}

function generateMoveToken() {
  return crypto.randomBytes(16).toString('hex');
}

function emitToGameAndSpectators(io, gameId, event, payload) {
  io.to(gameId).emit(event, payload);
  io.to(`spectate:${gameId}`).emit(event, payload);
}

function deriveDisconnectResponsibility(triggerUserId, opponentHasPendingDc) {
  return opponentHasPendingDc ? null : triggerUserId;
}

function computeFairnessOutcome(reasonBase, moveCount, responsibleUserId) {
  const isNoContest =
    (reasonBase === 'aborted' && moveCount < 2) ||
    (reasonBase === 'disconnect' && moveCount === 0);
  const finalEndReason = responsibleUserId
    ? `${reasonBase}|resp:${responsibleUserId}`
    : reasonBase;
  return {
    isNoContest,
    finalEndReason,
    fairnessOutcome: isNoContest ? 'no_contest' : 'normal',
  };
}

// ── Distributed game lease ────────────────────────────────────────────────────

async function acquireGameLease(gameId) {
  const client = await getRedisClient();
  if (!client) return true;
  const key = `game:lease:${gameId}`;
  const ok = await client.set(key, INSTANCE_ID, { NX: true, PX: GAME_LEASE_TTL_MS });
  if (ok === 'OK') return true;
  const current = await client.get(key);
  if (current !== INSTANCE_ID) return false;
  await client.pExpire(key, GAME_LEASE_TTL_MS).catch(() => {});
  return true;
}

// ── Game state helpers ────────────────────────────────────────────────────────

/**
 * Load game state into cache (local + Redis) from DB if not already present.
 * moveSeq is stored inside the state object (replaces separate moveSequences Map).
 */
async function getGameState(gameId) {
  // Fast path: already in local cache
  const cached = GameStateCache.getLocal(gameId);
  if (cached) return cached;

  // Try Redis (another instance may have seeded it)
  const fromRedis = await GameStateCache.get(gameId);
  if (fromRedis) return fromRedis;

  // Fall back to DB
  const game = await games.findById(gameId);
  if (!game) return null;

  const state = {
    id:             game.id,
    fen:            game.fen,
    whiteTimeLeft:  game.white_time_left,
    blackTimeLeft:  game.black_time_left,
    moveHistory:    game.move_history || [],
    status:         game.status,
    whiteId:        game.white_id,
    blackId:        game.black_id,
    timeControl:    game.time_control,
    stakes:         game.stakes,
    whiteEloBefore: game.white_elo_before,
    blackEloBefore: game.black_elo_before,
    drawOfferedBy:  null,
    lastMoveAt:     Date.now(),
    moveSeq:        (game.move_history || []).length, // resume from last persisted move
  };

  await GameStateCache.set(gameId, state);
  return state;
}

// updateGameState is now a thin wrapper — callers can also call GameStateCache.update directly.
async function updateGameState(gameId, updates) {
  await GameStateCache.update(gameId, updates);
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function startTimer(io, gameId) {
  if (timers.has(gameId)) return;

  const interval = setInterval(async () => {
    const hasLease = await acquireGameLease(gameId);
    if (!hasLease) return;

    // getLocal: synchronous hot-path read — state must be loaded before timer starts
    const game = GameStateCache.getLocal(gameId);
    if (!game || game.status !== 'active') {
      clearInterval(interval);
      timers.delete(gameId);
      return;
    }

    const turn = game.fen.split(' ')[1];

    if (turn === 'w') {
      const newTime = Math.max(0, game.whiteTimeLeft - 1);
      // Mutate local object directly (sync), then persist async
      game.whiteTimeLeft = newTime;
      GameStateCache.update(gameId, { whiteTimeLeft: newTime }).catch(() => {});
      emitToGameAndSpectators(io, gameId, 'game:clock', {
        whiteTimeLeft: newTime, blackTimeLeft: game.blackTimeLeft, turn: 'w',
      });
      if (newTime === 0) {
        clearInterval(interval);
        timers.delete(gameId);
        endGame(io, gameId, 'black', 'timeout');
      }
    } else {
      const newTime = Math.max(0, game.blackTimeLeft - 1);
      game.blackTimeLeft = newTime;
      GameStateCache.update(gameId, { blackTimeLeft: newTime }).catch(() => {});
      emitToGameAndSpectators(io, gameId, 'game:clock', {
        whiteTimeLeft: game.whiteTimeLeft, blackTimeLeft: newTime, turn: 'b',
      });
      if (newTime === 0) {
        clearInterval(interval);
        timers.delete(gameId);
        endGame(io, gameId, 'white', 'timeout');
      }
    }
  }, 1000);

  timers.set(gameId, interval);
}

function stopTimer(gameId) {
  const interval = timers.get(gameId);
  if (interval) {
    clearInterval(interval);
    timers.delete(gameId);
  }
}

// ── Disconnect forfeit ────────────────────────────────────────────────────────

function scheduleDisconnectForfeit(io, gameId, game, userId, socket) {
  socket.to(gameId).emit('opponent:disconnected', { userId, reconnectWindow: 60 });

  // [SECURITY-DISCONNECT] Record disconnect event for abuse tracking
  disconnectHistory.push({ userId, gameId, timestamp: Date.now() });
  const cutoff = Date.now() - 86_400_000;
  while (disconnectHistory.length > 0 && disconnectHistory[0].timestamp < cutoff) {
    disconnectHistory.shift();
  }

  const abuseResult = detectDisconnectAbuse(userId, disconnectHistory);
  if (abuseResult.abusive) {
    logSecurityEvent('DISCONNECT_ABUSE_DETECTED', { userId, gameId, count: abuseResult.count });
    enforceAnticheat(userId, gameId, { flags: abuseResult.flags, score: 10 * abuseResult.count }, io)
      .catch(e => console.error('[DisconnectAbuse:enforce]', e.message));
  }

  const dcKey = `${gameId}:${userId}`;
  if (disconnectTimers.get(dcKey)) return;

  const dcTimer = setTimeout(async () => {
    try {
      const hasLease = await acquireGameLease(gameId);
      if (!hasLease) return;
      disconnectTimers.delete(dcKey);
      const currentGame = GameStateCache.getLocal(gameId);
      if (!currentGame || currentGame.status !== 'active') return;

      // C2: Use fetchSockets (cross-instance aware with Redis adapter) instead of
      // io.sockets.adapter.rooms which only reflects sockets on the LOCAL instance.
      let roomHasOpponent = false;
      try {
        const sockets = await io.in(gameId).fetchSockets();
        roomHasOpponent = sockets.length > 0;
      } catch {
        // Fallback to local rooms if fetchSockets unavailable
        const room = io.sockets.adapter.rooms.get(gameId);
        roomHasOpponent = !!(room && room.size > 0);
      }

      if (!roomHasOpponent) {
        stopTimer(gameId);
        const opponentId = game.whiteId === userId ? game.blackId : game.whiteId;
        const opponentHasPendingDc = disconnectTimers.has(`${gameId}:${opponentId}`);
        const responsibleUserId = deriveDisconnectResponsibility(userId, opponentHasPendingDc);
        endGame(io, gameId, 'draw', 'aborted', {
          responsibleUserId,
          finalizationSource: 'disconnect-timeout',
          disconnectSnapshot: { triggerUserId: userId, opponentUserId: opponentId, opponentHasPendingDc },
        });
      } else {
        stopTimer(gameId);
        const winner = game.whiteId === userId ? 'black' : 'white';
        endGame(io, gameId, winner, 'disconnect', {
          responsibleUserId: userId,
          finalizationSource: 'disconnect-timeout',
          disconnectSnapshot: { triggerUserId: userId, crossInstanceRoomSize: 'checked' },
        });
      }
    } catch (e) {
      console.error('[disconnectTimer]', e);
    }
  }, 60_000);

  disconnectTimers.set(dcKey, dcTimer);
}

// ── End game ─────────────────────────────────────────────────────────────────

async function endGame(io, gameId, winner, endReason, context = {}) {
  const game = GameStateCache.getLocal(gameId);
  if (!game || game.status !== 'active') return;

  const reasonBase         = String(endReason || '').split('|')[0];
  const responsibleUserId  = context?.responsibleUserId || null;
  const finalizationSource = context?.finalizationSource || 'normal';
  const disconnectSnapshot = context?.disconnectSnapshot || null;

  // Cross-instance guard: claim finalization only if DB still active.
  const claimed = await games.updateIfStatus(gameId, 'active', {
    status:            'finishing',
    end_reason:        reasonBase,
    responsible_user_id: responsibleUserId,
    fairness_outcome:  reasonBase === 'aborted' || reasonBase === 'disconnect'
      ? 'no_contest_candidate'
      : 'normal',
    updated_at:        new Date(),
  }).catch((e) => { console.error('[endGame:claim]', e); return null; });

  if (!claimed) {
    logSecurityEvent('DUPLICATE_FINALIZE_ATTEMPT', { gameId, winner, endReason: reasonBase });
    return;
  }

  // Mark local state as non-active to prevent re-entry on this instance.
  game.status = 'finishing';
  GameStateCache.update(gameId, { status: 'finishing' }).catch(() => {});

  try {
    const [whiteUser, blackUser] = await Promise.all([
      users.findById(game.whiteId),
      users.findById(game.blackId),
    ]);
    if (!whiteUser || !blackUser) return;

    const moveCount = game.moveHistory?.length || 0;
    const { isNoContest, finalEndReason, fairnessOutcome } =
      computeFairnessOutcome(reasonBase, moveCount, responsibleUserId);

    if (isNoContest) {
      logSecurityEvent('NO_CONTEST_RECORDED', { gameId, reason: reasonBase, responsibleUserId });
      if (game.stakes > 0) {
        await Promise.all([
          wallets.unlock(game.whiteId, game.stakes).catch(() => {}),
          wallets.unlock(game.blackId, game.stakes).catch(() => {}),
        ]);
      }

      await games.update(gameId, {
        status: 'cancelled', winner: null,
        end_reason: finalEndReason, responsible_user_id: responsibleUserId,
        fairness_outcome: fairnessOutcome,
        fairness_context: { finalizationSource, disconnectSnapshot },
        fen: game.fen, move_history: game.moveHistory,
        white_time_left: game.whiteTimeLeft, black_time_left: game.blackTimeLeft,
        ended_at: new Date(),
      });

      emitToGameAndSpectators(io, gameId, 'game:over', {
        gameId, winner: 'draw', endReason: reasonBase, cancelled: true,
        eloChanges: { [game.whiteId]: 0, [game.blackId]: 0 },
        whiteElo: whiteUser.elo, blackElo: blackUser.elo, stakes: game.stakes,
      });

      // Cleanup tokens + state after 5 minutes
      MoveTokenStore.delGame(gameId).catch(() => {});
      const cleanupTimer = setTimeout(() => {
        GameStateCache.del(gameId).catch(() => {});
      }, 300_000);
      if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

      if (process.env.NODE_ENV !== 'test') {
        console.log(`[Game] ${gameId} ended as no-contest (${finalEndReason})`);
      }
      return;
    }

    const eloResult = winner === 'draw' ? 'draw' : winner === 'white' ? 'white' : 'black';
    const tcType    = getTimeControlType(game.timeControl?.initial);
    const eloCol    = eloColumnForType(tcType);

    const whiteEloBefore = game.whiteEloBefore || whiteUser[eloCol] || whiteUser.elo;
    const blackEloBefore = game.blackEloBefore || blackUser[eloCol] || blackUser.elo;

    const { whiteChange, blackChange } = calculateBothElo(
      whiteEloBefore, blackEloBefore, eloResult,
      whiteUser.games_played ?? 30, blackUser.games_played ?? 30
    );

    const newWhiteEloTc = Math.max(100, whiteEloBefore + whiteChange);
    const newBlackEloTc = Math.max(100, blackEloBefore + blackChange);
    const newWhiteElo   = newWhiteEloTc;
    const newBlackElo   = newBlackEloTc;

    await Promise.all([
      users.update(game.whiteId, {
        elo: newWhiteElo, [eloCol]: newWhiteEloTc,
        games_played: (whiteUser.games_played || 0) + 1,
        wins:   (whiteUser.wins   || 0) + (winner === 'white' ? 1 : 0),
        losses: (whiteUser.losses || 0) + (winner === 'black' ? 1 : 0),
        draws:  (whiteUser.draws  || 0) + (winner === 'draw'  ? 1 : 0),
      }),
      users.update(game.blackId, {
        elo: newBlackElo, [eloCol]: newBlackEloTc,
        games_played: (blackUser.games_played || 0) + 1,
        wins:   (blackUser.wins   || 0) + (winner === 'black' ? 1 : 0),
        losses: (blackUser.losses || 0) + (winner === 'white' ? 1 : 0),
        draws:  (blackUser.draws  || 0) + (winner === 'draw'  ? 1 : 0),
      }),
    ]);

    if (game.stakes > 0) {
      const { fee } = netWinnings(game.stakes * 2);
      const winnerId = winner === 'white' ? game.whiteId : winner === 'black' ? game.blackId : null;
      const loserId  = winner === 'white' ? game.blackId : winner === 'black' ? game.whiteId : null;

      await wallets.settleGamePayout(
        winnerId, loserId, game.whiteId, game.blackId, game.stakes, fee,
      );

      if (winner !== 'draw') {
        const winnerUser = winner === 'white' ? whiteUser : blackUser;
        const loserUser  = winner === 'white' ? blackUser : whiteUser;
        await transactions.create({
          user_id: winnerId, type: 'game-win', amount: game.stakes - fee, status: 'completed',
          description: `Won vs ${loserUser.username} (+${game.stakes - fee} after ${fee} fee)`,
          game_id: gameId,
        });
        await transactions.create({
          user_id: loserId, type: 'game-loss', amount: -game.stakes, status: 'completed',
          description: `Lost vs ${winnerUser.username}`, game_id: gameId,
        });
      } else {
        await transactions.create({
          user_id: game.whiteId, type: 'game-draw', amount: 0, status: 'completed',
          description: `Draw vs ${blackUser.username}`, game_id: gameId,
        });
        await transactions.create({
          user_id: game.blackId, type: 'game-draw', amount: 0, status: 'completed',
          description: `Draw vs ${whiteUser.username}`, game_id: gameId,
        });
      }
    }

    // [SECURITY-7/8/9] Anti-cheat analysis
    let anticheatFlags = [];
    try {
      const anticheatResult = analyzeGame({ move_history: game.moveHistory });

      if (anticheatResult.white.suspicious) {
        anticheatFlags.push({ color: 'white', flags: anticheatResult.white.flags, score: anticheatResult.white.score });
        await withTimeout(enforceAnticheat(game.whiteId, gameId, anticheatResult.white, io), 30_000, 'enforceAnticheat:white');
      }
      if (anticheatResult.black.suspicious) {
        anticheatFlags.push({ color: 'black', flags: anticheatResult.black.flags, score: anticheatResult.black.score });
        await withTimeout(enforceAnticheat(game.blackId, gameId, anticheatResult.black, io), 30_000, 'enforceAnticheat:black');
      }

      const allSyncFlags = [...anticheatResult.white.flags, ...anticheatResult.black.flags];

      withTimeout(Promise.all([
        detectEloAnomaly(game.whiteId, {
          playerElo: game.whiteEloBefore || whiteUser.elo,
          opponentElo: game.blackEloBefore || blackUser.elo,
          result: winner === 'white' ? 'win' : winner === 'black' ? 'loss' : 'draw',
        }),
        detectEloAnomaly(game.blackId, {
          playerElo: game.blackEloBefore || blackUser.elo,
          opponentElo: game.whiteEloBefore || whiteUser.elo,
          result: winner === 'black' ? 'win' : winner === 'white' ? 'loss' : 'draw',
        }),
      ]), 30_000, 'detectEloAnomaly').then(async ([whiteEloResult, blackEloResult]) => {
        if (whiteEloResult.suspicious)
          await withTimeout(enforceAnticheat(game.whiteId, gameId, whiteEloResult, io), 30_000, 'enforceAnticheat:elo:white');
        if (blackEloResult.suspicious)
          await withTimeout(enforceAnticheat(game.blackId, gameId, blackEloResult, io), 30_000, 'enforceAnticheat:elo:black');
      }).catch(e => console.error('[ELO-anomaly background]', e.message));

      withTimeout(runStockfishBackground(gameId, game.moveHistory, allSyncFlags, io), 120_000, 'stockfishBackground')
        .catch(e => console.error('[Stockfish background error]', e.message));

      withTimeout(runCollusionDetection(
        gameId, game.whiteId, game.blackId, game.moveHistory, winner, endReason,
      ), 30_000, 'collusionDetection').then(async (collusionResult) => {
        if (collusionResult.white.suspicious)
          await withTimeout(enforceAnticheat(game.whiteId, gameId, collusionResult.white, io), 30_000, 'enforceAnticheat:collusion:white');
        if (collusionResult.black.suspicious)
          await withTimeout(enforceAnticheat(game.blackId, gameId, collusionResult.black, io), 30_000, 'enforceAnticheat:collusion:black');
      }).catch(e => console.error('[Collusion background error]', e.message));

    } catch (anticheatErr) {
      console.error('[anticheat/error]', anticheatErr);
    }

    // Cleanup move tokens
    MoveTokenStore.delGame(gameId).catch(() => {});

    await games.update(gameId, {
      status: 'finished', winner,
      end_reason: finalEndReason, responsible_user_id: responsibleUserId,
      fairness_outcome: 'normal',
      fairness_context: { finalizationSource, disconnectSnapshot },
      fen: game.fen, move_history: game.moveHistory,
      white_elo_after: newWhiteElo, black_elo_after: newBlackElo,
      white_time_left: game.whiteTimeLeft, black_time_left: game.blackTimeLeft,
      ended_at: new Date(), anticheat_flags: anticheatFlags,
    });

    await Promise.all([
      eloHistory.create(game.whiteId, game.whiteEloBefore || whiteUser.elo, newWhiteElo, gameId),
      eloHistory.create(game.blackId, game.blackEloBefore || blackUser.elo, newBlackElo, gameId),
    ]);

    const winnerName = winner === 'white' ? whiteUser.username : winner === 'black' ? blackUser.username : null;
    if (winner !== 'draw' && winnerName) {
      const winnerId  = winner === 'white' ? game.whiteId : game.blackId;
      const loserId   = winner === 'white' ? game.blackId : game.whiteId;
      const loserName = winner === 'white' ? blackUser.username : whiteUser.username;
      await notifications.create(winnerId, 'game_result', 'You won!',
        `Checkmate! You beat ${loserName}. ELO: +${winner === 'white' ? whiteChange : blackChange}`);
      await notifications.create(loserId, 'game_result', 'Game over',
        `You lost to ${winnerName}. ELO: ${winner === 'white' ? blackChange : whiteChange}`);
    }

    emitToGameAndSpectators(io, gameId, 'game:over', {
      gameId, winner, endReason: reasonBase,
      eloChanges: { [game.whiteId]: whiteChange, [game.blackId]: blackChange },
      whiteElo: newWhiteElo, blackElo: newBlackElo, stakes: game.stakes,
    });

    try {
      const [whiteBal, blackBal] = await Promise.all([
        wallets.getBalance(game.whiteId),
        wallets.getBalance(game.blackId),
      ]);
      io.to(game.whiteId).emit('wallet:update', { balance: whiteBal.balance, locked: whiteBal.locked });
      io.to(game.blackId).emit('wallet:update', { balance: blackBal.balance, locked: blackBal.locked });
    } catch (e) { console.error('[endGame wallet:update]', e); }

    try {
      const [whiteNotifs, blackNotifs] = await Promise.all([
        notifications.getUnread(game.whiteId),
        notifications.getUnread(game.blackId),
      ]);
      if (whiteNotifs.length) io.to(game.whiteId).emit('notification:new', { notifications: whiteNotifs });
      if (blackNotifs.length) io.to(game.blackId).emit('notification:new', { notifications: blackNotifs });
    } catch (e) { console.error('[endGame notification:new]', e); }

    io.to(game.whiteId).emit('user:stats', {
      elo: newWhiteElo, [eloCol]: newWhiteEloTc, tcType,
      wins:   (whiteUser.wins   || 0) + (winner === 'white' ? 1 : 0),
      losses: (whiteUser.losses || 0) + (winner === 'black' ? 1 : 0),
      draws:  (whiteUser.draws  || 0) + (winner === 'draw'  ? 1 : 0),
    });
    io.to(game.blackId).emit('user:stats', {
      elo: newBlackElo, [eloCol]: newBlackEloTc, tcType,
      wins:   (blackUser.wins   || 0) + (winner === 'black' ? 1 : 0),
      losses: (blackUser.losses || 0) + (winner === 'white' ? 1 : 0),
      draws:  (blackUser.draws  || 0) + (winner === 'draw'  ? 1 : 0),
    });

    // Invalidate leaderboard cache — ELO just changed
    LeaderboardCache.invalidateAll().catch(() => {});

    // Cleanup state after 5 minutes (allows reconnect & result viewing)
    const cleanupTimer = setTimeout(() => {
      GameStateCache.del(gameId).catch(() => {});
    }, 300_000);
    if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[Game] ${gameId} ended — winner: ${winner} (${endReason})`);
    }
  } catch (err) {
    console.error('[endGame]', err);
  }
}

// ── Register socket handlers ──────────────────────────────────────────────────

function registerGameRoom(io, socket, userId) {

  // ── Join game room ─────────────────────────────────────────────────────────
  socket.on('game:join', async (payload) => {
    try {
      const data = validateOrReject(schemas.joinSchema, payload, socket, 'game:join');
      if (!data) return;
      const { gameId } = data;

      const game = await getGameState(gameId);
      if (!game) return socket.emit('error', { message: 'Game not found' });
      if (game.whiteId !== userId && game.blackId !== userId) {
        return socket.emit('error', { message: 'Not a player in this game' });
      }

      // [SECURITY-2] Anti multi-tab: hanya 1 socket aktif per user per game
      const sessionKey       = `${gameId}:${userId}`;
      const existingSocketId = activeGameSockets.get(sessionKey);

      if (existingSocketId && existingSocketId !== socket.id) {
        const existingSocket = io.sockets.sockets.get(existingSocketId);
        if (existingSocket) {
          logSecurityEvent('MULTI_TAB_ATTEMPT', {
            userId, gameId, oldSocketId: existingSocketId, newSocketId: socket.id,
          });
          existingSocket.emit('session:displaced', {
            message: 'Sesi game kamu dibuka di tab/perangkat lain. Tab ini tidak aktif lagi.',
          });
          existingSocket.leave(gameId);
          const oldRooms = socketGameRooms.get(existingSocketId) || [];
          socketGameRooms.set(existingSocketId, oldRooms.filter(r => r.gameId !== gameId));
        }
      }

      activeGameSockets.set(sessionKey, socket.id);

      const currentRooms = socketGameRooms.get(socket.id) || [];
      if (!currentRooms.find(r => r.gameId === gameId)) {
        currentRooms.push({ gameId, userId });
        socketGameRooms.set(socket.id, currentRooms);
      }

      socket.join(gameId);

      // Cancel pending disconnect forfeit
      const dcKey   = `${gameId}:${userId}`;
      const dcTimer = disconnectTimers.get(dcKey);
      if (dcTimer) {
        clearTimeout(dcTimer);
        disconnectTimers.delete(dcKey);
        socket.to(gameId).emit('opponent:reconnected', { userId });
      }

      // Start clock when both players are in room (local fast-path)
      const room           = io.sockets.adapter.rooms.get(gameId);
      const whiteSocketId  = activeGameSockets.get(`${gameId}:${game.whiteId}`);
      const blackSocketId  = activeGameSockets.get(`${gameId}:${game.blackId}`);
      const hasBothPlayers = !!(
        room && whiteSocketId && blackSocketId &&
        room.has(whiteSocketId) && room.has(blackSocketId)
      );
      if (hasBothPlayers && game.status === 'active') {
        startTimer(io, gameId);
      }
      // C3: Timer recovery — if game is active but no timer is running locally
      // (e.g. after instance crash/restart), restart clock.
      // acquireGameLease inside startTimer ensures only one instance ticks.
      if (game.status === 'active' && !timers.has(gameId)) {
        startTimer(io, gameId);
      }

      // [SECURITY-3] Issue initial move token (stored in Redis)
      const initialToken = generateMoveToken();
      await MoveTokenStore.set(gameId, userId, initialToken);

      // [SECURITY-10] Device fingerprinting — multi-account detection
      recordAndDetect(socket, userId, gameId).then(async (fpResult) => {
        if (fpResult.isMultiAccount) {
          const fpScore = scoreFingerprintResult(fpResult);
          logSecurityEvent('MULTI_ACCOUNT_DETECTED', {
            userId, gameId,
            sharedWith: fpResult.suspectedUserIds,
            fingerprintHash: fpResult.fingerprintHash.slice(0, 12) + '…',
          });
          enforceAnticheat(userId, gameId, fpScore, io).catch(e =>
            console.error('[Fingerprint:enforce]', e.message)
          );
        }
      }).catch(e => console.error('[Fingerprint:detect]', e.message));

      socket.emit('game:state', {
        gameId,
        fen:           game.fen,
        moveHistory:   game.moveHistory,
        whiteTimeLeft: game.whiteTimeLeft,
        blackTimeLeft: game.blackTimeLeft,
        status:        game.status,
        playerColor:   game.whiteId === userId ? 'white' : 'black',
        nextMoveToken: initialToken,
      });

      socket.to(gameId).emit('opponent:connected', { userId });
      console.log(`[Room] ${userId} joined game ${gameId} (socket: ${socket.id})`);
    } catch (err) {
      console.error('[game:join]', err);
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  // ── Make a move ────────────────────────────────────────────────────────────
  socket.on('game:move', async (payload) => {
    try {
      const data = validateOrReject(schemas.moveSchema, payload, socket, 'game:move');
      if (!data) return;
      const { gameId, from, to, promotion, moveToken } = data;

      const serverTs = Date.now();

      // Fast synchronous read from local write-through cache
      const game = GameStateCache.getLocal(gameId);
      if (!game || game.status !== 'active') {
        return socket.emit('move:invalid', { reason: 'Game not active' });
      }

      // [SECURITY-2] Validate socket registration
      const sessionKey       = `${gameId}:${userId}`;
      const registeredSocketId = activeGameSockets.get(sessionKey);
      if (registeredSocketId && registeredSocketId !== socket.id) {
        logSecurityEvent('UNAUTHORIZED_MOVE_ATTEMPT', {
          userId, gameId,
          attemptingSocket: socket.id,
          registeredSocket: registeredSocketId,
        });
        return socket.emit('move:invalid', { reason: 'Session tidak valid. Refresh halaman.' });
      }

      // [SECURITY-1] Rate limiting (Redis, cross-instance)
      const lastMoveTs = await MoveCooldownStore.getLast(userId);
      if (serverTs - lastMoveTs < MoveCooldownStore.COOLDOWN_MS) {
        logSecurityEvent('RATE_LIMIT_HIT', {
          userId, gameId, timeSinceLast: serverTs - lastMoveTs,
        });
        return socket.emit('move:invalid', { reason: 'Terlalu cepat. Tunggu sebentar.' });
      }

      // [SECURITY-3] Move token validation (Redis, cross-instance)
      const expectedToken = await MoveTokenStore.get(gameId, userId);

      if (!expectedToken) {
        logSecurityEvent('NO_TOKEN_ISSUED', {
          userId, gameId,
          providedToken: moveToken || '(none)',
          seq: game.moveSeq || 0,
        });
        return socket.emit('move:invalid', {
          reason: 'Session tidak valid. Mohon refresh dan join ulang.',
          requestTokenRefresh: true,
        });
      }

      if (moveToken !== expectedToken) {
        logSecurityEvent('INVALID_MOVE_TOKEN', {
          userId, gameId,
          provided: moveToken || '(none)',
          expected: expectedToken,
          seq:      game.moveSeq || 0,
        });
        return socket.emit('move:invalid', {
          reason: 'Token tidak valid. Kemungkinan replay attack atau session expired.',
          requestTokenRefresh: true,
        });
      }

      // [SECURITY-7] Turn validation
      const isWhite = game.whiteId === userId;
      const isBlack = game.blackId === userId;
      const turn    = game.fen.split(' ')[1];
      if ((turn === 'w' && !isWhite) || (turn === 'b' && !isBlack)) {
        return socket.emit('move:invalid', { reason: 'Not your turn' });
      }

      // [SECURITY-8] Server-authoritative chess.js validation
      const chess = new Chess(game.fen);
      let move;
      try {
        move = chess.move({ from, to, promotion: promotion || 'q' });
      } catch {
        return socket.emit('move:invalid', { reason: 'Illegal move' });
      }
      if (!move) return socket.emit('move:invalid', { reason: 'Illegal move' });

      // Move accepted — update cooldown + issue new token (parallel writes)
      const newToken     = generateMoveToken();
      const currentSeq   = (game.moveSeq || 0) + 1;

      await Promise.all([
        MoveCooldownStore.setLast(userId, serverTs),
        MoveTokenStore.set(gameId, userId, newToken),
      ]);
      socket.emit('move:token', { nextMoveToken: newToken });

      // Update clocks
      const increment = game.timeControl?.increment || 0;
      let { whiteTimeLeft, blackTimeLeft } = game;
      if (turn === 'w') whiteTimeLeft = Math.min(whiteTimeLeft + increment, (game.timeControl?.initial || 600) * 2);
      else              blackTimeLeft = Math.min(blackTimeLeft + increment, (game.timeControl?.initial || 600) * 2);

      const timeTakenMs = game.lastMoveAt ? serverTs - game.lastMoveAt : 0;

      const moveRecord = {
        san:       move.san,
        from:      move.from,
        to:        move.to,
        flags:     move.flags,
        piece:     move.piece,
        captured:  move.captured,
        promotion: move.promotion,
        timestamp: serverTs,
        whiteTimeLeft,
        blackTimeLeft,
        seq:       currentSeq,
      };

      const newMoveHistory = [...game.moveHistory, moveRecord];

      // Update local cache synchronously then persist to Redis async
      await GameStateCache.update(gameId, {
        fen:         chess.fen(),
        moveHistory: newMoveHistory,
        whiteTimeLeft,
        blackTimeLeft,
        lastMoveAt:  serverTs,
        moveSeq:     currentSeq,
      });

      // [SECURITY-4] Audit trail
      logMove({
        gameId, userId,
        moveSeq:    currentSeq,
        san:        move.san,
        from:       move.from,
        to:         move.to,
        fenAfter:   chess.fen(),
        timeTakenMs,
        timeLeft:   isWhite ? whiteTimeLeft : blackTimeLeft,
        serverTs,
      });

      emitToGameAndSpectators(io, gameId, 'game:move', {
        move: moveRecord,
        fen:  chess.fen(),
        whiteTimeLeft,
        blackTimeLeft,
      });

      // Persist live snapshot for process-restart recovery
      // C4: Circuit breaker — 3 consecutive DB write failures halts the game
      // to prevent Redis/DB state divergence on staked games.
      games.update(gameId, {
        fen:             chess.fen(),
        move_history:    newMoveHistory,
        white_time_left: whiteTimeLeft,
        black_time_left: blackTimeLeft,
        updated_at:      new Date(),
      }).then(() => {
        dbWriteFailures.delete(gameId); // reset on success
      }).catch((e) => {
        console.error('[game:move persist]', e);
        const fails = (dbWriteFailures.get(gameId) || 0) + 1;
        dbWriteFailures.set(gameId, fails);
        if (fails >= 3) {
          logSecurityEvent('DB_WRITE_FAILURE_HALT', { gameId, userId, fails });
          console.error(`[game:move] Halting game ${gameId} after ${fails} consecutive DB write failures`);
          stopTimer(gameId);
          dbWriteFailures.delete(gameId);
          endGame(io, gameId, 'draw', 'aborted', {
            responsibleUserId: null,
            finalizationSource: 'db-failure',
          });
        }
      });

      // [SECURITY-5] Real-time anticheat
      const tcType           = getTimeControlType(game.timeControl?.initial);
      // C1 FIX: bullet games are SHORTER — check MORE frequently (every 10 moves).
      // Blitz/rapid are longer, so every 20 moves is sufficient.
      const anticheatInterval = tcType === 'bullet' ? 10 : 20;
      if (newMoveHistory.length > 0 && newMoveHistory.length % anticheatInterval === 0) {
        try {
          const realtimeResult = analyzeRealtime(newMoveHistory);
          for (const check of [
            { color: 'white', user: game.whiteId, result: realtimeResult.white },
            { color: 'black', user: game.blackId, result: realtimeResult.black },
          ]) {
            if (check.result?.suspicious) {
              logSecurityEvent('REALTIME_SUSPICIOUS', {
                userId: check.user, gameId, moveSeq: currentSeq,
                color: check.color, flags: check.result.flags,
                score: check.result.score, stats: check.result.stats,
              });
            }
          }
        } catch (e) { console.error('[anticheat:realtime]', e); }
      }

      // Endgame detection
      if (chess.isCheckmate()) {
        stopTimer(gameId);
        endGame(io, gameId, turn === 'w' ? 'white' : 'black', 'checkmate');
      } else if (chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
        stopTimer(gameId);
        const reason = chess.isStalemate()             ? 'stalemate'
          : chess.isThreefoldRepetition()              ? 'repetition'
          : chess.isInsufficientMaterial()             ? 'insufficient'
          : 'fifty-move';
        endGame(io, gameId, 'draw', reason);
      }
    } catch (err) {
      console.error('[game:move]', err);
      socket.emit('error', { message: 'Move processing failed' });
    }
  });

  // ── Tab-switching report ───────────────────────────────────────────────────
  socket.on('game:tab-hidden', (payload) => {
    const data = validateOrReject(schemas.tabHiddenSchema, payload, socket, 'game:tab-hidden');
    if (!data) return;
    const { gameId, hiddenMs, totalHiddenMs } = data;

    const game = GameStateCache.getLocal(gameId);
    if (!game || game.status !== 'active') return;
    if (game.whiteId !== userId && game.blackId !== userId) return;

    logSecurityEvent('TAB_HIDDEN', { userId, gameId, hiddenMs, totalHiddenMs });

    if (totalHiddenMs >= 30_000) {
      // H8 FIX: tab-hidden is CLIENT self-reported — a cheat client simply never
      // sends this event. Log for manual review only; never auto-enforce based
      // solely on client-reported data (trust boundary violation).
      logSecurityEvent('TAB_HIDDEN_EXCESSIVE', { userId, gameId, totalHiddenMs });
    }
  });

  // ── Resign ─────────────────────────────────────────────────────────────────
  socket.on('game:resign', (payload) => {
    const data = validateOrReject(schemas.resignSchema, payload, socket, 'game:resign');
    if (!data) return;
    const { gameId } = data;

    const game = GameStateCache.getLocal(gameId);
    if (!game || game.status !== 'active') return;
    if (game.whiteId !== userId && game.blackId !== userId) return;

    stopTimer(gameId);
    const winner = game.whiteId === userId ? 'black' : 'white';
    endGame(io, gameId, winner, 'resign');
  });

  // ── Draw offer / accept / decline ─────────────────────────────────────────
  socket.on('game:draw-offer', (payload) => {
    const data = validateOrReject(schemas.drawOfferSchema, payload, socket, 'game:draw-offer');
    if (!data) return;
    const { gameId } = data;

    const game = GameStateCache.getLocal(gameId);
    if (!game || game.status !== 'active') return;
    if (game.whiteId !== userId && game.blackId !== userId) return;

    GameStateCache.update(gameId, { drawOfferedBy: userId }).catch(() => {});
    socket.to(gameId).emit('game:draw-offered', { by: userId });
  });

  socket.on('game:draw-accept', (payload) => {
    const data = validateOrReject(schemas.drawOfferSchema, payload, socket, 'game:draw-accept');
    if (!data) return;
    const { gameId } = data;

    const game = GameStateCache.getLocal(gameId);
    if (!game || game.status !== 'active' || !game.drawOfferedBy) return;

    if (game.drawOfferedBy === userId) {
      logSecurityEvent('DRAW_SELF_ACCEPT_ATTEMPT', { userId, gameId });
      return socket.emit('error', { message: 'Cannot accept your own draw offer.' });
    }
    if (game.whiteId !== userId && game.blackId !== userId) return;

    stopTimer(gameId);
    endGame(io, gameId, 'draw', 'draw-agreement');
  });

  socket.on('game:draw-decline', (payload) => {
    const data = validateOrReject(schemas.drawOfferSchema, payload, socket, 'game:draw-decline');
    if (!data) return;
    const { gameId } = data;

    const game = GameStateCache.getLocal(gameId);
    if (!game || game.status !== 'active') return;
    if (game.whiteId !== userId && game.blackId !== userId) return;

    GameStateCache.update(gameId, { drawOfferedBy: null }).catch(() => {});
    socket.to(gameId).emit('game:draw-declined');
  });

  // ── Leave game room ────────────────────────────────────────────────────────
  socket.on('game:leave', (payload) => {
    const data = validateOrReject(schemas.resignSchema, payload, socket, 'game:leave');
    if (!data) return;
    const { gameId } = data;

    const game = GameStateCache.getLocal(gameId);
    if (!game || game.status !== 'active') return;
    if (game.whiteId !== userId && game.blackId !== userId) return;

    const sessionKey = `${gameId}:${userId}`;
    if (activeGameSockets.get(sessionKey) === socket.id) {
      activeGameSockets.delete(sessionKey);
    }
    // Token cleanup deferred — MoveTokenStore will expire naturally
    // or be deleted when player re-joins / game ends

    socket.leave(gameId);
    const rooms = socketGameRooms.get(socket.id) || [];
    socketGameRooms.set(socket.id, rooms.filter(r => r.gameId !== gameId));

    scheduleDisconnectForfeit(io, gameId, game, userId, socket);
  });

  // ── In-game chat ───────────────────────────────────────────────────────────
  socket.on('game:chat', (payload) => {
    const data = validateOrReject(schemas.chatSchema, payload, socket, 'game:chat');
    if (!data) return;
    const { gameId, message } = data;

    const game = GameStateCache.getLocal(gameId);
    if (!game || game.status !== 'active') return;
    if (game.whiteId !== userId && game.blackId !== userId) return;

    const text = message.trim();
    if (!text) return;

    socket.to(gameId).emit('game:chat', {
      username:  socket.username || 'Player',
      message:   text,
      timestamp: Date.now(),
    });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    // Cleanup Redis cooldown (fire-and-forget — key also auto-expires)
    MoveCooldownStore.del(userId).catch(() => {});

    // Cleanup activeGameSockets for all game rooms this socket was in
    const rooms = socketGameRooms.get(socket.id) || [];
    for (const { gameId } of rooms) {
      const sessionKey = `${gameId}:${userId}`;
      if (activeGameSockets.get(sessionKey) === socket.id) {
        activeGameSockets.delete(sessionKey);
      }
      // MoveTokenStore entries expire via TTL; explicitly clean up on disconnect
      MoveTokenStore.del(gameId, userId).catch(() => {});
    }
    socketGameRooms.delete(socket.id);

    // P2 FIX: Use already-captured `rooms` (O(1)) instead of O(n) full localMap scan.
    // `rooms` was captured before socketGameRooms.delete() above and still holds game IDs.
    for (const { gameId } of rooms) {
      const game = GameStateCache.getLocal(gameId);
      if (!game || game.status !== 'active') continue;
      scheduleDisconnectForfeit(io, gameId, game, userId, socket);
      break;
    }
  });
}

module.exports = {
  registerGameRoom,
  // Export the local Map reference for /health and /api/games/active
  // (Same Map object used internally by GameStateCache)
  gameCache: GameStateCache.localMap(),
  __testOnly: {
    deriveDisconnectResponsibility,
    computeFairnessOutcome,
  },
};

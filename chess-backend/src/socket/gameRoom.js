/**
 * Game room socket handlers — Server-Authoritative Chess Engine
 *
 * Security layers implemented:
 *  [1] Move rate limiting        — max 1 move per 500ms per user
 *  [2] Anti multi-tab            — hanya 1 socket aktif per user per game
 *  [3] Move nonce/token          — anti-replay: server issuer token per move
 *  [4] Move sequence counter     — nomor urut untuk forensics & audit trail
 *  [5] Full audit trail          — setiap move dicatat ke move_audit_log
 *  [6] Real-time anticheat       — analisis setiap 10 move selama game
 *  [7] Post-game enforcement     — trust score penalty + flag/suspend otomatis
 *  [8] ELO anomaly detection     — deteksi lonjakan ELO mencurigakan (async)
 *  [9] Stockfish background      — engine comparison setelah game (async)
 * [10] Turn validation           — server cek giliran, bukan trust client
 * [11] Server-authoritative FEN  — client tidak bisa manipulasi board state
 */

const crypto = require('crypto');
const os = require('os');
const { getRedisClient } = require('../lib/redis');
const { Chess } = require('chess.js');
const { games, users, wallets, transactions, notifications, eloHistory } = require('../lib/db');
const { calculateBothElo } = require('../lib/elo');
const {
  analyzeGame, analyzeRealtime, enforceAnticheat,
  detectEloAnomaly, runStockfishBackground, detectDisconnectAbuse,
} = require('../lib/anticheat');
const { netWinnings } = require('../lib/midtrans');
const { logMove, logSecurityEvent } = require('../lib/auditLog');
const { recordAndDetect, scoreFingerprintResult } = require('../lib/fingerprint');
const { runCollusionDetection } = require('../lib/collusion');
const INSTANCE_ID = `${os.hostname()}:${process.pid}`;
const GAME_LEASE_TTL_MS = 5000;
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

// ── Utility: async task with timeout ──────────────────────────────────────
function withTimeout(promise, ms, label) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
  );
  return Promise.race([promise, timeout]);
}

// ── In-memory state maps ───────────────────────────────────────────────────
// Map<gameId, GameState>
const gameCache = new Map();

// Map<gameId, setInterval> — clock timers
const timers = new Map();

// Map<`${gameId}:${userId}`, setTimeout> — disconnect forfeit timers
const disconnectTimers = new Map();

// [SECURITY-DISCONNECT] In-memory disconnect history for abuse detection
// Array of { userId, gameId, timestamp }
const disconnectHistory = [];

// [SECURITY-1] Rate limiting: Map<userId, lastMoveTimestamp>
const moveCooldowns = new Map();
const MOVE_COOLDOWN_MS = 500;

// [SECURITY-2] Anti multi-tab: Map<`${gameId}:${userId}`, socketId>
// Hanya 1 socket yang boleh aktif per user per game
const activeGameSockets = new Map();

// Reverse lookup untuk cleanup on disconnect: Map<socketId, {gameId, userId}[]>
const socketGameRooms = new Map();

// [SECURITY-3] Move nonce/token anti-replay: Map<`${gameId}:${userId}`, token>
// Server generates token after each move. Client must send correct token with next move.
// Token per-player agar tidak bocor ke lawan.
const moveTokens = new Map();

// Move sequence counter per game: Map<gameId, number>
// Dipakai untuk audit trail & forensics
const moveSequences = new Map();

// Helper: generate cryptographically random token
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

/**
 * Determine time control category from initial time in seconds.
 * Used to update the correct per-time-control ELO column.
 *
 * Bullet  : < 180s  (< 3 min)
 * Blitz   : 180-599s (3–9 min)
 * Rapid   : ≥ 600s   (≥ 10 min)
 */
function getTimeControlType(initial) {
  if (!initial) return 'blitz';           // fallback
  if (initial < 180) return 'bullet';
  if (initial < 600) return 'blitz';
  return 'rapid';
}

/**
 * Return the DB column name for the per-time-control ELO.
 * Maps to columns: elo_bullet, elo_blitz, elo_rapid
 */
function eloColumnForType(tcType) {
  return `elo_${tcType}`;
}

// ── Game state helpers ─────────────────────────────────────────────────────

async function getGameState(gameId) {
  if (gameCache.has(gameId)) return gameCache.get(gameId);

  const game = await games.findById(gameId);
  if (!game) return null;

  const state = {
    id: game.id,
    fen: game.fen,
    whiteTimeLeft: game.white_time_left,
    blackTimeLeft: game.black_time_left,
    moveHistory: game.move_history || [],
    status: game.status,
    whiteId: game.white_id,
    blackId: game.black_id,
    timeControl: game.time_control,
    stakes: game.stakes,
    whiteEloBefore: game.white_elo_before,
    blackEloBefore: game.black_elo_before,
    drawOfferedBy: null,
    lastMoveAt: Date.now(),
  };
  gameCache.set(gameId, state);
  moveSequences.set(gameId, (game.move_history || []).length); // resume dari move terakhir
  return state;
}

function updateGameState(gameId, updates) {
  const state = gameCache.get(gameId);
  if (state) Object.assign(state, updates);
}

// ── Clock ──────────────────────────────────────────────────────────────────

function startTimer(io, gameId) {
  if (timers.has(gameId)) return;

  const interval = setInterval(async () => {
    const hasLease = await acquireGameLease(gameId);
    if (!hasLease) return;
    const game = gameCache.get(gameId);
    if (!game || game.status !== 'active') {
      clearInterval(interval);
      timers.delete(gameId);
      return;
    }

    const turn = game.fen.split(' ')[1];

    if (turn === 'w') {
      const newTime = Math.max(0, game.whiteTimeLeft - 1);
      updateGameState(gameId, { whiteTimeLeft: newTime });
      emitToGameAndSpectators(io, gameId, 'game:clock', { whiteTimeLeft: newTime, blackTimeLeft: game.blackTimeLeft, turn: 'w' });
      if (newTime === 0) {
        clearInterval(interval);
        timers.delete(gameId);
        endGame(io, gameId, 'black', 'timeout');
      }
    } else {
      const newTime = Math.max(0, game.blackTimeLeft - 1);
      updateGameState(gameId, { blackTimeLeft: newTime });
      emitToGameAndSpectators(io, gameId, 'game:clock', { whiteTimeLeft: game.whiteTimeLeft, blackTimeLeft: newTime, turn: 'b' });
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

  const dcTimer = setTimeout(() => {
    acquireGameLease(gameId).then((hasLease) => {
      if (!hasLease) return;
    disconnectTimers.delete(dcKey);
    const currentGame = gameCache.get(gameId);
    if (!currentGame || currentGame.status !== 'active') return;

    const room = io.sockets.adapter.rooms.get(gameId);
    if (!room || room.size === 0) {
      stopTimer(gameId);
      const opponentId = game.whiteId === userId ? game.blackId : game.whiteId;
      const opponentHasPendingDc = disconnectTimers.has(`${gameId}:${opponentId}`);
      const responsibleUserId = deriveDisconnectResponsibility(userId, opponentHasPendingDc);
      endGame(io, gameId, 'draw', 'aborted', {
        responsibleUserId,
        finalizationSource: 'disconnect-timeout',
        disconnectSnapshot: {
          triggerUserId: userId,
          opponentUserId: opponentId,
          opponentHasPendingDc,
        },
      });
    } else {
      stopTimer(gameId);
      const winner = game.whiteId === userId ? 'black' : 'white';
      endGame(io, gameId, winner, 'disconnect', {
        responsibleUserId: userId,
        finalizationSource: 'disconnect-timeout',
        disconnectSnapshot: {
          triggerUserId: userId,
          roomSize: room.size,
        },
      });
    }
    }).catch(() => {});
  }, 60_000);

  disconnectTimers.set(dcKey, dcTimer);
}

// ── End Game ───────────────────────────────────────────────────────────────

async function endGame(io, gameId, winner, endReason, context = {}) {
  const game = gameCache.get(gameId);
  if (!game || game.status !== 'active') return;
  const reasonBase = String(endReason || '').split('|')[0];
  const responsibleUserId = context?.responsibleUserId || null;
  const finalizationSource = context?.finalizationSource || 'normal';
  const disconnectSnapshot = context?.disconnectSnapshot || null;

  // Cross-instance guard: claim finalization only if DB still active.
  const claimed = await games.updateIfStatus(gameId, 'active', {
    status: 'finishing',
    end_reason: reasonBase,
    responsible_user_id: responsibleUserId,
    fairness_outcome: reasonBase === 'aborted' || reasonBase === 'disconnect' ? 'no_contest_candidate' : 'normal',
    updated_at: new Date(),
  }).catch((e) => {
    console.error('[endGame:claim]', e);
    return null;
  });
  if (!claimed) {
    logSecurityEvent('DUPLICATE_FINALIZE_ATTEMPT', { gameId, winner, endReason: reasonBase });
    return;
  }

  // Mark in-memory as non-active to prevent re-entry in this process.
  updateGameState(gameId, { status: 'finishing' });

  try {
    const whiteUser = await users.findById(game.whiteId);
    const blackUser = await users.findById(game.blackId);
    if (!whiteUser || !blackUser) return;

    // Competitive fairness: games that are aborted before meaningful play
    // should not affect ELO, W/L/D stats, or game economy.
    const moveCount = game.moveHistory?.length || 0;
    const {
      isNoContest,
      finalEndReason,
      fairnessOutcome,
    } = computeFairnessOutcome(reasonBase, moveCount, responsibleUserId);

    if (isNoContest) {
      logSecurityEvent('NO_CONTEST_RECORDED', { gameId, reason: reasonBase, responsibleUserId });
      if (game.stakes > 0) {
        await Promise.all([
          wallets.unlock(game.whiteId, game.stakes).catch(() => {}),
          wallets.unlock(game.blackId, game.stakes).catch(() => {}),
        ]);
      }

      await games.update(gameId, {
        status: 'cancelled',
        winner: null,
        end_reason: finalEndReason,
        responsible_user_id: responsibleUserId,
        fairness_outcome: fairnessOutcome,
        fairness_context: {
          finalizationSource,
          disconnectSnapshot,
        },
        fen: game.fen,
        move_history: game.moveHistory,
        white_time_left: game.whiteTimeLeft,
        black_time_left: game.blackTimeLeft,
        ended_at: new Date(),
      });

      emitToGameAndSpectators(io, gameId, 'game:over', {
        gameId,
        winner: 'draw',
        endReason: reasonBase,
        cancelled: true,
        eloChanges: {
          [game.whiteId]: 0,
          [game.blackId]: 0,
        },
        whiteElo: whiteUser.elo,
        blackElo: blackUser.elo,
        stakes: game.stakes,
      });

      const cleanupNoContestTimer = setTimeout(() => {
        gameCache.delete(gameId);
        moveSequences.delete(gameId);
      }, 300_000);
      if (typeof cleanupNoContestTimer.unref === 'function') cleanupNoContestTimer.unref();

      if (process.env.NODE_ENV !== 'test') {
        console.log(`[Game] ${gameId} ended as no-contest (${finalEndReason})`);
      }
      return;
    }

    const eloResult = winner === 'draw' ? 'draw' : winner === 'white' ? 'white' : 'black';

    // Determine time control type and per-TC ELO column
    const tcType   = getTimeControlType(game.timeControl?.initial);
    const eloCol   = eloColumnForType(tcType);   // e.g. 'elo_bullet'

    // Use per-TC ELO if available, otherwise fall back to stored eloBefore → then global elo
    const whiteEloBefore = game.whiteEloBefore
      || whiteUser[eloCol]
      || whiteUser.elo;
    const blackEloBefore = game.blackEloBefore
      || blackUser[eloCol]
      || blackUser.elo;

    const { whiteChange, blackChange } = calculateBothElo(
      whiteEloBefore,
      blackEloBefore,
      eloResult,
      whiteUser.games_played ?? 30,
      blackUser.games_played ?? 30
    );

    const newWhiteEloTc = Math.max(100, whiteEloBefore + whiteChange);
    const newBlackEloTc = Math.max(100, blackEloBefore + blackChange);

    // Main ELO (global) is also updated — keeps leaderboard consistent.
    // It follows the same per-TC calculation so ratings don't diverge wildly.
    const newWhiteElo = newWhiteEloTc;
    const newBlackElo = newBlackEloTc;

    // Update user stats + per-TC ELO column
    await Promise.all([
      users.update(game.whiteId, {
        elo: newWhiteElo,
        [eloCol]: newWhiteEloTc,
        games_played: (whiteUser.games_played || 0) + 1,
        wins: (whiteUser.wins || 0) + (winner === 'white' ? 1 : 0),
        losses: (whiteUser.losses || 0) + (winner === 'black' ? 1 : 0),
        draws: (whiteUser.draws || 0) + (winner === 'draw' ? 1 : 0),
      }),
      users.update(game.blackId, {
        elo: newBlackElo,
        [eloCol]: newBlackEloTc,
        games_played: (blackUser.games_played || 0) + 1,
        wins: (blackUser.wins || 0) + (winner === 'black' ? 1 : 0),
        losses: (blackUser.losses || 0) + (winner === 'white' ? 1 : 0),
        draws: (blackUser.draws || 0) + (winner === 'draw' ? 1 : 0),
      }),
    ]);

    // Handle stakes — atomic unlock and transfer via single DB transaction
    if (game.stakes > 0) {
      const { fee } = netWinnings(game.stakes * 2);
      const winnerId = winner === 'white' ? game.whiteId : winner === 'black' ? game.blackId : null;
      const loserId  = winner === 'white' ? game.blackId : winner === 'black' ? game.whiteId : null;

      // Atomic: unlock both + debit loser + credit winner in single PG transaction.
      // Prevents partial-payout if process crashes mid-sequence.
      await wallets.settleGamePayout(
        winnerId,
        loserId,
        game.whiteId,
        game.blackId,
        game.stakes,
        fee,
      );

      if (winner !== 'draw') {
        const winnerUser = winner === 'white' ? whiteUser : blackUser;
        const loserUser  = winner === 'white' ? blackUser : whiteUser;

        await transactions.create({
          user_id: winnerId, type: 'game-win', amount: game.stakes - fee,
          status: 'completed',
          description: `Won vs ${loserUser.username} (+${game.stakes - fee} after ${fee} fee)`,
          game_id: gameId,
        });
        await transactions.create({
          user_id: loserId, type: 'game-loss', amount: -game.stakes,
          status: 'completed',
          description: `Lost vs ${winnerUser.username}`,
          game_id: gameId,
        });
      } else {
        await transactions.create({
          user_id: game.whiteId, type: 'game-draw', amount: 0,
          status: 'completed', description: `Draw vs ${blackUser.username}`, game_id: gameId,
        });
        await transactions.create({
          user_id: game.blackId, type: 'game-draw', amount: 0,
          status: 'completed', description: `Draw vs ${whiteUser.username}`, game_id: gameId,
        });
      }
    }

    // [SECURITY-7/8/9] Anti-cheat analysis — fast sync + async background
    let anticheatFlags = [];
    try {
      // Layer 1-3: Timing + integrity + blunder-rate (fast, sync)
      const anticheatResult = analyzeGame({ move_history: game.moveHistory });

      if (anticheatResult.white.suspicious) {
        anticheatFlags.push({ color: 'white', flags: anticheatResult.white.flags, score: anticheatResult.white.score });
        await withTimeout(enforceAnticheat(game.whiteId, gameId, anticheatResult.white, io), 30_000, 'enforceAnticheat:white');
      }
      if (anticheatResult.black.suspicious) {
        anticheatFlags.push({ color: 'black', flags: anticheatResult.black.flags, score: anticheatResult.black.score });
        await withTimeout(enforceAnticheat(game.blackId, gameId, anticheatResult.black, io), 30_000, 'enforceAnticheat:black');
      }

      // Layer 4: ELO anomaly detection (async, non-blocking)
      const allSyncFlags = [
        ...anticheatResult.white.flags,
        ...anticheatResult.black.flags,
      ];
      withTimeout(Promise.all([
        detectEloAnomaly(game.whiteId, {
          playerElo:   game.whiteEloBefore || whiteUser.elo,
          opponentElo: game.blackEloBefore || blackUser.elo,
          result:      winner === 'white' ? 'win' : winner === 'black' ? 'loss' : 'draw',
        }),
        detectEloAnomaly(game.blackId, {
          playerElo:   game.blackEloBefore || blackUser.elo,
          opponentElo: game.whiteEloBefore || whiteUser.elo,
          result:      winner === 'black' ? 'win' : winner === 'white' ? 'loss' : 'draw',
        }),
      ]), 30_000, 'detectEloAnomaly').then(async ([whiteEloResult, blackEloResult]) => {
        if (whiteEloResult.suspicious) {
          await withTimeout(enforceAnticheat(game.whiteId, gameId, whiteEloResult, io), 30_000, 'enforceAnticheat:elo:white');
        }
        if (blackEloResult.suspicious) {
          await withTimeout(enforceAnticheat(game.blackId, gameId, blackEloResult, io), 30_000, 'enforceAnticheat:elo:black');
        }
      }).catch(e => console.error('[ELO-anomaly background]', e.message));

      // Layer 5: Stockfish comparison (async, background, only if already suspicious)
      withTimeout(runStockfishBackground(gameId, game.moveHistory, allSyncFlags, io), 120_000, 'stockfishBackground')
        .catch(e => console.error('[Stockfish background error]', e.message));

      // Layer 6: Collusion detection (async, background, pair + material gifting)
      withTimeout(runCollusionDetection(
        gameId,
        game.whiteId,
        game.blackId,
        game.moveHistory,
        winner,
        endReason
      ), 30_000, 'collusionDetection').then(async (collusionResult) => {
        if (collusionResult.white.suspicious) {
          await withTimeout(enforceAnticheat(game.whiteId, gameId, collusionResult.white, io), 30_000, 'enforceAnticheat:collusion:white');
        }
        if (collusionResult.black.suspicious) {
          await withTimeout(enforceAnticheat(game.blackId, gameId, collusionResult.black, io), 30_000, 'enforceAnticheat:collusion:black');
        }
      }).catch(e => console.error('[Collusion background error]', e.message));

    } catch (anticheatErr) {
      console.error('[anticheat/error]', anticheatErr);
    }

    // Cleanup move tokens untuk game ini
    moveTokens.delete(`${gameId}:${game.whiteId}`);
    moveTokens.delete(`${gameId}:${game.blackId}`);

    // Persist game to DB
    await games.update(gameId, {
      status: 'finished',
      winner,
      end_reason: finalEndReason,
      responsible_user_id: responsibleUserId,
      fairness_outcome: 'normal',
      fairness_context: {
        finalizationSource,
        disconnectSnapshot,
      },
      fen: game.fen,
      move_history: game.moveHistory,
      white_elo_after: newWhiteElo,
      black_elo_after: newBlackElo,
      white_time_left: game.whiteTimeLeft,
      black_time_left: game.blackTimeLeft,
      ended_at: new Date(),
      anticheat_flags: anticheatFlags,
    });

    // Record ELO history
    await Promise.all([
      eloHistory.create(game.whiteId, game.whiteEloBefore || whiteUser.elo, newWhiteElo, gameId),
      eloHistory.create(game.blackId, game.blackEloBefore || blackUser.elo, newBlackElo, gameId),
    ]);

    // Send notifications
    const winnerName = winner === 'white' ? whiteUser.username : winner === 'black' ? blackUser.username : null;
    if (winner !== 'draw' && winnerName) {
      const winnerId = winner === 'white' ? game.whiteId : game.blackId;
      const loserId  = winner === 'white' ? game.blackId : game.whiteId;
      const loserName = winner === 'white' ? blackUser.username : whiteUser.username;
      await notifications.create(winnerId, 'game_result', 'You won!',
        `Checkmate! You beat ${loserName}. ELO: +${winner === 'white' ? whiteChange : blackChange}`);
      await notifications.create(loserId, 'game_result', 'Game over',
        `You lost to ${winnerName}. ELO: ${winner === 'white' ? blackChange : whiteChange}`);
    }

    // Emit game over
    emitToGameAndSpectators(io, gameId, 'game:over', {
      gameId, winner, endReason: reasonBase,
      eloChanges: {
        [game.whiteId]: whiteChange,
        [game.blackId]: blackChange,
      },
      whiteElo: newWhiteElo,
      blackElo: newBlackElo,
      stakes: game.stakes,
    });

    // Push real-time wallet update
    try {
      const [whiteBal, blackBal] = await Promise.all([
        wallets.getBalance(game.whiteId),
        wallets.getBalance(game.blackId),
      ]);
      io.to(game.whiteId).emit('wallet:update', { balance: whiteBal.balance, locked: whiteBal.locked });
      io.to(game.blackId).emit('wallet:update', { balance: blackBal.balance, locked: blackBal.locked });
    } catch (e) { console.error('[endGame wallet:update]', e); }

    // Push notifications update
    try {
      const [whiteNotifs, blackNotifs] = await Promise.all([
        notifications.getUnread(game.whiteId),
        notifications.getUnread(game.blackId),
      ]);
      if (whiteNotifs.length) io.to(game.whiteId).emit('notification:new', { notifications: whiteNotifs });
      if (blackNotifs.length) io.to(game.blackId).emit('notification:new', { notifications: blackNotifs });
    } catch (e) { console.error('[endGame notification:new]', e); }

    // Push user stats update (includes per-TC ELO for client display)
    io.to(game.whiteId).emit('user:stats', {
      elo: newWhiteElo,
      [eloCol]: newWhiteEloTc,
      tcType,
      wins:   (whiteUser.wins   || 0) + (winner === 'white' ? 1 : 0),
      losses: (whiteUser.losses || 0) + (winner === 'black' ? 1 : 0),
      draws:  (whiteUser.draws  || 0) + (winner === 'draw'  ? 1 : 0),
    });
    io.to(game.blackId).emit('user:stats', {
      elo: newBlackElo,
      [eloCol]: newBlackEloTc,
      tcType,
      wins:   (blackUser.wins   || 0) + (winner === 'black' ? 1 : 0),
      losses: (blackUser.losses || 0) + (winner === 'white' ? 1 : 0),
      draws:  (blackUser.draws  || 0) + (winner === 'draw'  ? 1 : 0),
    });

    // Cleanup setelah 5 menit (beri waktu untuk reconnect & view result)
    const cleanupFinishedGameTimer = setTimeout(() => {
      gameCache.delete(gameId);
      moveSequences.delete(gameId);
    }, 300_000);
    if (typeof cleanupFinishedGameTimer.unref === 'function') cleanupFinishedGameTimer.unref();

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[Game] ${gameId} ended — winner: ${winner} (${endReason})`);
    }
  } catch (err) {
    console.error('[endGame]', err);
  }
}

// ── Register Handlers ──────────────────────────────────────────────────────

function registerGameRoom(io, socket, userId) {

  // ── Join game room ─────────────────────────────────────────────────────
  socket.on('game:join', async ({ gameId }) => {
    try {
      const game = await getGameState(gameId);
      if (!game) return socket.emit('error', { message: 'Game not found' });
      if (game.whiteId !== userId && game.blackId !== userId) {
        return socket.emit('error', { message: 'Not a player in this game' });
      }

      // [SECURITY-2] Anti multi-tab: hanya 1 socket aktif per user per game
      const sessionKey = `${gameId}:${userId}`;
      const existingSocketId = activeGameSockets.get(sessionKey);

      if (existingSocketId && existingSocketId !== socket.id) {
        const existingSocket = io.sockets.sockets.get(existingSocketId);
        if (existingSocket) {
          logSecurityEvent('MULTI_TAB_ATTEMPT', { userId, gameId, oldSocketId: existingSocketId, newSocketId: socket.id });
          // Kirim notifikasi ke tab lama bahwa sesi telah dipindahkan
          existingSocket.emit('session:displaced', {
            message: 'Sesi game kamu dibuka di tab/perangkat lain. Tab ini tidak aktif lagi.',
          });
          // Lepaskan socket lama dari room game (tapi jangan disconnect total)
          existingSocket.leave(gameId);
          // Hapus dari socketGameRooms
          const oldRooms = socketGameRooms.get(existingSocketId) || [];
          socketGameRooms.set(existingSocketId, oldRooms.filter(r => r.gameId !== gameId));
        }
      }

      // Daftarkan socket baru sebagai socket aktif untuk session ini
      activeGameSockets.set(sessionKey, socket.id);

      // Track rooms yang diikuti socket ini untuk cleanup on disconnect
      const currentRooms = socketGameRooms.get(socket.id) || [];
      if (!currentRooms.find(r => r.gameId === gameId)) {
        currentRooms.push({ gameId, userId });
        socketGameRooms.set(socket.id, currentRooms);
      }

      socket.join(gameId);

      // Cancel pending disconnect forfeit
      const dcKey = `${gameId}:${userId}`;
      const dcTimer = disconnectTimers.get(dcKey);
      if (dcTimer) {
        clearTimeout(dcTimer);
        disconnectTimers.delete(dcKey);
        socket.to(gameId).emit('opponent:reconnected', { userId });
      }

      // Start timer ketika kedua player sudah ada di room
      const room = io.sockets.adapter.rooms.get(gameId);
      const whiteSocketId = activeGameSockets.get(`${gameId}:${game.whiteId}`);
      const blackSocketId = activeGameSockets.get(`${gameId}:${game.blackId}`);
      const hasBothPlayersInRoom = !!(
        room &&
        whiteSocketId &&
        blackSocketId &&
        room.has(whiteSocketId) &&
        room.has(blackSocketId)
      );
      if (hasBothPlayersInRoom && game.status === 'active') {
        startTimer(io, gameId);
      }

      // [SECURITY-3] Generate initial move token for this player
      const tokenKey    = `${gameId}:${userId}`;
      const initialToken = generateMoveToken();
      moveTokens.set(tokenKey, initialToken);

      // [SECURITY-10] IP/Device fingerprinting — detect multi-account
      recordAndDetect(socket, userId, gameId).then(async (fpResult) => {
        if (fpResult.isMultiAccount) {
          const fpScore = scoreFingerprintResult(fpResult);
          logSecurityEvent('MULTI_ACCOUNT_DETECTED', {
            userId, gameId,
            sharedWith: fpResult.suspectedUserIds,
            fingerprintHash: fpResult.fingerprintHash.slice(0, 12) + '…',
          });
          // Enforce anticheat untuk multi-account (async, non-blocking)
          enforceAnticheat(userId, gameId, fpScore, io).catch(e =>
            console.error('[Fingerprint:enforce]', e.message)
          );
        }
      }).catch(e => console.error('[Fingerprint:detect]', e.message));

      socket.emit('game:state', {
        gameId,
        fen: game.fen,
        moveHistory: game.moveHistory,
        whiteTimeLeft: game.whiteTimeLeft,
        blackTimeLeft: game.blackTimeLeft,
        status: game.status,
        playerColor: game.whiteId === userId ? 'white' : 'black',
        nextMoveToken: initialToken,  // Client harus kirim ini dengan move pertama
      });

      socket.to(gameId).emit('opponent:connected', { userId });
      console.log(`[Room] ${userId} joined game ${gameId} (socket: ${socket.id})`);
    } catch (err) {
      console.error('[game:join]', err);
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  // ── Make a move ────────────────────────────────────────────────────────
  socket.on('game:move', ({ gameId, from, to, promotion, moveToken }) => {
    const serverTs = Date.now();
    const game = gameCache.get(gameId);

    if (!game || game.status !== 'active') {
      return socket.emit('move:invalid', { reason: 'Game not active' });
    }

    // [SECURITY-2] Pastikan socket ini adalah socket yang terdaftar untuk game ini
    const sessionKey = `${gameId}:${userId}`;
    const registeredSocketId = activeGameSockets.get(sessionKey);
    if (registeredSocketId && registeredSocketId !== socket.id) {
      logSecurityEvent('UNAUTHORIZED_MOVE_ATTEMPT', {
        userId, gameId,
        attemptingSocket: socket.id,
        registeredSocket: registeredSocketId,
      });
      return socket.emit('move:invalid', { reason: 'Session tidak valid. Refresh halaman.' });
    }

    // [SECURITY-1] Rate limiting: max 1 move per 500ms per user
    const lastMoveTs = moveCooldowns.get(userId) || 0;
    if (serverTs - lastMoveTs < MOVE_COOLDOWN_MS) {
      logSecurityEvent('RATE_LIMIT_HIT', { userId, gameId, timeSinceLast: serverTs - lastMoveTs });
      return socket.emit('move:invalid', { reason: 'Terlalu cepat. Tunggu sebentar.' });
    }

    // [SECURITY-3] Move nonce/token — STRICT enforcement
    // Setiap move WAJIB menyertakan token yang valid.
    // Token diisi server saat game:join — jika tidak ada berarti player bypass join flow.
    const tokenKey      = `${gameId}:${userId}`;
    const expectedToken = moveTokens.get(tokenKey);

    if (!expectedToken) {
      // Tidak ada token yang pernah diterbitkan → session mencurigakan
      logSecurityEvent('NO_TOKEN_ISSUED', {
        userId, gameId, providedToken: moveToken || '(none)',
        seq: moveSequences.get(gameId) || 0,
      });
      return socket.emit('move:invalid', {
        reason: 'Session tidak valid. Mohon refresh dan join ulang.',
        requestTokenRefresh: true,
      });
    }

    if (moveToken !== expectedToken) {
      // Token dikirim tapi salah → kemungkinan replay attack
      logSecurityEvent('INVALID_MOVE_TOKEN', {
        userId, gameId,
        provided: moveToken || '(none)',
        expected: expectedToken,
        seq:      moveSequences.get(gameId) || 0,
      });
      return socket.emit('move:invalid', {
        reason: 'Token tidak valid. Kemungkinan replay attack atau session expired.',
        requestTokenRefresh: true,
      });
    }

    // [SECURITY-7] Turn validation — server cek giliran, bukan percaya client
    const isWhite = game.whiteId === userId;
    const isBlack = game.blackId === userId;
    const turn = game.fen.split(' ')[1];
    if ((turn === 'w' && !isWhite) || (turn === 'b' && !isBlack)) {
      return socket.emit('move:invalid', { reason: 'Not your turn' });
    }

    // [SECURITY-8] Server-authoritative move validation via chess.js
    const chess = new Chess(game.fen);
    let move;
    try {
      move = chess.move({ from, to, promotion: promotion || 'q' });
    } catch {
      return socket.emit('move:invalid', { reason: 'Illegal move' });
    }
    if (!move) return socket.emit('move:invalid', { reason: 'Illegal move' });

    // Move diterima — update rate limit cooldown + generate token baru
    moveCooldowns.set(userId, serverTs);

    // [SECURITY-3] Generate next token & kirim HANYA ke player yang baru saja move
    // (bukan broadcast ke room — agar lawan tidak tahu token)
    const newToken = generateMoveToken();
    moveTokens.set(tokenKey, newToken);
    socket.emit('move:token', { nextMoveToken: newToken });

    // Update clock dengan increment
    const increment = game.timeControl?.increment || 0;
    let { whiteTimeLeft, blackTimeLeft } = game;
    if (turn === 'w') whiteTimeLeft = Math.min(whiteTimeLeft + increment, (game.timeControl?.initial || 600) * 2);
    else blackTimeLeft = Math.min(blackTimeLeft + increment, (game.timeControl?.initial || 600) * 2);

    // Hitung waktu yang dipakai untuk move ini (bagi audit trail)
    const timeTakenMs = game.lastMoveAt ? serverTs - game.lastMoveAt : 0;

    // [SECURITY-3] Move sequence counter
    const currentSeq = (moveSequences.get(gameId) || 0) + 1;
    moveSequences.set(gameId, currentSeq);

    const moveRecord = {
      san: move.san,
      from: move.from,
      to: move.to,
      flags: move.flags,          // needed by client for sound selection
      piece: move.piece,
      captured: move.captured,
      promotion: move.promotion,
      timestamp: serverTs,        // timestamp server, bukan client
      whiteTimeLeft,
      blackTimeLeft,
      seq: currentSeq,            // nomor urut untuk audit trail
    };

    const newMoveHistory = [...game.moveHistory, moveRecord];

    updateGameState(gameId, {
      fen: chess.fen(),
      moveHistory: newMoveHistory,
      whiteTimeLeft,
      blackTimeLeft,
      lastMoveAt: serverTs,
    });

    // [SECURITY-4] Audit trail — log setiap move yang diterima
    logMove({
      gameId,
      userId,
      moveSeq:    currentSeq,
      san:        move.san,
      from:       move.from,
      to:         move.to,
      fenAfter:   chess.fen(),
      timeTakenMs,
      timeLeft:   isWhite ? whiteTimeLeft : blackTimeLeft,
      serverTs,
    });

    // Broadcast move ke kedua player
    emitToGameAndSpectators(io, gameId, 'game:move', {
      move: moveRecord,
      fen: chess.fen(),
      whiteTimeLeft,
      blackTimeLeft,
    });

    // Persist live snapshot so active game can recover after process restart.
    games.update(gameId, {
      fen: chess.fen(),
      move_history: newMoveHistory,
      white_time_left: whiteTimeLeft,
      black_time_left: blackTimeLeft,
      updated_at: new Date(),
    }).catch((e) => console.error('[game:move persist]', e));

    // [SECURITY-5] Real-time anticheat: every 10 moves for blitz/rapid, every 20 for bullet
    const tcType = getTimeControlType(game.timeControl?.initial);
    const anticheatInterval = tcType === 'bullet' ? 20 : 10;
    if (newMoveHistory.length > 0 && newMoveHistory.length % anticheatInterval === 0) {
      try {
        const realtimeResult = analyzeRealtime(newMoveHistory);
        const checks = [
          { color: 'white', user: game.whiteId, result: realtimeResult.white },
          { color: 'black', user: game.blackId, result: realtimeResult.black },
        ];
        for (const check of checks) {
          if (check.result && check.result.suspicious) {
            console.warn(`[ANTICHEAT:REALTIME] Suspicious pattern for ${check.user} (${check.color}) at move ${currentSeq}:`, check.result.flags);
            // Kirim peringatan diam-diam ke admin (via log) — jangan alert player agar tidak tip off
            logSecurityEvent('REALTIME_SUSPICIOUS', {
              userId: check.user,
              gameId,
              moveSeq: currentSeq,
              color: check.color,
              flags: check.result.flags,
              score: check.result.score,
              stats: check.result.stats,
            });
          }
        }
      } catch (e) {
        console.error('[anticheat:realtime]', e);
      }
    }

    // Cek kondisi akhir game
    if (chess.isCheckmate()) {
      stopTimer(gameId);
      endGame(io, gameId, turn === 'w' ? 'white' : 'black', 'checkmate');
    } else if (chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
      stopTimer(gameId);
      const reason = chess.isStalemate()          ? 'stalemate'
        : chess.isThreefoldRepetition()           ? 'repetition'
        : chess.isInsufficientMaterial()          ? 'insufficient'
        : 'fifty-move';
      endGame(io, gameId, 'draw', reason);
    }
  });

  // ── [SECURITY] Tab-switching report ───────────────────────────────────
  // Client reports when the game tab is hidden (potential engine use window).
  // Server logs the event; cumulative hidden time > 30s per game is flagged.
  socket.on('game:tab-hidden', ({ gameId, hiddenMs, totalHiddenMs }) => {
    const game = gameCache.get(gameId);
    if (!game || game.status !== 'active') return;
    if (game.whiteId !== userId && game.blackId !== userId) return;

    // Sanity-check values (client could lie — log anyway, enforce only on excess)
    const safeHiddenMs    = Math.max(0, Math.min(Number(hiddenMs)      || 0, 3_600_000));
    const safeTotalHidden = Math.max(0, Math.min(Number(totalHiddenMs) || 0, 3_600_000));

    logSecurityEvent('TAB_HIDDEN', {
      userId,
      gameId,
      hiddenMs:      safeHiddenMs,
      totalHiddenMs: safeTotalHidden,
    });

    // Escalate if total hidden time exceeds 30 seconds in one game
    if (safeTotalHidden >= 30_000) {
      logSecurityEvent('TAB_HIDDEN_EXCESSIVE', {
        userId, gameId, totalHiddenMs: safeTotalHidden,
      });
      // Apply a light trust penalty (non-suspension — may be innocent AFK)
      enforceAnticheat(userId, gameId, {
        flags: [`TAB_HIDDEN:${Math.round(safeTotalHidden / 1000)}s`],
        score: Math.min(30, Math.floor(safeTotalHidden / 10_000) * 5),
      }, io).catch(e => console.error('[TabHidden:enforce]', e.message));
    }
  });

  // ── Resign ─────────────────────────────────────────────────────────────
  socket.on('game:resign', ({ gameId }) => {
    const game = gameCache.get(gameId);
    if (!game || game.status !== 'active') return;
    if (game.whiteId !== userId && game.blackId !== userId) return;

    stopTimer(gameId);
    const winner = game.whiteId === userId ? 'black' : 'white';
    endGame(io, gameId, winner, 'resign');
  });

  // ── Draw offer / accept / decline ──────────────────────────────────────
  socket.on('game:draw-offer', ({ gameId }) => {
    const game = gameCache.get(gameId);
    if (!game || game.status !== 'active') return;
    // [SECURITY] Only a player in this game can offer a draw
    if (game.whiteId !== userId && game.blackId !== userId) return;
    updateGameState(gameId, { drawOfferedBy: userId });
    socket.to(gameId).emit('game:draw-offered', { by: userId });
  });

  socket.on('game:draw-accept', ({ gameId }) => {
    const game = gameCache.get(gameId);
    if (!game || game.status !== 'active' || !game.drawOfferedBy) return;
    // [SECURITY-BUG-FIX] Only the OTHER player (not the offerer) can accept
    if (game.drawOfferedBy === userId) {
      logSecurityEvent('DRAW_SELF_ACCEPT_ATTEMPT', { userId, gameId });
      return socket.emit('error', { message: 'Cannot accept your own draw offer.' });
    }
    // [SECURITY] Only a player in this game can accept
    if (game.whiteId !== userId && game.blackId !== userId) return;
    stopTimer(gameId);
    endGame(io, gameId, 'draw', 'draw-agreement');
  });

  socket.on('game:draw-decline', ({ gameId }) => {
    const game = gameCache.get(gameId);
    if (!game || game.status !== 'active') return;
    // [SECURITY-BUG-FIX] Only a player in this game can decline; offerer cannot decline (must withdraw)
    if (game.whiteId !== userId && game.blackId !== userId) return;
    if (game.drawOfferedBy === userId) {
      // Offerer withdrawing their own offer is allowed
    }
    updateGameState(gameId, { drawOfferedBy: null });
    socket.to(gameId).emit('game:draw-declined');
  });

  // ── Leave game room explicitly (without disconnecting whole socket) ─────
  socket.on('game:leave', ({ gameId }) => {
    const game = gameCache.get(gameId);
    if (!game || game.status !== 'active') return;
    if (game.whiteId !== userId && game.blackId !== userId) return;

    const sessionKey = `${gameId}:${userId}`;
    if (activeGameSockets.get(sessionKey) === socket.id) {
      activeGameSockets.delete(sessionKey);
    }
    moveTokens.delete(sessionKey);

    socket.leave(gameId);
    const rooms = socketGameRooms.get(socket.id) || [];
    socketGameRooms.set(socket.id, rooms.filter(r => r.gameId !== gameId));

    scheduleDisconnectForfeit(io, gameId, game, userId, socket);
  });

  // ── In-game chat ────────────────────────────────────────────────────────
  socket.on('game:chat', ({ gameId, message }) => {
    const game = gameCache.get(gameId);
    if (!game || game.status !== 'active') return;
    if (game.whiteId !== userId && game.blackId !== userId) return;
    const text = typeof message === 'string' ? message.trim().slice(0, 200) : '';
    if (!text) return;
    socket.to(gameId).emit('game:chat', {
      username: socket.username || 'Player',
      message: text,
      timestamp: Date.now(),
    });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    // Cleanup rate limit cooldown entry
    moveCooldowns.delete(userId);

    // Cleanup activeGameSockets + moveTokens untuk semua game room socket ini
    const rooms = socketGameRooms.get(socket.id) || [];
    for (const { gameId } of rooms) {
      const sessionKey = `${gameId}:${userId}`;
      // Hapus hanya jika socket ini adalah yang terdaftar
      if (activeGameSockets.get(sessionKey) === socket.id) {
        activeGameSockets.delete(sessionKey);
      }
      // Cleanup token — token akan di-generate ulang saat reconnect via game:join
      moveTokens.delete(sessionKey);
    }
    socketGameRooms.delete(socket.id);

    // Forfeit timer untuk game yang sedang aktif
    for (const [gameId, game] of gameCache.entries()) {
      if (game.status !== 'active') continue;
      if (game.whiteId !== userId && game.blackId !== userId) continue;

      scheduleDisconnectForfeit(io, gameId, game, userId, socket);
      break;
    }
  });
}

module.exports = {
  registerGameRoom,
  gameCache,
  __testOnly: {
    deriveDisconnectResponsibility,
    computeFairnessOutcome,
  },
};

/**
 * Matchmaking socket handlers
 * Events: queue:join, queue:leave → game:found
 * Uses Supabase DB for persistence, in-memory queue for speed
 */

const { users, wallets, games } = require('../lib/db');
const { unlockForUser, recordLock } = require('../lib/walletCleanup');

// ── Time-control type helper (mirrors gameRoom.js) ─────────────────────────
function getTcType(initial) {
  if (!initial) return 'blitz';
  if (initial < 180) return 'bullet';
  if (initial < 600) return 'blitz';
  return 'rapid';
}

// In-memory queue: Map<queueKey, Array<{ userId, socketId, elo, joinedAt }>>
const queues = new Map();

function queueKey(timeControl, stakes) {
  return `${timeControl.initial}-${timeControl.increment}-${stakes || 0}`;
}

function registerMatchmaking(io, socket, userId) {
  // ── Join matchmaking queue ──────────────────────────────────────────────
  socket.on('queue:join', async ({ timeControl, stakes = 0, color }) => {
    try {
      const user = await users.findById(userId);
      if (!user) return socket.emit('error', { message: 'User not found' });

      // Check active game — don't allow joining queue while in a game
      const activeGame = await games.findActiveByUser(userId);
      if (activeGame) {
        return socket.emit('error', { message: 'You already have an active game' });
      }

      // Lock the stake atomically via DB RPC (avoids TOCTOU race condition).
      // The RPC raises an error if available balance < stakes.
      if (stakes > 0) {
        try {
          await wallets.lock(userId, stakes);
          recordLock(userId, stakes);
        } catch (lockErr) {
          return socket.emit('error', { message: 'Insufficient balance for this stake' });
        }
      }

      const key = queueKey(timeControl, stakes);
      if (!queues.has(key)) queues.set(key, []);
      const queue = queues.get(key);

      // Remove any existing entry for this user
      const existingIdx = queue.findIndex(e => e.userId === userId);
      if (existingIdx !== -1) queue.splice(existingIdx, 1);

      // Use per-TC ELO for pairing so bullet/blitz/rapid players match by their
      // relevant rating rather than a single global ELO
      const tcType  = getTcType(timeControl.initial);
      const tcElo   = user[`elo_${tcType}`] ?? user.elo;
      queue.push({ userId, socketId: socket.id, elo: tcElo, joinedAt: Date.now() });

      socket.emit('queue:joined', { queueKey: key, position: queue.length });
      console.log(`[Queue] ${user.username} (${user.elo}) joined: ${key}`);

      // Try pairing
      await tryPairPlayers(io, key, timeControl, stakes, color);
    } catch (err) {
      console.error('[queue:join]', err);
      socket.emit('error', { message: 'Failed to join queue' });
    }
  });

  // ── Leave queue ─────────────────────────────────────────────────────────
  socket.on('queue:leave', async ({ stakes = 0 } = {}) => {
    removeFromAllQueues(userId);
    // Unlock any locked stake for this user
    if (stakes > 0) {
      await unlockForUser(userId, stakes).catch(() => {});
    }
    socket.emit('queue:left');
  });

  // ── Clean up on disconnect ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    // Note: stake unlock on disconnect is handled by walletCleanup's timeout job.
    // We do a best-effort immediate unlock here if we know the stake amount.
    removeFromAllQueues(userId);
  });
}

async function tryPairPlayers(io, key, timeControl, stakes, preferredColor) {
  const queue = queues.get(key);
  if (!queue || queue.length < 2) return;

  // ELO-based pairing: find closest ELO match
  const now = Date.now();
  let bestPair = null;
  let bestDiff = Infinity;

  for (let i = 0; i < queue.length - 1; i++) {
    for (let j = i + 1; j < queue.length; j++) {
      const a = queue[i];
      const b = queue[j];

      // ELO range expands over time (±100 + 5 per second of waiting)
      const waitA = (now - a.joinedAt) / 1000;
      const waitB = (now - b.joinedAt) / 1000;
      const rangeA = 100 + waitA * 5;
      const rangeB = 100 + waitB * 5;
      const diff = Math.abs(a.elo - b.elo);

      if (diff <= Math.max(rangeA, rangeB) && diff < bestDiff) {
        bestDiff = diff;
        bestPair = [a, b];
      }
    }
  }

  if (!bestPair) return;

  const [p1, p2] = bestPair;

  // Remove both from queue
  const q = queues.get(key);
  queues.set(key, q.filter(e => e.userId !== p1.userId && e.userId !== p2.userId));

  // Assign colors
  const whiteIsP1 = preferredColor === 'white' || Math.random() > 0.5;
  const whiteEntry = whiteIsP1 ? p1 : p2;
  const blackEntry = whiteIsP1 ? p2 : p1;

  try {
    const whiteUser = await users.findById(whiteEntry.userId);
    const blackUser = await users.findById(blackEntry.userId);
    if (!whiteUser || !blackUser) return;

    // Store per-TC ELO as elo_before so endGame calculates rating changes
    // against the correct time-control-specific baseline
    const tcType = getTcType(timeControl.initial);
    const game = await games.create({
      white_id: whiteEntry.userId,
      black_id: blackEntry.userId,
      time_control: timeControl,
      stakes,
      white_elo_before: whiteUser[`elo_${tcType}`] ?? whiteUser.elo,
      black_elo_before: blackUser[`elo_${tcType}`] ?? blackUser.elo,
      white_time_left: timeControl.initial,
      black_time_left: timeControl.initial,
    });

    const gamePayload = {
      gameId: game.id,
      timeControl,
      stakes,
      white: {
        id: whiteEntry.userId,
        username: whiteUser.username,
        elo: whiteUser[`elo_${tcType}`] ?? whiteUser.elo,
        avatar_url: whiteUser.avatar_url,
        title: whiteUser.title,
      },
      black: {
        id: blackEntry.userId,
        username: blackUser.username,
        elo: blackUser[`elo_${tcType}`] ?? blackUser.elo,
        avatar_url: blackUser.avatar_url,
        title: blackUser.title,
      },
      fen: game.fen,
    };

    // Join both sockets to game room — abort if either has disconnected
    const whiteSocket = io.sockets.sockets.get(whiteEntry.socketId);
    const blackSocket = io.sockets.sockets.get(blackEntry.socketId);

    if (!whiteSocket || !blackSocket) {
      // At least one player disconnected between match and pairing; cancel game
      await games.update(game.id, { status: 'cancelled', end_reason: 'player-disconnected-before-start' });
      // Unlock stakes for both players
      if (stakes > 0) {
        await wallets.unlock(whiteEntry.userId, stakes).catch(() => {});
        await wallets.unlock(blackEntry.userId, stakes).catch(() => {});
      }
      // Re-enqueue the still-connected player
      if (whiteSocket) {
        const tcType = getTcType(timeControl.initial);
        const whiteUser = await users.findById(whiteEntry.userId);
        const tcElo = whiteUser?.[`elo_${tcType}`] ?? whiteUser?.elo ?? 1200;
        if (!queues.has(key)) queues.set(key, []);
        queues.get(key).push({ userId: whiteEntry.userId, socketId: whiteEntry.socketId, elo: tcElo, joinedAt: Date.now() });
        whiteSocket.emit('queue:joined', { queueKey: key, position: queues.get(key).length, reason: 'opponent-disconnected' });
      }
      if (blackSocket) {
        const tcType = getTcType(timeControl.initial);
        const blackUser = await users.findById(blackEntry.userId);
        const tcElo = blackUser?.[`elo_${tcType}`] ?? blackUser?.elo ?? 1200;
        if (!queues.has(key)) queues.set(key, []);
        queues.get(key).push({ userId: blackEntry.userId, socketId: blackEntry.socketId, elo: tcElo, joinedAt: Date.now() });
        blackSocket.emit('queue:joined', { queueKey: key, position: queues.get(key).length, reason: 'opponent-disconnected' });
      }
      return;
    }

    whiteSocket.join(game.id);
    blackSocket.join(game.id);

    // Notify both
    io.to(game.id).emit('game:found', gamePayload);

    console.log(`[Match] ${whiteUser.username} vs ${blackUser.username} — Game ${game.id} (stakes: ${stakes})`);
  } catch (err) {
    console.error('[matchmaking/pair]', err);
  }
}

function removeFromAllQueues(userId) {
  for (const [key, queue] of queues.entries()) {
    const idx = queue.findIndex(e => e.userId === userId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      console.log(`[Queue] Removed user ${userId} from ${key}`);
    }
  }
}

// Export queues for health endpoint
module.exports = { registerMatchmaking, queues };

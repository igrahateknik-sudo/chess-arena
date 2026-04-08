/**
 * Matchmaking socket handlers
 * Events: queue:join, queue:leave → game:found
 * Uses Supabase DB for persistence, in-memory queue for speed
 */

const { users, wallets, games } = require('../lib/db');
const { unlockForUser, recordLock } = require('../lib/walletCleanup');
const { getRedisClient } = require('../lib/redis');
const crypto = require('crypto');
const { logSecurityEvent } = require('../lib/auditLog');
const { getTimeControlType } = require('../lib/timeControl'); // M5: shared, no longer duplicated
const { schemas, validateOrReject } = require('./payloadSchemas'); // C5: Zod validation

// Alias to match existing call sites in this file
const getTcType = getTimeControlType;

// In-memory queue: Map<queueKey, Array<{ userId, socketId, elo, joinedAt }>>
const queues = new Map();
const pairingLocks = new Map();
const ABORT_RULE = {
  windowMinutes: 15,
  maxNoContest: 3,
  cooldownMinutes: 10,
};
const REDIS_LOCK_TTL_MS = 4000;

function queueKey(timeControl, stakes) {
  return `${timeControl.initial}-${timeControl.increment}-${stakes || 0}`;
}

function parseStakeFromQueueKey(key) {
  if (!key) return 0;
  const parts = String(key).split('-');
  const parsed = Number(parts[parts.length - 1] || 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

async function getQueuedStakeForUser(userId) {
  const client = await getRedisClient();
  if (client) {
    const qKey = await client.get(queueUserIndexKey(userId));
    return parseStakeFromQueueKey(qKey);
  }

  for (const [key, queue] of queues.entries()) {
    if (queue.some((e) => e.userId === userId)) {
      return parseStakeFromQueueKey(key);
    }
  }
  return 0;
}

async function withQueueLock(key, fn) {
  const prev = pairingLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  pairingLocks.set(key, prev.then(() => current));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (pairingLocks.get(key) === current) pairingLocks.delete(key);
  }
}

function queueRedisKey(key) {
  return `mm:queue:${key}`;
}
function queueEntryRedisKey(userId) {
  return `mm:queue:entry:${userId}`;
}
function queueUserIndexKey(userId) {
  return `mm:queue:user:${userId}`;
}

async function enqueuePlayer(key, entry) {
  const client = await getRedisClient();
  if (!client) {
    if (!queues.has(key)) queues.set(key, []);
    const queue = queues.get(key);
    const existingIdx = queue.findIndex(e => e.userId === entry.userId);
    if (existingIdx !== -1) queue.splice(existingIdx, 1);
    queue.push(entry);
    return queue.length;
  }
  const oldQueueKey = await client.get(queueUserIndexKey(entry.userId));
  if (oldQueueKey) {
    await client.zRem(queueRedisKey(oldQueueKey), entry.userId);
  }
  await client.zAdd(queueRedisKey(key), [{ score: entry.joinedAt, value: entry.userId }]);
  await client.hSet(queueEntryRedisKey(entry.userId), {
    socketId: entry.socketId,
    elo: String(entry.elo),
    joinedAt: String(entry.joinedAt),
    preferredColor: entry.preferredColor || 'random',
    queueKey: key,
  });
  await client.set(queueUserIndexKey(entry.userId), key);
  return await client.zCard(queueRedisKey(key));
}

async function dequeuePlayerFromAll(userId) {
  const client = await getRedisClient();
  if (!client) {
    removeFromAllQueues(userId);
    return;
  }
  const oldQueueKey = await client.get(queueUserIndexKey(userId));
  if (oldQueueKey) {
    await client.zRem(queueRedisKey(oldQueueKey), userId);
  }
  await client.del(queueEntryRedisKey(userId));
  await client.del(queueUserIndexKey(userId));
}

async function claimPairFromRedis(client, key, userIdA, userIdB) {
  const lua = `
    local queueKey = KEYS[1]
    local a = ARGV[1]
    local b = ARGV[2]
    local rankA = redis.call('zrank', queueKey, a)
    local rankB = redis.call('zrank', queueKey, b)
    if (not rankA) or (not rankB) then
      return 0
    end
    redis.call('zrem', queueKey, a)
    redis.call('zrem', queueKey, b)
    return 1
  `;
  const claimed = await client.eval(lua, { keys: [queueRedisKey(key)], arguments: [userIdA, userIdB] });
  return Number(claimed) === 1;
}

async function acquireDistributedPairingLock(key) {
  const client = await getRedisClient();
  if (!client) return { acquired: true, token: null };

  const lockKey = `mm:lock:${key}`;
  const token = crypto.randomBytes(12).toString('hex');
  const ok = await client.set(lockKey, token, { NX: true, PX: REDIS_LOCK_TTL_MS });
  if (ok !== 'OK') return { acquired: false, token: null };
  return { acquired: true, token };
}

async function releaseDistributedPairingLock(key, token) {
  if (!token) return;
  const client = await getRedisClient();
  if (!client) return;
  const lockKey = `mm:lock:${key}`;
  await client.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    { keys: [lockKey], arguments: [token] }
  ).catch(() => {});
}

function registerMatchmaking(io, socket, userId) {
  // ── Join matchmaking queue ──────────────────────────────────────────────
  socket.on('queue:join', async (payload) => {
    try {
      // C5: Validate payload with Zod schema (previously unvalidated raw destructuring)
      const parsed = validateOrReject(schemas.queueJoinSchema, payload, socket, 'queue:join');
      if (!parsed) return;
      const { timeControl, stakes = 0, color } = parsed;

      const user = await users.findById(userId);
      if (!user) {
        socket.emit('queue:error', { message: 'User not found' });
        return socket.emit('error', { message: 'User not found' });
      }

      // Check active game — don't allow joining queue while in a game
      const activeGame = await games.findActiveByUser(userId);
      if (activeGame) {
        socket.emit('queue:error', { message: 'You already have an active game' });
        return socket.emit('error', { message: 'You already have an active game' });
      }

      // Anti-abort abuse: if user repeatedly triggers no-contest games,
      // apply temporary queue cooldown.
      const since = new Date(Date.now() - ABORT_RULE.windowMinutes * 60_000).toISOString();
      const recentNoContest = await games.getRecentNoContestCount(userId, since);
      if (recentNoContest >= ABORT_RULE.maxNoContest) {
        const msg = `Terlalu sering game batal. Coba antre lagi dalam ${ABORT_RULE.cooldownMinutes} menit.`;
        socket.emit('queue:error', { message: msg, code: 'QUEUE_COOLDOWN_NO_CONTEST' });
        return socket.emit('error', { message: msg });
      }

      // Lock the stake atomically via DB RPC (avoids TOCTOU race condition).
      // The RPC raises an error if available balance < stakes.
      if (stakes > 0) {
        try {
          await wallets.lock(userId, stakes);
          recordLock(userId, stakes);
        } catch (lockErr) {
          socket.emit('queue:error', { message: 'Insufficient balance for this stake' });
          return socket.emit('error', { message: 'Insufficient balance for this stake' });
        }
      }

      const key = queueKey(timeControl, stakes);
      // Use per-TC ELO for pairing so bullet/blitz/rapid players match by their
      // relevant rating rather than a single global ELO
      const tcType  = getTcType(timeControl.initial);
      const tcElo   = user[`elo_${tcType}`] ?? user.elo;
      const position = await enqueuePlayer(key, {
        userId,
        socketId: socket.id,
        elo: tcElo,
        joinedAt: Date.now(),
        preferredColor: color === 'white' || color === 'black' ? color : 'random',
      });

      socket.emit('queue:joined', { queueKey: key, position });
      console.log(`[Queue] ${user.username} (${user.elo}) joined: ${key}`);

      // Try pairing
      await withQueueLock(key, async () => {
        const lock = await acquireDistributedPairingLock(key);
        if (!lock.acquired) {
          logSecurityEvent('QUEUE_LOCK_CONTENTION', { queueKey: key, userId });
          return;
        }
        try {
          await tryPairPlayers(io, key, timeControl, stakes);
        } finally {
          await releaseDistributedPairingLock(key, lock.token);
        }
      });
    } catch (err) {
      console.error('[queue:join]', err);
      socket.emit('queue:error', { message: 'Failed to join queue' });
      socket.emit('error', { message: 'Failed to join queue' });
    }
  });

  // ── Leave queue ─────────────────────────────────────────────────────────
  socket.on('queue:leave', async () => {
    const lockedStake = await getQueuedStakeForUser(userId);
    await dequeuePlayerFromAll(userId);
    // Unlock queue lock based on server-known queue state (never trust client payload).
    if (lockedStake > 0) {
      await unlockForUser(userId, lockedStake).catch(() => {});
    }
    socket.emit('queue:left');
  });

  // ── Clean up on disconnect ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    // Note: stake unlock on disconnect is handled by walletCleanup's timeout job.
    // We still do a best-effort immediate unlock for better UX.
    getQueuedStakeForUser(userId)
      .then(async (lockedStake) => {
        await dequeuePlayerFromAll(userId).catch(() => {});
        if (lockedStake > 0) {
          await unlockForUser(userId, lockedStake).catch(() => {});
        }
      })
      .catch(() => {
        dequeuePlayerFromAll(userId).catch(() => {});
      });
  });
}

async function tryPairPlayers(io, key, timeControl, stakes) {
  const redis = await getRedisClient();
  let queue = null;
  if (redis) {
    const userIds = await redis.zRange(queueRedisKey(key), 0, -1);
    const entries = await Promise.all(userIds.map(async (uid) => {
      const meta = await redis.hGetAll(queueEntryRedisKey(uid));
      if (!meta || !meta.socketId) return null;
      return {
        userId: uid,
        socketId: meta.socketId,
        elo: Number(meta.elo || 1200),
        joinedAt: Number(meta.joinedAt || Date.now()),
        preferredColor: meta.preferredColor || 'random',
      };
    }));
    queue = entries.filter(Boolean);
  } else {
    queue = queues.get(key);
  }
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
  if (redis) {
    const claimed = await claimPairFromRedis(redis, key, p1.userId, p2.userId);
    if (!claimed) return;
    await Promise.all([
      redis.del(queueUserIndexKey(p1.userId)),
      redis.del(queueUserIndexKey(p2.userId)),
    ]);
  } else {
    const q = queues.get(key);
    queues.set(key, q.filter(e => e.userId !== p1.userId && e.userId !== p2.userId));
  }

  // Assign colors fairly based on both players' preferences.
  let whiteIsP1;
  const p1Pref = p1.preferredColor || 'random';
  const p2Pref = p2.preferredColor || 'random';
  if (p1Pref === 'white' && p2Pref !== 'white') whiteIsP1 = true;
  else if (p2Pref === 'white' && p1Pref !== 'white') whiteIsP1 = false;
  else if (p1Pref === 'black' && p2Pref !== 'black') whiteIsP1 = false;
  else if (p2Pref === 'black' && p1Pref !== 'black') whiteIsP1 = true;
  else whiteIsP1 = Math.random() > 0.5;
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
      // Unlock only the player who disconnected before game start.
      // Keep stake locked for the connected player if they are re-queued.
      if (stakes > 0) {
        if (!whiteSocket) await wallets.unlock(whiteEntry.userId, stakes).catch(() => {});
        if (!blackSocket) await wallets.unlock(blackEntry.userId, stakes).catch(() => {});
      }
      // Re-enqueue the still-connected player
      if (whiteSocket) {
        const tcType = getTcType(timeControl.initial);
        const whiteUser = await users.findById(whiteEntry.userId);
        const tcElo = whiteUser?.[`elo_${tcType}`] ?? whiteUser?.elo ?? 1200;
        const position = await enqueuePlayer(key, {
          userId: whiteEntry.userId,
          socketId: whiteEntry.socketId,
          elo: tcElo,
          joinedAt: Date.now(),
          preferredColor: whiteEntry.preferredColor || 'random',
        });
        whiteSocket.emit('queue:joined', { queueKey: key, position, reason: 'opponent-disconnected' });
      }
      if (blackSocket) {
        const tcType = getTcType(timeControl.initial);
        const blackUser = await users.findById(blackEntry.userId);
        const tcElo = blackUser?.[`elo_${tcType}`] ?? blackUser?.elo ?? 1200;
        const position = await enqueuePlayer(key, {
          userId: blackEntry.userId,
          socketId: blackEntry.socketId,
          elo: tcElo,
          joinedAt: Date.now(),
          preferredColor: blackEntry.preferredColor || 'random',
        });
        blackSocket.emit('queue:joined', { queueKey: key, position, reason: 'opponent-disconnected' });
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

'use strict';
/**
 * PresenceCache — Redis-backed user & game presence system.
 *
 * Replaces the `users.online` DB column for realtime online-status tracking.
 * Using Redis keys with TTL means stale presence auto-expires without manual
 * cleanup, and the state is consistent across multiple server instances.
 *
 * Keys:
 *   presence:user:{userId}    — string: socketId  (TTL = USER_TTL_S)
 *   presence:game:{gameId}    — set:   {userId…}  (TTL = GAME_TTL_S)
 *
 * Heartbeat: every 20 seconds each connected socket refreshes its key.
 * Auto-expire: if heartbeat stops (crash / ungraceful disconnect) key expires.
 *
 * Fallback: if Redis is unavailable all methods are no-ops / return safe defaults.
 *
 * API:
 *   setOnline(userId, socketId)       — mark online, start heartbeat
 *   setOffline(userId)                — remove key, stop heartbeat
 *   isOnline(userId)                  — boolean
 *   getSocketId(userId)               — socketId string or null
 *   addToGame(gameId, userId)         — add to game presence set
 *   removeFromGame(gameId, userId)    — remove from game presence set
 *   getGamePresence(gameId)           — array of userIds in game
 */

const { getRedisClient } = require('../lib/redis');
const logger = require('../lib/logger');

const USER_TTL_S  = 30;          // auto-expire 30s after last heartbeat
const GAME_TTL_S  = 2 * 3600;    // game presence: 2 hours
const HEARTBEAT_MS = 20_000;      // refresh every 20s

// Map<userId, NodeJS.Timeout> — heartbeat interval per connected user
const _heartbeatTimers = new Map();

function _userKey(userId) { return `presence:user:${userId}`; }
function _gameKey(gameId) { return `presence:game:${gameId}`; }

// ── User presence ─────────────────────────────────────────────────────────────

/**
 * Mark user as online. Stores their socketId in Redis and starts a heartbeat
 * timer that refreshes the key TTL every 20 seconds.
 */
async function setOnline(userId, socketId) {
  const client = await getRedisClient();
  if (client) {
    try {
      await client.set(_userKey(userId), String(socketId), { EX: USER_TTL_S });
    } catch (e) {
      logger.warn('[PresenceCache] setOnline error', { userId, error: e.message });
    }
  }

  // Stop any existing heartbeat before starting a new one
  const existing = _heartbeatTimers.get(userId);
  if (existing) clearInterval(existing);

  const timer = setInterval(async () => {
    const c = await getRedisClient();
    if (!c) return;
    c.expire(_userKey(userId), USER_TTL_S).catch(() => {});
  }, HEARTBEAT_MS);

  if (typeof timer.unref === 'function') timer.unref();
  _heartbeatTimers.set(userId, timer);
}

/**
 * Mark user as offline. Clears heartbeat and removes key from Redis.
 */
async function setOffline(userId) {
  const timer = _heartbeatTimers.get(userId);
  if (timer) {
    clearInterval(timer);
    _heartbeatTimers.delete(userId);
  }

  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.del(_userKey(userId));
  } catch (e) {
    logger.warn('[PresenceCache] setOffline error', { userId, error: e.message });
  }
}

/** Returns true if the user is currently online. */
async function isOnline(userId) {
  const client = await getRedisClient();
  if (!client) return true; // assume online if Redis unavailable
  try {
    return (await client.exists(_userKey(userId))) === 1;
  } catch (e) {
    logger.warn('[PresenceCache] isOnline error', { userId, error: e.message });
    return true;
  }
}

/** Returns the online user's socket ID, or null if offline. */
async function getSocketId(userId) {
  const client = await getRedisClient();
  if (!client) return null;
  try {
    return await client.get(_userKey(userId));
  } catch (e) {
    logger.warn('[PresenceCache] getSocketId error', { userId, error: e.message });
    return null;
  }
}

// ── Game presence ─────────────────────────────────────────────────────────────

/** Add userId to the game's presence set (used for spectator sync). */
async function addToGame(gameId, userId) {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.sAdd(_gameKey(gameId), String(userId));
    await client.expire(_gameKey(gameId), GAME_TTL_S);
  } catch (e) {
    logger.warn('[PresenceCache] addToGame error', { gameId, userId, error: e.message });
  }
}

/** Remove userId from the game's presence set. */
async function removeFromGame(gameId, userId) {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.sRem(_gameKey(gameId), String(userId));
  } catch (e) {
    logger.warn('[PresenceCache] removeFromGame error', { gameId, userId, error: e.message });
  }
}

/** Returns array of userId strings currently in the game's presence set. */
async function getGamePresence(gameId) {
  const client = await getRedisClient();
  if (!client) return [];
  try {
    return await client.sMembers(_gameKey(gameId));
  } catch (e) {
    logger.warn('[PresenceCache] getGamePresence error', { gameId, error: e.message });
    return [];
  }
}

module.exports = {
  setOnline,
  setOffline,
  isOnline,
  getSocketId,
  addToGame,
  removeFromGame,
  getGamePresence,
};

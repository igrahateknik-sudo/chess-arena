'use strict';
/**
 * MoveTokenStore — Redis-backed move nonce storage.
 *
 * Each player holds one valid token at a time.  The server issues a token
 * after every accepted move (or on game:join).  The client must echo the
 * token with its next move — preventing replay attacks even across instances.
 *
 * Storage  : Redis Hash  game:{gameId}:tokens  field=userId  value=token
 * TTL      : 2 hours (refreshed on every write)
 * Fallback : graceful degradation — returns null if Redis unavailable,
 *            caller must handle null as "no token issued".
 *
 * API:
 *   get(gameId, userId)          — returns current token or null
 *   set(gameId, userId, token)   — store token, refresh hash TTL
 *   del(gameId, userId)          — remove one player's token
 *   delGame(gameId)              — remove entire hash (game cleanup)
 */

const { getRedisClient } = require('../lib/redis');
const logger = require('../lib/logger');

const HASH_TTL_S = 2 * 60 * 60; // 2 hours

function _key(gameId) {
  return `game:${gameId}:tokens`;
}

async function get(gameId, userId) {
  const client = await getRedisClient();
  if (!client) return null;
  try {
    return await client.hGet(_key(gameId), String(userId));
  } catch (e) {
    logger.warn('[MoveTokenStore] get error', { gameId, userId, error: e.message });
    return null;
  }
}

async function set(gameId, userId, token) {
  const client = await getRedisClient();
  if (!client) return;
  try {
    const key = _key(gameId);
    await client.hSet(key, String(userId), token);
    await client.expire(key, HASH_TTL_S);
  } catch (e) {
    logger.warn('[MoveTokenStore] set error', { gameId, userId, error: e.message });
  }
}

async function del(gameId, userId) {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.hDel(_key(gameId), String(userId));
  } catch (e) {
    logger.warn('[MoveTokenStore] del error', { gameId, userId, error: e.message });
  }
}

async function delGame(gameId) {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.del(_key(gameId));
  } catch (e) {
    logger.warn('[MoveTokenStore] delGame error', { gameId, error: e.message });
  }
}

module.exports = { get, set, del, delGame };

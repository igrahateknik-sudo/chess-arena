'use strict';
/**
 * LeaderboardCache — Redis 60-second cache for leaderboard queries.
 *
 * Leaderboard requests hit the DB on every page view without caching.
 * This module wraps those queries in a 60-second TTL cache per variant
 * (timeControl × limit combination).
 *
 * Key pattern : leaderboard:{tc}:{limit}
 * TTL         : 60 seconds
 *
 * Invalidation: call invalidateAll() after any game ends (ELO change).
 * Fallback    : returns null on cache miss; callers fall back to DB.
 *
 * API:
 *   get(tc, limit)        — returns cached data or null
 *   set(tc, limit, data)  — store result in cache
 *   invalidateAll()       — bust all leaderboard keys
 */

const { getRedisClient } = require('../lib/redis');
const logger = require('../lib/logger');

const TTL_S = 60;

// All possible tc × limit combos we ever cache (for targeted invalidation)
const TC_VARIANTS   = ['global', 'bullet', 'blitz', 'rapid'];
const LIMIT_VARIANTS = [10, 20, 50, 100];

function _key(tc, limit) {
  return `leaderboard:${tc}:${limit}`;
}

async function get(tc, limit) {
  const client = await getRedisClient();
  if (!client) return null;
  try {
    const raw = await client.get(_key(tc, limit));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    logger.warn('[LeaderboardCache] get error', { tc, limit, error: e.message });
    return null;
  }
}

async function set(tc, limit, data) {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.set(_key(tc, limit), JSON.stringify(data), { EX: TTL_S });
  } catch (e) {
    logger.warn('[LeaderboardCache] set error', { tc, limit, error: e.message });
  }
}

/**
 * Invalidate all cached leaderboard variants.
 * Call this whenever ELO changes (game end, manual adjustment).
 */
async function invalidateAll() {
  const client = await getRedisClient();
  if (!client) return;
  try {
    const keys = TC_VARIANTS.flatMap(tc =>
      LIMIT_VARIANTS.map(l => _key(tc, l))
    );
    await client.del(keys);
  } catch (e) {
    logger.warn('[LeaderboardCache] invalidateAll error', { error: e.message });
  }
}

module.exports = { get, set, invalidateAll };

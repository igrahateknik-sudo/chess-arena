'use strict';
/**
 * MoveCooldownStore — Redis-backed per-user move rate limiter.
 *
 * Replaces the in-memory `moveCooldowns` Map.  Storing last-move timestamps
 * in Redis ensures the 500ms cooldown is enforced even if subsequent moves
 * are routed to a different instance.
 *
 * Key pattern : cd:{userId}   (simple string key)
 * TTL         : 600ms (auto-expire — slightly longer than COOLDOWN_MS)
 * Fallback    : returns 0 (allow) when Redis unavailable — graceful degradation.
 *
 * API:
 *   getLast(userId)         — timestamp of last accepted move, or 0
 *   setLast(userId, ts)     — record timestamp after move is accepted
 *   del(userId)             — clear on disconnect
 */

const { getRedisClient } = require('../lib/redis');
const logger = require('../lib/logger');

const COOLDOWN_MS = 500;
const KEY_TTL_PX  = 600; // px (milliseconds), slightly longer than cooldown

function _key(userId) {
  return `cd:${userId}`;
}

async function getLast(userId) {
  const client = await getRedisClient();
  if (!client) return 0;
  try {
    const val = await client.get(_key(userId));
    return val ? Number(val) : 0;
  } catch (e) {
    logger.warn('[MoveCooldownStore] getLast error', { userId, error: e.message });
    return 0; // fail-open: allow move
  }
}

async function setLast(userId, ts) {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.set(_key(userId), String(ts), { PX: KEY_TTL_PX });
  } catch (e) {
    logger.warn('[MoveCooldownStore] setLast error', { userId, error: e.message });
  }
}

async function del(userId) {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.del(_key(userId));
  } catch (e) {
    // ignore — key will expire naturally
  }
}

module.exports = { getLast, setLast, del, COOLDOWN_MS };

'use strict';
/**
 * GameStateCache — Write-through Redis cache for active game state.
 *
 * Architecture: local Map (hot cache) + Redis (durable backing).
 *   - Local Map:  O(1) sync reads, survives Redis unavailability.
 *   - Redis:      cross-instance recovery on reconnect or load-balancer redirect.
 *
 * Key pattern : game:{gameId}:state
 * TTL         : (timeControl.initial × 2) + 300s buffer
 *
 * API:
 *   get(gameId)          — async: local → Redis → null
 *   set(gameId, state)   — async: local + Redis write
 *   update(gameId, obj)  — async: merge into local + Redis write (fire-and-forget)
 *   del(gameId)          — async: local + Redis delete
 *   getLocal(gameId)     — sync:  local Map only (for hot paths like game:move, timers)
 *   localMap()           — returns underlying Map (for /health / /api/games/active)
 */

const { getRedisClient } = require('../lib/redis');
const logger = require('../lib/logger');

// ── Local write-through cache ─────────────────────────────────────────────────
const _local = new Map();

const BUFFER_TTL_S = 5 * 60; // 5-minute buffer beyond game duration

function _key(gameId) {
  return `game:${gameId}:state`;
}

function _ttl(state) {
  const initial = state.timeControl?.initial || 600;
  // Upper-bound: fastest bullet is 30s × 2 players = 60s, longest rapid ~60min
  return Math.max(initial * 2, 120) + BUFFER_TTL_S;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get game state. Checks local cache first, then Redis.
 * Does NOT fall back to DB — callers handle DB loading.
 */
async function get(gameId) {
  if (_local.has(gameId)) return _local.get(gameId);

  const client = await getRedisClient();
  if (!client) return null;

  try {
    const raw = await client.get(_key(gameId));
    if (!raw) return null;
    const state = JSON.parse(raw);
    _local.set(gameId, state); // warm local cache from Redis
    return state;
  } catch (e) {
    logger.warn('[GameStateCache] get error', { gameId, error: e.message });
    return null;
  }
}

/**
 * Create or overwrite game state (local + Redis).
 */
async function set(gameId, state) {
  _local.set(gameId, state);

  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.set(_key(gameId), JSON.stringify(state), { EX: _ttl(state) });
  } catch (e) {
    logger.warn('[GameStateCache] set error', { gameId, error: e.message });
  }
}

/**
 * Merge updates into existing local state, then flush to Redis.
 * No-op if state not loaded into local cache yet.
 */
async function update(gameId, updates) {
  const current = _local.get(gameId);
  if (!current) return;
  Object.assign(current, updates);

  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.set(_key(gameId), JSON.stringify(current), { EX: _ttl(current) });
  } catch (e) {
    logger.warn('[GameStateCache] update error', { gameId, error: e.message });
  }
}

/**
 * Delete state from local cache and Redis.
 */
async function del(gameId) {
  _local.delete(gameId);

  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.del(_key(gameId));
  } catch (e) {
    logger.warn('[GameStateCache] del error', { gameId, error: e.message });
  }
}

/**
 * Synchronous local-only read for hot paths (game:move handler, clock timer, etc.)
 * Returns null if not in local cache — callers must ensure state is loaded first.
 */
function getLocal(gameId) {
  return _local.get(gameId) || null;
}

/**
 * Returns the underlying local Map for server /health and /api/games/active.
 * Iterating this gives the current instance's view of active games.
 */
function localMap() {
  return _local;
}

module.exports = { get, set, update, del, getLocal, localMap };

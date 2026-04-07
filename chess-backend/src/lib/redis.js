'use strict';
/**
 * Shared Redis singleton
 *
 * Single source-of-truth untuk semua Redis connections di backend.
 * Sebelum modul ini: 5 koneksi Redis (auth×1 + matchmaking×2 + gameRoom×1 + server adapter pub×1)
 * Setelah modul ini : 2 koneksi Redis (shared×1  + sub untuk Socket.IO adapter×1)
 *
 * API:
 *   getRedisClient()  — shared client untuk auth, matchmaking, gameRoom, wallet cleanup
 *   getSubClient()    — dedicated subscriber (duplicate) untuk Socket.IO Redis adapter
 *   disconnectRedis() — graceful shutdown, panggil di SIGTERM/SIGINT
 *
 * Behavior:
 *   - Lazy-connect: koneksi dibuat saat pertama kali diminta
 *   - Null-safe: mengembalikan null jika REDIS_URL tidak dikonfigurasi (graceful degradation)
 *   - Reconnect-safe: redis v4 auto-reconnect dengan strategi exponential backoff
 *   - Promise-deduplicated: concurrent calls saat connecting tidak membuat koneksi dobel
 */

const { createClient } = require('redis');
const logger = require('./logger');

// ── Shared client (semua modul berbagi koneksi ini) ───────────────────────────
let _client = null;
let _connectPromise = null;

// ── Subscriber client (khusus Socket.IO adapter pub/sub) ─────────────────────
let _subClient = null;

/**
 * Returns the shared Redis client.
 * Returns null if REDIS_URL is not set or Redis is unavailable.
 *
 * @returns {Promise<import('redis').RedisClientType|null>}
 */
async function getRedisClient() {
  if (!process.env.REDIS_URL) return null;

  // Return immediately if client is connected and ready
  if (_client && (_client.isReady || _client.isOpen)) return _client;

  // Deduplicate concurrent connection attempts — only one connect() in flight
  if (_connectPromise) return _connectPromise;

  _connectPromise = (async () => {
    try {
      _client = createClient({
        url: process.env.REDIS_URL,
        socket: {
          // Exponential backoff: 100ms, 200ms, 400ms … up to 3s, max 10 retries
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.error('[Redis] Max reconnect retries exceeded — giving up');
              return new Error('Redis max retries exceeded');
            }
            const delay = Math.min(retries * 100, 3000);
            logger.warn(`[Redis] Reconnecting in ${delay}ms (attempt ${retries})`);
            return delay;
          },
        },
      });

      _client.on('error', (err) => {
        logger.error('[Redis] Client error', { error: err.message });
      });
      _client.on('reconnecting', () => {
        logger.warn('[Redis] Reconnecting to Redis...');
      });
      _client.on('ready', () => {
        logger.info('[Redis] Shared client ready');
      });
      _client.on('end', () => {
        logger.warn('[Redis] Shared client connection closed');
        _client = null; // allow re-connect on next getRedisClient() call
      });

      await _client.connect();

      const safeUrl = process.env.REDIS_URL.replace(/:\/\/[^@]*@/, '://***@');
      logger.info('[Redis] Shared client connected', { url: safeUrl });

      return _client;
    } catch (err) {
      logger.warn('[Redis] Connection failed — operating without Redis', {
        error: err.message,
      });
      _client = null;
      return null;
    } finally {
      _connectPromise = null;
    }
  })();

  return _connectPromise;
}

/**
 * Returns a dedicated subscriber client (duplicate of shared client).
 *
 * The Socket.IO Redis adapter requires two separate connections:
 *   - pub: the shared client (used for normal commands + publishing)
 *   - sub: this client (dedicated for SUBSCRIBE — cannot run regular commands)
 *
 * Must only be called after getRedisClient() has resolved successfully.
 *
 * @returns {Promise<import('redis').RedisClientType|null>}
 */
async function getSubClient() {
  if (!process.env.REDIS_URL) return null;

  const pub = await getRedisClient();
  if (!pub) return null;

  if (_subClient && (_subClient.isReady || _subClient.isOpen)) return _subClient;

  try {
    _subClient = pub.duplicate();

    _subClient.on('error', (err) => {
      logger.error('[Redis] Sub client error', { error: err.message });
    });
    _subClient.on('ready', () => {
      logger.info('[Redis] Sub client ready');
    });
    _subClient.on('end', () => {
      logger.warn('[Redis] Sub client connection closed');
      _subClient = null;
    });

    await _subClient.connect();
    return _subClient;
  } catch (err) {
    logger.warn('[Redis] Sub client connection failed', { error: err.message });
    _subClient = null;
    return null;
  }
}

/**
 * Gracefully disconnect all Redis clients.
 * Call this on process shutdown (SIGTERM/SIGINT) to avoid dangling connections.
 */
async function disconnectRedis() {
  const cleanups = [];
  if (_subClient) {
    cleanups.push(_subClient.quit().catch(() => {}));
    _subClient = null;
  }
  if (_client) {
    cleanups.push(_client.quit().catch(() => {}));
    _client = null;
  }
  await Promise.allSettled(cleanups);
}

module.exports = { getRedisClient, getSubClient, disconnectRedis };

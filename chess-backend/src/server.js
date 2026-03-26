const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { verifyToken } = require('./lib/auth');
const { users } = require('./lib/db');
const { registerMatchmaking, queues } = require('./socket/matchmaking');
const { registerGameRoom, gameCache } = require('./socket/gameRoom');
const { registerSpectator }           = require('./socket/spectator');
const { startMonitor }                = require('./lib/monitor');
const { startWalletCleanupJob }       = require('./lib/walletCleanup');
const logger                          = require('./lib/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  'http://localhost:3000,https://chess-app-two-kappa.vercel.app'
).split(',').map(s => s.trim());

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── Redis Adapter (optional — only when REDIS_URL is set) ────────────────────
// Enables Socket.IO horizontal scaling across multiple server instances.
// Without Redis, socket rooms are scoped to a single process.
//
// Stored in module scope so the /health endpoint can report status.
let redisStatus = process.env.REDIS_URL ? 'connecting' : 'disabled';

async function connectRedisAdapter() {
  if (!process.env.REDIS_URL) return;
  try {
    const { createClient } = require('redis');
    const { createAdapter } = require('@socket.io/redis-adapter');

    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();

    // Surface connection errors so we can fall back gracefully
    pubClient.on('error', err => logger.error('Redis pub error', { error: err.message }));
    subClient.on('error', err => logger.error('Redis sub error', { error: err.message }));

    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    redisStatus = 'connected';
    const safeUrl = process.env.REDIS_URL.replace(/:\/\/[^@]*@/, '://***@');
    logger.info('Redis Socket.IO adapter connected', { url: safeUrl });
  } catch (err) {
    redisStatus = 'failed';
    logger.warn('Redis adapter connection failed — single-instance fallback', { error: err.message });
  }
}

// ── Socket.IO rate limiting middleware ───────────────────────────────────────
// Per-socket sliding-window limiter applied to every event handler.
//
// Limits enforced independently per socket connection:
//   game:move   — max 3 per second   (bullet chess pace ≤ 1/s)
//   game:chat   — max 5 per 10 s     (anti-spam)
//   queue:join  — max 2 per 10 s     (prevent queue hopping)
//   * (global)  — max 60 per second  (circuit breaker)
//
// Blocked events are silently dropped (no error emitted to client).
// Violations are logged server-side with username + event name.
const RATE_RULES = [
  { event: 'game:move',   max: 3,  windowMs: 1_000  },
  { event: 'game:chat',   max: 5,  windowMs: 10_000 },
  { event: 'queue:join',  max: 2,  windowMs: 10_000 }, // actual event name in matchmaking.js
  { event: '*',           max: 60, windowMs: 1_000  },
];

/**
 * Returns an isAllowed(event) predicate for one socket.
 *
 * Algorithm (two-phase, no double-counting):
 *   Phase 1 — Check every applicable rule in READ-ONLY mode.
 *             If any window is full → return false immediately.
 *   Phase 2 — All rules passed → stamp the event in every applicable window.
 *
 * Each rule uses its own isolated bucket key:
 *   specific rule  → key `ev:<eventName>`
 *   wildcard '*'   → key `__global__`
 */
function createSocketRateLimiter() {
  const windows = new Map(); // Map<key, number[]>  (timestamps in ms)

  /** Prune expired entries and return the live window array. */
  function prune(key, windowMs) {
    if (!windows.has(key)) windows.set(key, []);
    const arr = windows.get(key);
    const cutoff = Date.now() - windowMs;
    let i = 0;
    while (i < arr.length && arr[i] < cutoff) i++;
    if (i > 0) arr.splice(0, i);
    return arr;
  }

  return function isAllowed(event) {
    const now = Date.now();

    // ── Phase 1: check (read) ─────────────────────────────────────────────
    for (const rule of RATE_RULES) {
      if (rule.event !== event && rule.event !== '*') continue;
      const key = rule.event === '*' ? '__global__' : `ev:${event}`;
      const arr = prune(key, rule.windowMs);
      if (arr.length >= rule.max) return false;
    }

    // ── Phase 2: stamp (write) ────────────────────────────────────────────
    for (const rule of RATE_RULES) {
      if (rule.event !== event && rule.event !== '*') continue;
      const key = rule.event === '*' ? '__global__' : `ev:${event}`;
      windows.get(key).push(now); // array already exists from Phase 1 prune
    }

    return true;
  };
}

// ── Middleware ───────────────────────────────────────────────────────────────
// [SECURITY] CSP diaktifkan — tidak ada lagi contentSecurityPolicy: false
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // API server: izinkan koneksi WebSocket dari allowed origins
      connectSrc: ["'self'", ...ALLOWED_ORIGINS],
      // Tidak ada script/style di-serve dari sini, tapi tetap set defaults
      upgradeInsecureRequests: [],
    },
  },
  // Strict headers tambahan
  crossOriginEmbedderPolicy: false,  // dinonaktifkan agar tidak break socket.io polling
}));
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(morgan('combined', { stream: logger.morganStream }));
app.use(logger.requestLogger);

// NOTE: express.raw() removed — it conflicts with route-level express.json()
// by setting req._body=true which prevents subsequent json parsing,
// causing req.body to remain a Buffer. Webhook signature is verified via
// field-based SHA-512 hash (order_id + status_code + gross_amount + serverKey),
// which does not require the raw body bytes.
app.use(express.json({ limit: '1mb' }));

// ── REST Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/game', require('./routes/game'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/tournament', require('./routes/tournament'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/appeal', require('./routes/appeal'));
app.use('/api/admin', require('./routes/admin'));

// ── Active Games (for spectator browser) ─────────────────────────────────────
app.get('/api/games/active', (req, res) => {
  const { getSpectatorCount } = require('./socket/spectator');
  const activeGames = [...gameCache.values()]
    .filter(g => g.status === 'active')
    .map(g => ({
      gameId:       g.id,
      whiteId:      g.whiteId,
      blackId:      g.blackId,
      fen:          g.fen,
      moveCount:    g.moveHistory?.length || 0,
      timeControl:  g.timeControl,
      stakes:       g.stakes,
      spectators:   getSpectatorCount(g.id),
    }));
  res.json({ games: activeGames });
});

app.get('/health', (req, res) => {
  const queueCounts = {};
  for (const [key, queue] of queues.entries()) {
    queueCounts[key] = queue.length;
  }
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    connectedSockets: io.sockets.sockets.size,
    activeGames: [...gameCache.values()].filter(g => g.status === 'active').length,
    queues: queueCounts,
    redis: redisStatus,
    timestamp: new Date().toISOString(),
  });
});

// ── 404 + Error handlers (must be after all routes) ──────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Socket.io Auth Middleware ────────────────────────────────────────────────
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));

  const payload = verifyToken(token);
  if (!payload) return next(new Error('Invalid token'));

  try {
    const user = await users.findById(payload.userId);
    if (!user) return next(new Error('User not found'));

    socket.userId = payload.userId;
    socket.username = user.username;
    socket.userElo = user.elo;
    next();
  } catch (err) {
    next(new Error('Auth error'));
  }
});

// ── Socket.io Connection ─────────────────────────────────────────────────────
io.on('connection', async (socket) => {
  const { userId, username } = socket;
  logger.info('Socket connected', { username, socketId: socket.id });

  // Join per-user room untuk direct messaging
  socket.join(userId);

  // Mark online in DB
  await users.setOnline(userId, socket.id).catch(() => {});

  // Broadcast updated online count + active games
  const onlineCount = io.sockets.sockets.size;
  const activeGames = [...gameCache.values()].filter(g => g.status === 'active').length;
  io.emit('lobby:online', { count: onlineCount, activeGames });

  // ── Per-socket rate limiter ───────────────────────────────────────────────
  // Wrap socket.on so every registered event goes through the rate limiter.
  // Blocked events are silently dropped (no error sent to client to avoid
  // leaking info about limits). Violations are logged server-side.
  const isAllowed = createSocketRateLimiter();
  const originalOn = socket.on.bind(socket);
  socket.on = function rateLimitedOn(event, handler) {
    // Don't intercept internal Socket.IO events
    if (event === 'connect' || event === 'disconnect' || event === 'error' || event === 'disconnecting') {
      return originalOn(event, handler);
    }
    return originalOn(event, (...args) => {
      if (!isAllowed(event)) {
        logger.warn('Socket rate limit hit', { username, event });
        return; // drop silently
      }
      handler(...args);
    });
  };

  // Register feature handlers
  registerMatchmaking(io, socket, userId);
  registerGameRoom(io, socket, userId);
  registerSpectator(io, socket);

  // ── Lobby chat ───────────────────────────────────────────────────────────
  socket.on('lobby:chat', ({ message }) => {
    if (!message || !message.trim()) return;
    io.emit('lobby:chat', {
      from: username,
      fromId: userId,
      message: message.trim().slice(0, 200),
      timestamp: Date.now(),
    });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    await users.setOffline(userId).catch(() => {});
    const onlineCountAfter = io.sockets.sockets.size;
    const activeGamesAfter = [...gameCache.values()].filter(g => g.status === 'active').length;
    io.emit('lobby:online', { count: onlineCountAfter, activeGames: activeGamesAfter });
    logger.info('Socket disconnected', { username, socketId: socket.id });
  });
});

// ── Start Server ─────────────────────────────────────────────────────────────
// Railway: selalu jalankan server.listen() karena Railway adalah long-running process.
// Tidak ada Vercel serverless — modul ini selalu dipanggil sebagai main module.
//
// Redis adapter is awaited BEFORE listen() so every connection uses it from the start.
// If Redis is unavailable the server still starts (single-instance fallback).
const PORT = process.env.PORT || 4000;

(async () => {
  await connectRedisAdapter(); // no-op if REDIS_URL not set; sets redisStatus

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n♔ Chess Arena Backend (Railway)`);
    console.log(`─────────────────────────────────`);
    console.log(`  HTTP  : http://0.0.0.0:${PORT}`);
    console.log(`  WS    : ws://0.0.0.0:${PORT}`);
    console.log(`  Health: http://0.0.0.0:${PORT}/health`);
    console.log(`  DB    : Supabase`);
    console.log(`  Pay   : Midtrans`);
    console.log(`  Redis : ${redisStatus}`);
    console.log(`  Env   : ${process.env.NODE_ENV || 'development'}`);
    console.log(`─────────────────────────────────\n`);

    startMonitor();
    startWalletCleanupJob();
  });
})();

module.exports = server;

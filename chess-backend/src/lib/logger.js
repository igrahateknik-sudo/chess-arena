/**
 * Structured logger using Winston.
 *
 * Features:
 *  - JSON format in production (machine-parseable)
 *  - Pretty format in development (human-readable)
 *  - Log levels: error, warn, info, http, debug
 *  - Request duration tracking via middleware
 *  - Automatic context fields: service, env, timestamp
 *
 * Usage:
 *   const logger = require('./lib/logger');
 *   logger.info('User registered', { userId, username });
 *   logger.warn('Payment attempt failed', { orderId, reason });
 *   logger.error('DB error', { error: err.message, stack: err.stack });
 */

const winston = require('winston');

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

// ── Format Definitions ────────────────────────────────────────────────────────

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss.SSS' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message}${metaStr}`;
  })
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// ── Logger Instance ───────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: logLevel,
  defaultMeta: {
    service: 'chess-arena-backend',
    env: process.env.NODE_ENV || 'development',
  },
  format: isProduction ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
  ],
  // Don't crash on unhandled exceptions — log them instead
  exceptionHandlers: [
    new winston.transports.Console(),
  ],
  rejectionHandlers: [
    new winston.transports.Console(),
  ],
});

// ── Morgan Integration ────────────────────────────────────────────────────────
// Replaces console.log from Morgan with Winston http level

const morganStream = {
  write: (message) => logger.http(message.trim()),
};

// ── Request Duration Middleware ───────────────────────────────────────────────

/**
 * Express middleware that logs each request with method, path, status, and duration.
 * Add AFTER your route handlers (or use it as a replacement for Morgan).
 */
function requestLogger(req, res, next) {
  const startHrTime = process.hrtime();

  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(startHrTime);
    const durationMs = (seconds * 1000 + nanoseconds / 1e6).toFixed(1);
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';

    logger[level](`${req.method} ${req.originalUrl} ${res.statusCode}`, {
      method:   req.method,
      path:     req.originalUrl,
      status:   res.statusCode,
      duration: `${durationMs}ms`,
      ip:       req.ip,
      ua:       req.headers['user-agent']?.slice(0, 80),
    });
  });

  next();
}

module.exports = logger;
module.exports.morganStream = morganStream;
module.exports.requestLogger = requestLogger;

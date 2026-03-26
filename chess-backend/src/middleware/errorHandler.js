/**
 * Centralized error handling middleware for Express.
 *
 * Custom error classes:
 *   AppError          — base class
 *   ValidationError   — 400 bad request
 *   UnauthorizedError — 401 unauthorized
 *   ForbiddenError    — 403 forbidden
 *   NotFoundError     — 404 not found
 *   ConflictError     — 409 conflict
 *   PaymentError      — 402 payment required
 *
 * Usage in routes:
 *   const { NotFoundError, ForbiddenError } = require('../middleware/errorHandler');
 *   throw new NotFoundError('Game not found');
 *
 * At the end of server.js:
 *   app.use(errorHandler);
 */

const logger = require('../lib/logger');

// ── Custom Error Classes ───────────────────────────────────────────────────────

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // Distinguish from unexpected bugs
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

class PaymentError extends AppError {
  constructor(message = 'Payment required') {
    super(message, 402, 'PAYMENT_REQUIRED');
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// ── Global Error Handler ───────────────────────────────────────────────────────

/**
 * Express error handler — must have 4 parameters (err, req, res, next).
 * Register AFTER all routes in server.js:
 *   app.use(errorHandler);
 */
function errorHandler(err, req, res, next) {
  // Operational errors (expected, thrown intentionally)
  if (err.isOperational) {
    const body = {
      error:  err.message,
      code:   err.code,
    };
    if (err.details) body.details = err.details;

    // Only log operational errors at warn level to reduce noise
    logger.warn('Operational error', {
      code:       err.code,
      statusCode: err.statusCode,
      message:    err.message,
      path:       req.originalUrl,
      method:     req.method,
    });

    return res.status(err.statusCode).json(body);
  }

  // Unexpected programming errors
  logger.error('Unexpected error', {
    message:    err.message,
    stack:      err.stack,
    path:       req.originalUrl,
    method:     req.method,
    body:       req.body,
  });

  // Don't leak internal details to client in production
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
}

/**
 * 404 handler — register after all routes but before errorHandler.
 * app.use(notFoundHandler);
 * app.use(errorHandler);
 */
function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found`, code: 'NOT_FOUND' });
}

module.exports = {
  errorHandler,
  notFoundHandler,
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PaymentError,
  RateLimitError,
};

'use strict';
/**
 * Admin Authentication Middleware
 *
 * Admin diidentifikasi dengan dua cara (AND):
 *  1. JWT valid (sama seperti user biasa)
 *  2. users.is_admin === true di DB  OR  email ada di ADMIN_EMAILS env var
 *
 * ADMIN_EMAILS = comma-separated list di env var, sebagai fallback jika
 * belum sempat set is_admin di DB.
 *
 * requireAdminStepUp — FAIL-CLOSED:
 *   Jika ADMIN_STEPUP_SECRET tidak di-set, SEMUA mutation (POST/PUT/PATCH/DELETE)
 *   diblokir dengan 503.  Ini mencegah bypass diam-diam jika env var belum
 *   dikonfigurasi di production.
 */

const { verifyToken, passwordHashVersion } = require('../lib/auth');
const logger = require('../lib/logger');
// Lazy-require db to avoid Supabase initialisation at module load time
// (allows requireAdminStepUp to be unit-tested without DB env vars)
let _users = null;
function getUsers() {
  if (!_users) _users = require('../lib/db').users;
  return _users;
}

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

async function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token   = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  const user = await getUsers().findById(payload.userId).catch(() => null);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (payload.phv && payload.phv !== passwordHashVersion(user.password_hash)) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  const isAdmin = user.is_admin === true ||
    ADMIN_EMAILS.includes((user.email || '').toLowerCase());

  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  req.user   = user;
  req.userId = user.id;
  next();
}

/**
 * Step-up guard for sensitive admin mutations.
 *
 * FAIL-CLOSED: if ADMIN_STEPUP_SECRET is not configured, ALL mutation
 * methods (POST, PUT, PATCH, DELETE) are blocked.  This prevents a silent
 * privilege escalation when the secret is accidentally omitted from env vars.
 *
 * Safe methods (GET, HEAD, OPTIONS) always pass through.
 */
function requireAdminStepUp(req, res, next) {
  const sensitiveMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (!sensitiveMethod) return next();

  const requiredSecret = process.env.ADMIN_STEPUP_SECRET;

  if (!requiredSecret) {
    logger.warn('[AdminAuth] ADMIN_STEPUP_SECRET not configured — blocking admin mutation', {
      method: req.method,
      path:   req.path,
    });
    return res.status(503).json({
      error: 'Admin mutations are disabled: ADMIN_STEPUP_SECRET is not configured.',
      code:  'STEPUP_SECRET_MISSING',
    });
  }

  const provided = req.headers['x-admin-stepup'];
  if (!provided || provided !== requiredSecret) {
    return res.status(403).json({ error: 'Admin step-up required', code: 'STEPUP_REQUIRED' });
  }

  next();
}

module.exports = { requireAdmin, requireAdminStepUp };

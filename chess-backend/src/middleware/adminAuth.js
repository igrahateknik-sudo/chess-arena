/**
 * Admin Authentication Middleware
 *
 * Admin diidentifikasi dengan dua cara (AND):
 *  1. JWT valid (sama seperti user biasa)
 *  2. users.is_admin === true di DB  OR  email ada di ADMIN_EMAILS env var
 *
 * ADMIN_EMAILS = comma-separated list di env var, sebagai fallback jika
 * belum sempat set is_admin di DB.
 */

const { verifyToken } = require('../lib/auth');
const { users } = require('../lib/db');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

async function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  const user = await users.findById(payload.userId).catch(() => null);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const isAdmin = user.is_admin === true || ADMIN_EMAILS.includes((user.email || '').toLowerCase());
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  req.user   = user;
  req.userId = user.id;
  next();
}

module.exports = { requireAdmin };

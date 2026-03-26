const { verifyToken } = require('../lib/auth');
const { users } = require('../lib/db');

/**
 * Express middleware — requires valid JWT, attaches req.user
 */
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  const user = await users.findById(payload.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  req.user = user;
  req.userId = user.id;
  next();
}

/**
 * Optional auth — attaches req.user if token present, but doesn't block
 */
async function optionalAuth(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      const payload = verifyToken(token);
      if (payload) {
        req.user = await users.findById(payload.userId);
        req.userId = payload.userId;
      }
    }
  } catch { /* ignore */ }
  next();
}

module.exports = { requireAuth, optionalAuth };

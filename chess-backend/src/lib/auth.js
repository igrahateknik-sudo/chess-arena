const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}
const JWT_EXPIRES = process.env.JWT_EXPIRES || '12h';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function passwordHashVersion(passwordHash) {
  if (!passwordHash || typeof passwordHash !== 'string') return 'none';
  return crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}

module.exports = { signToken, verifyToken, passwordHashVersion };

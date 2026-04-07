const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { users } = require('../lib/db');
const { signToken, verifyToken, passwordHashVersion } = require('../lib/auth');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../lib/mailer');

// ── Account lockout per email ─────────────────────────────────────────────────
const loginAttempts = new Map(); // key: email/username, value: { count, lastAttempt }
const MAX_LOGIN_ATTEMPTS = 10;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 menit

// Cleanup expired lockout entries every 30 menit
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of loginAttempts.entries()) {
    if (now - val.lastAttempt >= LOCKOUT_DURATION) loginAttempts.delete(key);
  }
}, 30 * 60 * 1000);

// ── Rate limiters ─────────────────────────────────────────────────────────────
const loginRateLimit = rateLimit({
  windowMs: 60 * 1000,          // 1 minute
  max: 5,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many login attempts. Please wait 1 minute.' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,     // 1 hour
  max: 3,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many registration attempts. Please wait 1 hour.' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,     // 1 hour
  max: 3,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many password reset requests. Please wait 1 hour.' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const resendVerificationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,     // 1 hour
  max: 3,
  keyGenerator: (req) => (req.body && req.body.email) ? req.body.email.toLowerCase() : req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi dalam 1 jam.' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', registerRateLimit, validate(schemas.register), async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existing = await users.findByUsername(username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const existingEmail = await users.findByEmail(email);
    if (existingEmail) return res.status(409).json({ error: 'Email sudah terdaftar' });

    const passwordHash = await bcrypt.hash(password, 12);

    // Generate email verification token (store hashed, send plain)
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const hashedVerifyToken = crypto.createHash('sha256').update(verifyToken).digest('hex');

    const user = await users.create({ username, email, passwordHash, verifyToken: hashedVerifyToken });

    // Send verification email (non-blocking — don't fail registration if email fails)
    sendVerificationEmail(email, username, verifyToken).catch(err =>
      console.error('[auth/register] Email send failed:', err.message)
    );

    res.status(201).json({
      ok: true,
      requiresVerification: true,
      email,
      message: 'Akun berhasil dibuat. Cek email kamu untuk verifikasi.',
    });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', loginRateLimit, validate(schemas.login), async (req, res) => {
  try {
    const { email, username, password } = req.body;

    let user;
    if (email) {
      user = await users.findByEmail(email);
    } else if (username) {
      user = await users.findByUsername(username);
    }

    const loginKey = (email || username || '').toLowerCase();

    // Check account lockout
    const attempts = loginAttempts.get(loginKey);
    if (attempts && attempts.count >= MAX_LOGIN_ATTEMPTS && Date.now() - attempts.lastAttempt < LOCKOUT_DURATION) {
      return res.status(429).json({ error: 'Akun terkunci sementara karena terlalu banyak percobaan login. Coba lagi dalam 15 menit.' });
    }

    if (!user) {
      const cur = loginAttempts.get(loginKey) || { count: 0, lastAttempt: 0 };
      loginAttempts.set(loginKey, { count: cur.count + 1, lastAttempt: Date.now() });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      const cur = loginAttempts.get(loginKey) || { count: 0, lastAttempt: 0 };
      loginAttempts.set(loginKey, { count: cur.count + 1, lastAttempt: Date.now() });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Enforce email verification
    if (!user.verified) {
      return res.status(403).json({
        error: 'Email belum diverifikasi. Cek inbox kamu untuk link verifikasi.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    // Reset lockout on successful login
    loginAttempts.delete(loginKey);

    const token = signToken({ userId: user.id, phv: passwordHashVersion(user.password_hash) });
    res.json({ token, user: users.public(user) });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /api/auth/google ────────────────────────────────────────────────────
// Login/register via Google ID token from Google Identity Services
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential || typeof credential !== 'string') {
      return res.status(400).json({ error: 'Google credential is required' });
    }

    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!verifyRes.ok) {
      return res.status(401).json({ error: 'Google token invalid' });
    }

    const payload = await verifyRes.json();
    const aud = payload.aud;
    const email = (payload.email || '').toLowerCase();
    const emailVerified = payload.email_verified === 'true' || payload.email_verified === true;
    const googleName = payload.name || '';

    if (!email || !emailVerified) {
      return res.status(401).json({ error: 'Google account email is not verified' });
    }
    if (process.env.GOOGLE_CLIENT_ID && aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ error: 'Google client mismatch' });
    }

    let user = await users.findByEmail(email);
    if (!user) {
      const base = (googleName || email.split('@')[0] || 'player')
        .replace(/[^a-zA-Z0-9_]/g, '')
        .slice(0, 14) || 'player';
      let username = base;
      let i = 1;
      while (await users.findByUsername(username)) {
        username = `${base}${i}`;
        i += 1;
      }
      const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
      user = await users.create({
        username,
        email,
        passwordHash,
      });
    }

    // Ensure Google accounts can log in directly
    if (!user.verified) {
      user = await users.update(user.id, { verified: true, verify_token: null });
    }

    const token = signToken({ userId: user.id, phv: passwordHashVersion(user.password_hash) });
    res.json({ token, user: users.public(user) });
  } catch (err) {
    console.error('[auth/google]', err);
    res.status(500).json({ error: 'Google login failed' });
  }
});

// ── POST /api/auth/guest ─────────────────────────────────────────────────────
router.post('/guest', async (req, res) => {
  try {
    const id = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
    const username = `Guest${id}`;
    const passwordHash = await bcrypt.hash(Math.random().toString(36), 8);

    const user = await users.create({
      username,
      email: `${username.toLowerCase()}@guest.chess-arena.app`,
      passwordHash,
    });

    const token = signToken({ userId: user.id, phv: passwordHashVersion(user.password_hash) });
    res.status(201).json({ token, user: users.public(user) });
  } catch (err) {
    console.error('[auth/guest]', err);
    res.status(500).json({ error: 'Guest login failed' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: users.public(req.user) });
});

// ── PATCH /api/auth/profile ──────────────────────────────────────────────────
router.patch('/profile', requireAuth, validate(schemas.updateProfile), async (req, res) => {
  try {
    const { country, avatar_url } = req.body;
    const updates = {};
    if (country !== undefined) updates.country = country;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;

    const updated = await users.update(req.userId, updates);
    res.json({ user: users.public(updated) });
  } catch (err) {
    console.error('[auth/profile]', err);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', requireAuth, validate(schemas.changePassword), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const match = await bcrypt.compare(currentPassword, req.user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await users.update(req.userId, { password_hash: passwordHash });

    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/change-password]', err);
    res.status(500).json({ error: 'Password change failed' });
  }
});

// ── POST /api/auth/verify-email ──────────────────────────────────────────────
// Verifies email via token sent at registration
router.post('/verify-email', validate(schemas.verifyEmail), async (req, res) => {
  try {
    const { token } = req.body;

    const user = await users.findByVerifyToken(token);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    if (user.verified) {
      return res.json({ ok: true, message: 'Email already verified' });
    }

    await users.update(user.id, {
      verified: true,
      verify_token: null,
    });

    res.json({ ok: true, message: 'Email verified successfully' });
  } catch (err) {
    console.error('[auth/verify-email]', err);
    res.status(500).json({ error: 'Email verification failed' });
  }
});

// ── POST /api/auth/forgot-password ──────────────────────────────────────────
// Sends password reset email
router.post('/forgot-password', forgotPasswordRateLimit, validate(schemas.forgotPassword), async (req, res) => {
  try {
    const { email } = req.body;

    const user = await users.findByEmail(email);

    // Always return success to prevent user enumeration
    if (!user) {
      return res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await users.update(user.id, {
      reset_token: hashedResetToken,
      reset_token_expires: resetExpiry,
    });

    sendPasswordResetEmail(email, user.username, resetToken).catch(err =>
      console.error('[auth/forgot-password] Email send failed:', err.message)
    );

    res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('[auth/forgot-password]', err);
    res.status(500).json({ error: 'Password reset request failed' });
  }
});

// ── POST /api/auth/reset-password ───────────────────────────────────────────
// Resets password using the token from the email
router.post('/reset-password', validate(schemas.resetPassword), async (req, res) => {
  try {
    const { token, password } = req.body;

    const user = await users.findByResetToken(token);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Check token expiry
    if (user.reset_token_expires && new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'Reset token has expired. Please request a new one.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await users.update(user.id, {
      password_hash: passwordHash,
      reset_token: null,
      reset_token_expires: null,
    });

    res.json({ ok: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('[auth/reset-password]', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ── POST /api/auth/resend-verification ──────────────────────────────────────
// Kirim ulang email verifikasi (max 3x per jam per email)
router.post('/resend-verification', resendVerificationRateLimit, validate(schemas.resendVerification), async (req, res) => {
  try {
    const { email } = req.body;

    const user = await users.findByEmail(email);

    // Always return success to prevent user enumeration
    if (!user || user.verified) {
      return res.json({ ok: true, message: 'Jika email terdaftar dan belum diverifikasi, link telah dikirim.' });
    }

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const hashedVerifyToken = crypto.createHash('sha256').update(verifyToken).digest('hex');

    await users.update(user.id, { verify_token: hashedVerifyToken });

    sendVerificationEmail(email, user.username, verifyToken).catch(err =>
      console.error('[auth/resend-verification] Email send failed:', err.message)
    );

    res.json({ ok: true, message: 'Jika email terdaftar dan belum diverifikasi, link telah dikirim.' });
  } catch (err) {
    console.error('[auth/resend-verification]', err);
    res.status(500).json({ error: 'Gagal mengirim ulang email verifikasi' });
  }
});

module.exports = router;

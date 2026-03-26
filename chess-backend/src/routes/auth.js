const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { users } = require('../lib/db');
const { signToken, verifyToken } = require('../lib/auth');
const { requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../lib/mailer');

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

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', registerRateLimit, validate(schemas.register), async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existing = await users.findByUsername(username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const existingEmail = await users.findByEmail(email);
    if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);

    // Generate email verification token
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const user = await users.create({ username, email, passwordHash, verifyToken });

    // Send verification email (non-blocking — don't fail registration if email fails)
    sendVerificationEmail(email, username, verifyToken).catch(err =>
      console.error('[auth/register] Email send failed:', err.message)
    );

    const token = signToken({ userId: user.id });
    res.status(201).json({
      token,
      user: users.public(user),
      message: 'Registration successful. Please check your email to verify your account.',
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

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({ userId: user.id });
    res.json({ token, user: users.public(user) });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
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

    const token = signToken({ userId: user.id });
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

    if (user.email_verified) {
      return res.json({ ok: true, message: 'Email already verified' });
    }

    await users.update(user.id, {
      email_verified: true,
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
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await users.update(user.id, {
      reset_token: resetToken,
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

module.exports = router;

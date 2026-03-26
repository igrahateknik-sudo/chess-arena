/**
 * Integration tests for routes/auth.js
 * Uses Supertest to send HTTP requests against the Express app.
 * Supabase is mocked to avoid real DB calls.
 */

const request = require('supertest');

// Disable rate limiting in tests
jest.mock('express-rate-limit', () => () => (req, res, next) => next());

// ── Mock dependencies before requiring the app ──────────────────────────────

jest.mock('../src/lib/db', () => {
  const mockUser = {
    id: 'user-123',
    username: 'testuser',
    email: 'test@example.com',
    password_hash: '$2b$12$hash', // placeholder — bcrypt.compare is mocked
    elo: 1200, elo_bullet: 1200, elo_blitz: 1200, elo_rapid: 1200,
    wins: 0, losses: 0, draws: 0, games_played: 0,
    trust_score: 100, flagged: false, online: false,
    email_verified: true, verify_token: null, reset_token: null,
    avatar_url: 'https://example.com/avatar.svg',
    created_at: new Date().toISOString(),
  };

  return {
    supabase: {},
    users: {
      create: jest.fn(async (data) => ({ ...mockUser, username: data.username, email: data.email })),
      findByEmail: jest.fn(async (email) => email === 'existing@example.com' ? mockUser : null),
      findByUsername: jest.fn(async (username) => username === 'existinguser' ? mockUser : null),
      findById: jest.fn(async () => mockUser),
      findByVerifyToken: jest.fn(async (token) =>
        token === 'valid-verify-token' ? { ...mockUser, email_verified: false, verify_token: 'valid-verify-token' } : null
      ),
      findByResetToken: jest.fn(async (token) =>
        token === 'valid-reset-token'
          ? { ...mockUser, reset_token: 'valid-reset-token', reset_token_expires: new Date(Date.now() + 3600000).toISOString() }
          : token === 'expired-reset-token'
          ? { ...mockUser, reset_token: 'expired-reset-token', reset_token_expires: new Date(Date.now() - 1000).toISOString() }
          : null
      ),
      update: jest.fn(async () => mockUser),
      public: jest.fn((u) => {
        if (!u) return null;
        const { password_hash, verify_token, reset_token, ...pub } = u;
        return pub;
      }),
    },
    wallets: {},
    transactions: {},
    games: {},
    notifications: {},
    eloHistory: {},
  };
});

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => '$2b$12$mocked-hash'),
  compare: jest.fn(async (plain, hash) => plain === 'correctpassword'),
}));

jest.mock('../src/lib/mailer', () => ({
  sendVerificationEmail: jest.fn(async () => {}),
  sendPasswordResetEmail: jest.fn(async () => {}),
}));

// Prevent server from actually listening on a port during tests
jest.mock('../src/lib/monitor', () => ({ startMonitor: jest.fn() }));
jest.mock('../src/lib/walletCleanup', () => ({ startWalletCleanupJob: jest.fn(), unlockForUser: jest.fn(), recordLock: jest.fn() }));

// ── Build the Express app only (not start server) ───────────────────────────

let app;
beforeAll(() => {
  // Require the router directly to avoid starting Socket.io
  const express = require('express');
  const a = express();
  a.use(express.json());
  a.use('/api/auth', require('../src/routes/auth'));
  app = a;
});

// ── Register tests ────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {

  it('returns 201 with token on successful registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', email: 'new@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('returns 400 for missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser' }); // missing email + password

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for short username (< 3 chars)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ab', email: 'new@example.com', password: 'password123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for username with invalid characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'user name!', email: 'new@example.com', password: 'password123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for short password (< 6 chars)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', email: 'new@example.com', password: '123' });

    expect(res.status).toBe(400);
  });

  it('returns 409 for duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser2', email: 'existing@example.com', password: 'password123' });

    expect(res.status).toBe(409);
  });

  it('returns 409 for duplicate username', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'existinguser', email: 'unique@example.com', password: 'password123' });

    expect(res.status).toBe(409);
  });
});

// ── Login tests ───────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {

  it('returns 200 with token on valid credentials (email)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'existing@example.com', password: 'correctpassword' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'existing@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('returns 401 for non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when neither email nor username provided', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'password123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bad-email', password: 'password123' });

    expect(res.status).toBe(400);
  });
});

// ── Email Verification ────────────────────────────────────────────────────────

describe('POST /api/auth/verify-email', () => {

  it('verifies email with valid token', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'valid-verify-token' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 for invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'bad-token' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing token', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── Password Reset ────────────────────────────────────────────────────────────

describe('POST /api/auth/forgot-password', () => {

  it('returns 200 for known email (and sends email)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'existing@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 200 even for unknown email (prevent enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/reset-password', () => {

  it('resets password with valid token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'valid-reset-token', password: 'newpassword123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 for invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'bad-token', password: 'newpassword123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for expired token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'expired-reset-token', password: 'newpassword123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('returns 400 for short password', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'valid-reset-token', password: '123' });

    expect(res.status).toBe(400);
  });
});

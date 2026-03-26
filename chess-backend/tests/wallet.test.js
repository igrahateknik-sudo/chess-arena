/**
 * Integration tests for routes/wallet.js
 */

const request = require('supertest');

// Disable rate limiting in tests
jest.mock('express-rate-limit', () => () => (req, res, next) => next());

jest.mock('../src/lib/db', () => ({
  supabase: {},
  users: {
    findById: jest.fn(async (id) => ({
      id, username: 'testuser', email: 'test@example.com',
      elo: 1200, trust_score: 100, flagged: false, email_verified: true,
    })),
    public: jest.fn((u) => u),
  },
  wallets: {
    getBalance: jest.fn(async () => ({ balance: 500000, locked: 0 })),
    debit: jest.fn(async () => {}),
    credit: jest.fn(async () => ({ balance: 550000 })),
  },
  transactions: {
    create: jest.fn(async (d) => ({ id: 'tx-123', ...d })),
    findByUserId: jest.fn(async () => []),
  },
}));

jest.mock('../src/lib/midtrans', () => ({
  createDepositTransaction: jest.fn(async () => ({
    snapToken: 'snap-token-123',
    snapUrl: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/token',
    orderId: 'order-123',
  })),
  createWithdrawRequest: jest.fn(async () => ({ orderId: 'withdraw-order-123' })),
  calculateFee: jest.fn((amount) => Math.floor(amount * 0.04)),
}));

jest.mock('../src/lib/auth', () => ({
  verifyToken: jest.fn(() => ({ userId: 'user-123' })),
  signToken: jest.fn(() => 'mock-token'),
}));

let app;
beforeAll(() => {
  const express = require('express');
  const a = express();
  a.use(express.json());
  a.use('/api/wallet', require('../src/routes/wallet'));
  app = a;
});

// ── Balance ───────────────────────────────────────────────────────────────────

describe('GET /api/wallet/balance', () => {
  it('returns balance for authenticated user', async () => {
    const res = await request(app)
      .get('/api/wallet/balance')
      .set('Authorization', 'Bearer mock-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('balance');
    expect(res.body).toHaveProperty('locked');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/wallet/balance');
    expect(res.status).toBe(401);
  });
});

// ── Deposit ───────────────────────────────────────────────────────────────────

describe('POST /api/wallet/deposit', () => {
  it('returns snapToken for valid deposit amount', async () => {
    const res = await request(app)
      .post('/api/wallet/deposit')
      .set('Authorization', 'Bearer mock-token')
      .send({ amount: 100000 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('snapToken');
    expect(res.body).toHaveProperty('orderId');
  });

  it('returns 400 for amount below minimum (< 10000)', async () => {
    const res = await request(app)
      .post('/api/wallet/deposit')
      .set('Authorization', 'Bearer mock-token')
      .send({ amount: 5000 });

    expect(res.status).toBe(400);
  });

  it('returns 400 for amount above maximum (> 100M)', async () => {
    const res = await request(app)
      .post('/api/wallet/deposit')
      .set('Authorization', 'Bearer mock-token')
      .send({ amount: 200_000_000 });

    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric amount', async () => {
    const res = await request(app)
      .post('/api/wallet/deposit')
      .set('Authorization', 'Bearer mock-token')
      .send({ amount: 'abc' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for negative amount', async () => {
    const res = await request(app)
      .post('/api/wallet/deposit')
      .set('Authorization', 'Bearer mock-token')
      .send({ amount: -50000 });

    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/wallet/deposit')
      .send({ amount: 100000 });

    expect(res.status).toBe(401);
  });
});

// ── Withdraw ──────────────────────────────────────────────────────────────────

describe('POST /api/wallet/withdraw', () => {
  const validBody = {
    amount: 100000,
    bankCode: 'BCA',
    accountNumber: '1234567890',
    accountName: 'John Doe',
  };

  it('returns orderId for valid withdrawal', async () => {
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', 'Bearer mock-token')
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('orderId');
    expect(res.body).toHaveProperty('fee');
    expect(res.body).toHaveProperty('net');
  });

  it('returns 400 for amount below minimum (< 50000)', async () => {
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', 'Bearer mock-token')
      .send({ ...validBody, amount: 10000 });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid bank code with special chars', async () => {
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', 'Bearer mock-token')
      .send({ ...validBody, bankCode: 'BC A!' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric account number', async () => {
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', 'Bearer mock-token')
      .send({ ...validBody, accountNumber: 'abc-123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing required field', async () => {
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', 'Bearer mock-token')
      .send({ amount: 100000, bankCode: 'BCA' }); // missing accountNumber, accountName

    expect(res.status).toBe(400);
  });
});

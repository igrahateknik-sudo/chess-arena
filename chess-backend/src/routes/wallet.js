const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { wallets, transactions } = require('../lib/db');
const { createDepositTransaction, createWithdrawRequest, calculateFee } = require('../lib/midtrans');
const { validate, schemas } = require('../middleware/validate');

// Rate limiter: max 5 deposit requests per user per 10 minutes
// Prevents spamming pending transactions or probing Midtrans API
const depositRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  keyGenerator: (req) => req.userId || req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many deposit requests. Please wait 10 minutes.' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter: max 3 withdrawal requests per user per hour
const withdrawRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyGenerator: (req) => req.userId || req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many withdrawal requests. Please wait 1 hour.' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── GET /api/wallet/balance ──────────────────────────────────────────────────
router.get('/balance', requireAuth, async (req, res) => {
  try {
    const wallet = await wallets.getBalance(req.userId);
    res.json({ balance: wallet.balance, locked: wallet.locked });
  } catch (err) {
    console.error('[wallet/balance]', err);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// ── GET /api/wallet/transactions ─────────────────────────────────────────────
router.get('/transactions', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const txs = await transactions.findByUserId(req.userId, limit);
    res.json({ transactions: txs });
  } catch (err) {
    console.error('[wallet/transactions]', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ── POST /api/wallet/deposit ─────────────────────────────────────────────────
router.post('/deposit', requireAuth, depositRateLimit, validate(schemas.deposit), async (req, res) => {
  try {
    const { amount } = req.body;

    const user = req.user;

    // Create Midtrans Snap transaction
    const { snapToken, snapUrl, orderId } = await createDepositTransaction({
      userId: user.id,
      username: user.username,
      email: user.email || `${user.username}@chess-arena.app`,
      amount,
    });

    // Record pending transaction in DB
    const tx = await transactions.create({
      user_id: user.id,
      type: 'deposit',
      amount,
      status: 'pending',
      description: `Deposit via Midtrans`,
      midtrans_order_id: orderId,
    });

    res.json({ snapToken, snapUrl, orderId, transactionId: tx.id });
  } catch (err) {
    console.error('[wallet/deposit]', err);
    res.status(500).json({ error: 'Failed to create deposit transaction' });
  }
});

// ── POST /api/wallet/withdraw ────────────────────────────────────────────────
router.post('/withdraw', requireAuth, withdrawRateLimit, validate(schemas.withdraw), async (req, res) => {
  try {
    const { amount, bankCode, accountNumber, accountName } = req.body;

    // Check balance
    const wallet = await wallets.getBalance(req.userId);
    const available = wallet.balance - wallet.locked;
    if (available < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const fee = calculateFee(amount);
    const net = amount - fee;

    // Debit balance immediately — funds are permanently removed from available balance.
    // This is correct for withdrawals (unlike match escrow which uses lock/unlock).
    // If withdrawal fails/rejected, admin creates a refund transaction to restore balance.
    await wallets.debit(req.userId, amount);

    // Create withdraw record
    const { orderId } = await createWithdrawRequest({
      userId: req.userId,
      username: req.user.username,
      bankCode,
      accountNumber,
      accountName,
      amount: net,
    });

    const tx = await transactions.create({
      user_id: req.userId,
      type: 'withdraw',
      amount: -amount,
      status: 'pending',
      description: `Withdraw to ${bankCode} ${accountNumber} (${accountName})`,
      midtrans_order_id: orderId,
    });

    res.json({
      orderId,
      fee,
      net,
      estimatedTime: '1-3 business days',
      transactionId: tx.id,
    });
  } catch (err) {
    console.error('[wallet/withdraw]', err);
    res.status(500).json({ error: 'Failed to create withdrawal request' });
  }
});

module.exports = router;

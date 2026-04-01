const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { wallets, transactions, manualDeposits, manualWithdrawals, supabase } = require('../lib/db');
const { createDepositTransaction, createWithdrawRequest, calculateFee } = require('../lib/midtrans');
const { validate, schemas } = require('../middleware/validate');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files allowed'));
    cb(null, true);
  },
});

const PRESET_AMOUNTS = [25000, 50000, 100000, 250000, 500000];
const BANK_INFO = {
  name: 'BCA',
  account_number: '0811329796',
  account_holder: 'ALI FAHKRUDIN',
};

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

// ── GET /api/wallet/bank-info ────────────────────────────────────────────────
router.get('/bank-info', (req, res) => {
  res.json({ bank: BANK_INFO, presetAmounts: PRESET_AMOUNTS });
});

// ── POST /api/wallet/manual-deposit ─────────────────────────────────────────
router.post('/manual-deposit', requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!PRESET_AMOUNTS.includes(Number(amount))) {
      return res.status(400).json({ error: 'Nominal tidak valid. Pilih dari: ' + PRESET_AMOUNTS.join(', ') });
    }

    // Block if user has a pending deposit already (avoid duplicate)
    const existing = await manualDeposits.findByUserId(req.userId, 5);
    const hasPending = existing.some(d => d.status === 'pending');
    if (hasPending) {
      return res.status(409).json({ error: 'Kamu masih memiliki deposit yang sedang diproses. Tunggu konfirmasi admin dulu.' });
    }

    const deposit = await manualDeposits.create(req.userId, Number(amount));

    res.status(201).json({
      ok: true,
      deposit: {
        id: deposit.id,
        amount: deposit.amount,
        uniqueCode: deposit.unique_code,
        transferAmount: deposit.transfer_amount,
        bank: BANK_INFO,
        status: deposit.status,
        createdAt: deposit.created_at,
      },
    });
  } catch (err) {
    console.error('[wallet/manual-deposit]', err);
    res.status(500).json({ error: 'Gagal membuat permintaan deposit' });
  }
});

// ── POST /api/wallet/manual-deposit/:id/proof ────────────────────────────────
router.post('/manual-deposit/:id/proof', requireAuth, upload.single('proof'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'File bukti transfer wajib diupload' });

    // Verify ownership
    const deposit = await manualDeposits.findById(id);
    if (!deposit) return res.status(404).json({ error: 'Deposit tidak ditemukan' });
    if (deposit.user_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });
    if (deposit.status !== 'pending') return res.status(409).json({ error: 'Deposit sudah diproses' });

    // Upload to Supabase Storage
    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const path = `deposits/${id}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from('deposit-proofs')
      .upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });
    if (uploadErr) throw uploadErr;

    const { data: { publicUrl } } = supabase.storage.from('deposit-proofs').getPublicUrl(path);

    await manualDeposits.setProof(id, req.userId, publicUrl);

    res.json({ ok: true, proofUrl: publicUrl });
  } catch (err) {
    console.error('[wallet/manual-deposit/proof]', err);
    res.status(500).json({ error: 'Gagal mengupload bukti transfer' });
  }
});

// ── GET /api/wallet/manual-deposits ──────────────────────────────────────────
router.get('/manual-deposits', requireAuth, async (req, res) => {
  try {
    const deposits = await manualDeposits.findByUserId(req.userId, 20);
    res.json({ deposits });
  } catch (err) {
    console.error('[wallet/manual-deposits]', err);
    res.status(500).json({ error: 'Gagal mengambil riwayat deposit' });
  }
});

// ── POST /api/wallet/manual-withdraw ─────────────────────────────────────────
router.post('/manual-withdraw', requireAuth, async (req, res) => {
  try {
    const { amount, bankName, accountNumber, accountName } = req.body;

    if (!amount || amount < 50000) {
      return res.status(400).json({ error: 'Minimum penarikan Rp 50.000' });
    }
    if (!bankName || !accountNumber || !accountName) {
      return res.status(400).json({ error: 'Nama bank, nomor rekening, dan nama pemilik wajib diisi' });
    }

    // Check available balance
    const wallet = await wallets.getBalance(req.userId);
    const available = wallet.balance - wallet.locked;
    if (available < amount) {
      return res.status(400).json({ error: 'Saldo tidak cukup' });
    }

    // Debit immediately so user can't double-withdraw
    await wallets.debit(req.userId, amount);

    const withdrawal = await manualWithdrawals.create(
      req.userId, amount, bankName.trim(), accountNumber.trim(), accountName.trim()
    );

    // Record in transactions table for wallet history
    await transactions.create({
      user_id: req.userId,
      type: 'withdraw',
      amount: -amount,
      status: 'pending',
      description: `Penarikan manual ke ${bankName} ${accountNumber} (${accountName})`,
    });

    res.status(201).json({
      ok: true,
      withdrawal: {
        id: withdrawal.id,
        amount: withdrawal.amount,
        bankName: withdrawal.bank_name,
        accountNumber: withdrawal.account_number,
        accountName: withdrawal.account_name,
        status: withdrawal.status,
        createdAt: withdrawal.created_at,
      },
    });
  } catch (err) {
    console.error('[wallet/manual-withdraw]', err);
    res.status(500).json({ error: 'Gagal membuat permintaan penarikan' });
  }
});

// ── GET /api/wallet/manual-withdrawals ───────────────────────────────────────
router.get('/manual-withdrawals', requireAuth, async (req, res) => {
  try {
    const withdrawals = await manualWithdrawals.findByUserId(req.userId, 20);
    res.json({ withdrawals });
  } catch (err) {
    console.error('[wallet/manual-withdrawals]', err);
    res.status(500).json({ error: 'Gagal mengambil riwayat penarikan' });
  }
});

module.exports = router;

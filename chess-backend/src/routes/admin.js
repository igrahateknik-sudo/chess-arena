/**
 * Admin Review Dashboard API
 *
 * Semua endpoint memerlukan admin auth (is_admin atau ADMIN_EMAILS env).
 *
 * GET  /api/admin/stats                    — ringkasan metrik anticheat
 * GET  /api/admin/flagged-users            — daftar user yang di-flag/suspend
 * POST /api/admin/users/:id/review         — review satu user (dismiss/confirm/escalate)
 * GET  /api/admin/anticheat-actions        — log tindakan anticheat terbaru
 * GET  /api/admin/collusion-flags          — flag kolusi belum ditinjau
 * POST /api/admin/collusion-flags/:id/review
 * GET  /api/admin/multi-account-flags      — flag multi-akun belum ditinjau
 * POST /api/admin/multi-account-flags/:id/review
 * GET  /api/admin/appeals                  — daftar banding user
 * POST /api/admin/appeals/:id/review       — approve/reject banding
 * GET  /api/admin/security-events          — log security events terbaru
 */

const express  = require('express');
const router   = express.Router();
const { requireAdmin } = require('../middleware/adminAuth');
const { supabase, wallets, transactions, manualDeposits, manualWithdrawals } = require('../lib/db');
const { logAnticheatAction } = require('../lib/auditLog');
const { checkQueueHealth }   = require('../lib/monitor');

// Semua route require admin
router.use(requireAdmin);

// ── GET /api/admin/stats ───────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [
      { count: totalFlagged },
      { count: pendingAppeals },
      { count: unreviewedCollusion },
      { count: unreviewedMultiAccount },
      { count: recentSuspends },
      { count: securityEventsToday },
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('flagged', true),
      supabase.from('appeals').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('collusion_flags').select('*', { count: 'exact', head: true }).eq('reviewed', false),
      supabase.from('multi_account_flags').select('*', { count: 'exact', head: true }).eq('reviewed', false),
      supabase.from('anticheat_actions').select('*', { count: 'exact', head: true })
        .eq('action', 'suspend')
        .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
      supabase.from('security_events').select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 86400000).toISOString()),
    ]);

    res.json({
      totalFlagged:          totalFlagged        || 0,
      pendingAppeals:        pendingAppeals       || 0,
      unreviewedCollusion:   unreviewedCollusion  || 0,
      unreviewedMultiAccount:unreviewedMultiAccount|| 0,
      recentSuspends7d:      recentSuspends       || 0,
      securityEventsToday:   securityEventsToday  || 0,
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ── GET /api/admin/flagged-users ──────────────────────────────────────────
router.get('/flagged-users', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1'));
    const limit = Math.min(50, parseInt(req.query.limit || '20'));
    const from  = (page - 1) * limit;

    const { data, count, error } = await supabase
      .from('users')
      .select('id, username, email, elo, trust_score, flagged, flagged_reason, flagged_at, created_at', { count: 'exact' })
      .eq('flagged', true)
      .order('flagged_at', { ascending: false })
      .range(from, from + limit - 1);

    if (error) throw error;

    // Ambil anticheat actions terbaru per user
    const userIds = (data || []).map(u => u.id);
    let actionsMap = {};
    if (userIds.length > 0) {
      const { data: actions } = await supabase
        .from('anticheat_actions')
        .select('user_id, action, reason, flags, score, created_at')
        .in('user_id', userIds)
        .order('created_at', { ascending: false });

      for (const a of (actions || [])) {
        if (!actionsMap[a.user_id]) actionsMap[a.user_id] = [];
        if (actionsMap[a.user_id].length < 5) actionsMap[a.user_id].push(a);
      }
    }

    const users = (data || []).map(u => ({
      ...u,
      recentActions: actionsMap[u.id] || [],
    }));

    res.json({ users, total: count || 0, page, limit });
  } catch (err) {
    console.error('[admin/flagged-users]', err);
    res.status(500).json({ error: 'Failed to load flagged users' });
  }
});

// ── POST /api/admin/users/:id/review ─────────────────────────────────────
router.post('/users/:id/review', async (req, res) => {
  try {
    const { id }                     = req.params;
    const { action, note, newTrust } = req.body;
    // action: 'dismiss' | 'confirm_suspend' | 'unsuspend' | 'set_trust'

    if (!['dismiss', 'confirm_suspend', 'unsuspend', 'set_trust'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const updates = { updated_at: new Date() };
    let actionLabel = action;

    if (action === 'dismiss') {
      updates.flagged        = false;
      updates.flagged_reason = null;
      updates.flagged_at     = null;
      updates.trust_score    = Math.min(100, (newTrust ?? 80)); // Reset sebagian
    } else if (action === 'confirm_suspend') {
      // Konfirmasi suspend — tidak perlu update flagged (sudah true), hanya catat reviewer
      updates.flagged_reason = `[Admin confirmed ${new Date().toISOString()}] ${note || ''}`.trim();
    } else if (action === 'unsuspend') {
      updates.flagged        = false;
      updates.flagged_reason = null;
      updates.flagged_at     = null;
      updates.trust_score    = Math.min(100, (newTrust ?? 70));
    } else if (action === 'set_trust') {
      if (typeof newTrust !== 'number' || newTrust < 0 || newTrust > 100) {
        return res.status(400).json({ error: 'newTrust must be 0-100' });
      }
      updates.trust_score = newTrust;
    }

    const { error } = await supabase.from('users').update(updates).eq('id', id);
    if (error) throw error;

    // Log tindakan admin
    await logAnticheatAction({
      userId:  id,
      gameId:  null,
      action:  `admin_${actionLabel}`,
      reason:  `Admin review by ${req.user.username}: ${note || 'no note'}`,
      flags:   [],
      score:   0,
    });

    res.json({ ok: true, action, userId: id });
  } catch (err) {
    console.error('[admin/users/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/anticheat-actions ─────────────────────────────────────
router.get('/anticheat-actions', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  || '1'));
    const limit  = Math.min(100, parseInt(req.query.limit || '50'));
    const from   = (page - 1) * limit;
    const action = req.query.action; // filter by action type

    let query = supabase
      .from('anticheat_actions')
      .select(`
        id, action, reason, flags, score, created_at,
        users:user_id (id, username, elo, trust_score),
        games:game_id (id)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (action) query = query.eq('action', action);

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({ actions: data || [], total: count || 0, page, limit });
  } catch (err) {
    console.error('[admin/anticheat-actions]', err);
    res.status(500).json({ error: 'Failed to load actions' });
  }
});

// ── GET /api/admin/collusion-flags ───────────────────────────────────────
router.get('/collusion-flags', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1'));
    const limit = Math.min(100, parseInt(req.query.limit || '50'));
    const from  = (page - 1) * limit;

    const { data, count, error } = await supabase
      .from('collusion_flags')
      .select(`
        id, pair_flags, gift_flags, pair_score, pair_stats, detected_at, reviewed, review_note,
        userA:user_id_a (id, username, elo, trust_score),
        userB:user_id_b (id, username, elo, trust_score),
        game:game_id (id)
      `, { count: 'exact' })
      .eq('reviewed', false)
      .order('detected_at', { ascending: false })
      .range(from, from + limit - 1);

    if (error) throw error;
    res.json({ flags: data || [], total: count || 0, page, limit });
  } catch (err) {
    console.error('[admin/collusion-flags]', err);
    res.status(500).json({ error: 'Failed to load collusion flags' });
  }
});

// ── POST /api/admin/collusion-flags/:id/review ───────────────────────────
router.post('/collusion-flags/:id/review', async (req, res) => {
  try {
    const { id }         = req.params;
    const { verdict, note } = req.body; // verdict: 'confirmed' | 'dismissed'

    if (!['confirmed', 'dismissed'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict must be confirmed or dismissed' });
    }

    await supabase
      .from('collusion_flags')
      .update({ reviewed: true, review_note: `${verdict}: ${note || ''} [by ${req.user.username}]` })
      .eq('id', id);

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/collusion-flags/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/multi-account-flags ───────────────────────────────────
router.get('/multi-account-flags', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1'));
    const limit = Math.min(100, parseInt(req.query.limit || '50'));
    const from  = (page - 1) * limit;

    const { data, count, error } = await supabase
      .from('multi_account_flags')
      .select(`
        id, fingerprint_hash, detected_at, reviewed, review_note,
        userA:user_id_a (id, username, email, elo, trust_score),
        userB:user_id_b (id, username, email, elo, trust_score)
      `, { count: 'exact' })
      .eq('reviewed', false)
      .order('detected_at', { ascending: false })
      .range(from, from + limit - 1);

    if (error) throw error;

    const flags = (data || []).map(f => ({
      ...f,
      fingerprint_hash: f.fingerprint_hash?.slice(0, 12) + '…', // redact
    }));

    res.json({ flags, total: count || 0, page, limit });
  } catch (err) {
    console.error('[admin/multi-account-flags]', err);
    res.status(500).json({ error: 'Failed to load multi-account flags' });
  }
});

// ── POST /api/admin/multi-account-flags/:id/review ───────────────────────
router.post('/multi-account-flags/:id/review', async (req, res) => {
  try {
    const { id }            = req.params;
    const { verdict, note } = req.body;

    if (!['confirmed', 'dismissed'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict must be confirmed or dismissed' });
    }

    await supabase
      .from('multi_account_flags')
      .update({ reviewed: true, review_note: `${verdict}: ${note || ''} [by ${req.user.username}]` })
      .eq('id', id);

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/multi-account-flags/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/appeals ────────────────────────────────────────────────
router.get('/appeals', async (req, res) => {
  try {
    const status = req.query.status || 'pending'; // pending | approved | rejected | all

    let query = supabase
      .from('appeals')
      .select(`
        id, reason, evidence, status, admin_note, created_at, reviewed_at,
        users:user_id (id, username, email, elo, trust_score, flagged, flagged_reason)
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (status !== 'all') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ appeals: data || [] });
  } catch (err) {
    console.error('[admin/appeals]', err);
    res.status(500).json({ error: 'Failed to load appeals' });
  }
});

// ── POST /api/admin/appeals/:id/review ───────────────────────────────────
router.post('/appeals/:id/review', async (req, res) => {
  try {
    const { id }              = req.params;
    const { verdict, note, restoreTrust } = req.body;
    // verdict: 'approved' | 'rejected'

    if (!['approved', 'rejected'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict must be approved or rejected' });
    }

    // Ambil appeal untuk dapat userId
    const { data: appeal, error: fetchErr } = await supabase
      .from('appeals')
      .select('user_id, status')
      .eq('id', id)
      .single();

    if (fetchErr || !appeal) return res.status(404).json({ error: 'Appeal not found' });
    if (appeal.status !== 'pending') return res.status(409).json({ error: 'Appeal already reviewed' });

    // Update appeal
    await supabase
      .from('appeals')
      .update({
        status:      verdict,
        admin_note:  note || '',
        reviewed_at: new Date(),
        reviewed_by: req.userId,
      })
      .eq('id', id);

    // Jika approved: unflag user, restore trust score
    if (verdict === 'approved') {
      const trustRestore = typeof restoreTrust === 'number'
        ? Math.min(100, Math.max(0, restoreTrust))
        : 75;

      await supabase
        .from('users')
        .update({
          flagged:        false,
          flagged_reason: null,
          flagged_at:     null,
          trust_score:    trustRestore,
          updated_at:     new Date(),
        })
        .eq('id', appeal.user_id);

      console.info(`[Admin] Appeal ${id} APPROVED — user ${appeal.user_id} restored (trust=${trustRestore})`);
    } else {
      console.info(`[Admin] Appeal ${id} REJECTED — user ${appeal.user_id}`);
    }

    await logAnticheatAction({
      userId:  appeal.user_id,
      gameId:  null,
      action:  `appeal_${verdict}`,
      reason:  `Admin ${req.user.username}: ${note || 'no note'}`,
      flags:   [],
      score:   0,
    });

    res.json({ ok: true, verdict, userId: appeal.user_id });
  } catch (err) {
    console.error('[admin/appeals/review]', err);
    res.status(500).json({ error: 'Review failed' });
  }
});

// ── GET /api/admin/queue-health ──────────────────────────────────────────
router.get('/queue-health', async (req, res) => {
  try {
    const { report } = await checkQueueHealth();
    const statusCode  = report.healthy ? 200 : 207; // 207 = multi-status (some unhealthy)
    res.status(statusCode).json(report);
  } catch (err) {
    console.error('[admin/queue-health]', err);
    res.status(500).json({ error: 'Health check failed' });
  }
});

// ── GET /api/admin/security-events ───────────────────────────────────────
router.get('/security-events', async (req, res) => {
  try {
    const limit    = Math.min(200, parseInt(req.query.limit || '50'));
    const eventType = req.query.type; // filter by type

    let query = supabase
      .from('security_events')
      .select('id, event_type, user_id, details, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (eventType) query = query.eq('event_type', eventType);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ events: data || [] });
  } catch (err) {
    console.error('[admin/security-events]', err);
    res.status(500).json({ error: 'Failed to load security events' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// MANUAL PAYMENTS
// ══════════════════════════════════════════════════════════════════════════

// ── GET /api/admin/manual-deposits ──────────────────────────────────────
router.get('/manual-deposits', async (req, res) => {
  try {
    const status = req.query.status || 'pending'; // pending | approved | rejected | all
    const deposits = await manualDeposits.listAll(status, 100);
    res.json({ deposits });
  } catch (err) {
    console.error('[admin/manual-deposits]', err);
    res.status(500).json({ error: 'Failed to load deposits' });
  }
});

// ── POST /api/admin/manual-deposits/:id/approve ──────────────────────────
router.post('/manual-deposits/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;

    const deposit = await manualDeposits.findById(id);
    if (!deposit) return res.status(404).json({ error: 'Deposit not found' });
    if (deposit.status !== 'pending') return res.status(409).json({ error: 'Deposit already processed' });

    // Approve deposit record
    await manualDeposits.approve(id, req.userId);

    // Credit user wallet
    await wallets.credit(deposit.user_id, deposit.amount);

    // Record in transactions for wallet history
    await transactions.create({
      user_id: deposit.user_id,
      type: 'deposit',
      amount: deposit.amount,
      status: 'success',
      description: `Deposit manual disetujui admin (Rp ${deposit.transfer_amount})`,
    });

    console.info(`[Admin] Deposit ${id} APPROVED — user ${deposit.user_id}, amount ${deposit.amount}`);
    res.json({ ok: true, depositId: id, userId: deposit.user_id, amount: deposit.amount });
  } catch (err) {
    console.error('[admin/manual-deposits/approve]', err);
    res.status(500).json({ error: 'Failed to approve deposit' });
  }
});

// ── POST /api/admin/manual-deposits/:id/reject ───────────────────────────
router.post('/manual-deposits/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const deposit = await manualDeposits.findById(id);
    if (!deposit) return res.status(404).json({ error: 'Deposit not found' });
    if (deposit.status !== 'pending') return res.status(409).json({ error: 'Deposit already processed' });

    await manualDeposits.reject(id, req.userId, note);

    console.info(`[Admin] Deposit ${id} REJECTED — user ${deposit.user_id}`);
    res.json({ ok: true, depositId: id });
  } catch (err) {
    console.error('[admin/manual-deposits/reject]', err);
    res.status(500).json({ error: 'Failed to reject deposit' });
  }
});

// ── GET /api/admin/manual-withdrawals ────────────────────────────────────
router.get('/manual-withdrawals', async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const withdrawals = await manualWithdrawals.listAll(status, 100);
    res.json({ withdrawals });
  } catch (err) {
    console.error('[admin/manual-withdrawals]', err);
    res.status(500).json({ error: 'Failed to load withdrawals' });
  }
});

// ── POST /api/admin/manual-withdrawals/:id/approve ───────────────────────
router.post('/manual-withdrawals/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const withdrawal = await manualWithdrawals.findById(id);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    if (withdrawal.status !== 'pending') return res.status(409).json({ error: 'Withdrawal already processed' });

    await manualWithdrawals.approve(id, req.userId, note);

    console.info(`[Admin] Withdrawal ${id} APPROVED — user ${withdrawal.user_id}`);
    res.json({ ok: true, withdrawalId: id });
  } catch (err) {
    console.error('[admin/manual-withdrawals/approve]', err);
    res.status(500).json({ error: 'Failed to approve withdrawal' });
  }
});

// ── POST /api/admin/manual-withdrawals/:id/complete ──────────────────────
router.post('/manual-withdrawals/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const withdrawal = await manualWithdrawals.findById(id);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    if (withdrawal.status !== 'approved') return res.status(409).json({ error: 'Withdrawal must be approved first' });

    await manualWithdrawals.complete(id, req.userId, note);

    // Update the pending transaction to success
    const { data: txs } = await supabase
      .from('transactions')
      .select('id')
      .eq('user_id', withdrawal.user_id)
      .eq('type', 'withdraw')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);
    if (txs && txs[0]) {
      await supabase.from('transactions').update({ status: 'success' }).eq('id', txs[0].id);
    }

    console.info(`[Admin] Withdrawal ${id} COMPLETED — user ${withdrawal.user_id}`);
    res.json({ ok: true, withdrawalId: id });
  } catch (err) {
    console.error('[admin/manual-withdrawals/complete]', err);
    res.status(500).json({ error: 'Failed to complete withdrawal' });
  }
});

// ── POST /api/admin/manual-withdrawals/:id/reject ────────────────────────
router.post('/manual-withdrawals/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const withdrawal = await manualWithdrawals.findById(id);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
    if (!['pending', 'approved'].includes(withdrawal.status)) {
      return res.status(409).json({ error: 'Withdrawal already finalized' });
    }

    await manualWithdrawals.reject(id, req.userId, note);

    // Refund user balance
    await wallets.credit(withdrawal.user_id, withdrawal.amount);

    await transactions.create({
      user_id: withdrawal.user_id,
      type: 'refund',
      amount: withdrawal.amount,
      status: 'success',
      description: `Refund penarikan ditolak admin: ${note || ''}`,
    });

    console.info(`[Admin] Withdrawal ${id} REJECTED + REFUNDED — user ${withdrawal.user_id}`);
    res.json({ ok: true, withdrawalId: id, refunded: withdrawal.amount });
  } catch (err) {
    console.error('[admin/manual-withdrawals/reject]', err);
    res.status(500).json({ error: 'Failed to reject withdrawal' });
  }
});

module.exports = router;

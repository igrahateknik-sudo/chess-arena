const { Router } = require('express');
const router = Router();
const crypto = require('crypto');
const { verifyNotification } = require('../lib/midtrans');
const { wallets, transactions } = require('../lib/db');

// In-memory set of processed order IDs for fast idempotency check within process lifetime.
// DB check below is the authoritative source — this is an optimization.
const processedOrders = new Set();

/**
 * POST /api/webhook/midtrans
 * Midtrans sends payment notifications here.
 * Verify signature, then credit wallet on success.
 *
 * Security:
 *  [1] SHA-512 signature MUST be present and valid (no bypass)
 *  [2] Timestamp validation — reject webhooks older than 5 minutes (replay attack prevention)
 *  [3] Re-verified against Midtrans API (double-check)
 *  [4] Idempotency — completed transactions never re-credited (in-memory + DB check)
 *  [5] Amount cross-validation — grossAmount must match DB record
 *  [6] Fraud status check — only credit if fraud_status = accept or absent
 */
router.post('/midtrans', async (req, res) => {
  try {
    const body = req.body;

    // [SECURITY-1] Signature MUST be present — no bypass allowed
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    if (!body || !body.order_id || !body.status_code || !body.gross_amount) {
      console.warn('[webhook/midtrans] Missing required fields in notification body');
      return res.status(400).json({ error: 'Invalid notification body' });
    }

    const signatureRaw = `${body.order_id}${body.status_code}${body.gross_amount}${serverKey}`;
    const expectedSig = crypto.createHash('sha512').update(signatureRaw).digest('hex');

    if (!body.signature_key || body.signature_key !== expectedSig) {
      console.warn('[webhook/midtrans] Invalid or missing signature for order', body.order_id);
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // [SECURITY-2] Timestamp validation — reject if webhook is older than 5 minutes.
    // Midtrans includes transaction_time in ISO 8601 format (e.g. "2024-01-01 12:00:00").
    // This prevents replay attacks where an old successful webhook is re-submitted.
    if (body.transaction_time) {
      const webhookTs = new Date(body.transaction_time).getTime();
      const ageMs = Date.now() - webhookTs;
      const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

      if (ageMs > MAX_AGE_MS && process.env.NODE_ENV === 'production') {
        console.warn(
          `[webhook/midtrans] Stale webhook rejected: order=${body.order_id} ` +
          `age=${Math.round(ageMs / 1000)}s (max ${MAX_AGE_MS / 1000}s)`
        );
        // Return 200 so Midtrans stops retrying — this is intentional rejection, not a server error.
        return res.status(200).json({ ok: false, message: 'Webhook too old — ignored' });
      }
    }

    // Fast idempotency check (in-memory, avoids a DB round-trip for re-deliveries)
    if (processedOrders.has(body.order_id)) {
      console.log(`[webhook/midtrans] Already processed (in-memory): ${body.order_id}`);
      return res.json({ ok: true, message: 'Already processed' });
    }

    // [SECURITY-3] Re-verify with Midtrans API for extra safety
    let statusResponse;
    try {
      statusResponse = await verifyNotification(body);
    } catch (verifyErr) {
      console.error('[webhook/midtrans] Midtrans verify error:', verifyErr.message);
      // Return 500 so Midtrans will retry the webhook
      return res.status(500).json({ error: 'Verification failed' });
    }

    const orderId            = statusResponse.order_id;
    const transactionStatus  = statusResponse.transaction_status;
    const fraudStatus        = statusResponse.fraud_status;
    // Parse gross_amount safely (Midtrans may send "50000.00")
    const grossAmount        = Math.round(parseFloat(statusResponse.gross_amount));

    console.log(`[webhook/midtrans] order=${orderId} status=${transactionStatus} fraud=${fraudStatus} amount=${grossAmount}`);

    // Find our transaction record
    const tx = await transactions.findByOrderId(orderId);
    if (!tx) {
      console.warn('[webhook/midtrans] Transaction not found:', orderId);
      // Return 404 — Midtrans won't retry on 4xx
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // [SECURITY-4] Idempotency — don't double-credit (DB-authoritative check)
    if (tx.status === 'completed') {
      processedOrders.add(orderId); // warm in-memory cache
      console.log(`[webhook/midtrans] Already processed: ${orderId}`);
      return res.json({ ok: true, message: 'Already processed' });
    }

    // [SECURITY-5] Amount cross-validation — prevent manipulated amounts
    // Allow ±1 IDR rounding difference (Midtrans may round decimal)
    if (Math.abs(grossAmount - tx.amount) > 1) {
      console.error(
        `[webhook/midtrans] AMOUNT MISMATCH order=${orderId} ` +
        `expected=${tx.amount} got=${grossAmount}`
      );
      // Log as security event — do NOT credit, do NOT return 500 (would cause retry)
      await transactions.update(tx.id, {
        status:       'failed',
        midtrans_raw: { ...statusResponse, _audit: 'AMOUNT_MISMATCH' },
      });
      return res.status(400).json({ error: 'Amount mismatch' });
    }

    let newStatus = 'pending';

    if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
      // [SECURITY-6] Fraud status check — deny/challenge blocks credit
      if (fraudStatus === 'accept' || !fraudStatus) {
        newStatus = 'completed';

        // Credit uses atomic DB RPC function (no race condition)
        const wallet = await wallets.credit(tx.user_id, grossAmount);

        await transactions.update(tx.id, {
          status:              'completed',
          balance_after:       wallet?.balance,
          midtrans_payment_type: statusResponse.payment_type,
          midtrans_va_number:
            statusResponse.va_numbers?.[0]?.va_number ||
            statusResponse.payment_code ||
            null,
          midtrans_raw: statusResponse,
        });

        // Mark as processed in both in-memory set and DB
        processedOrders.add(orderId);

        console.log(`[webhook/midtrans] ✅ Credited ${grossAmount} to user ${tx.user_id} (order: ${orderId})`);
      } else {
        // fraudStatus = challenge or deny — do not credit
        newStatus = 'failed';
        console.warn(`[webhook/midtrans] ⚠️ Fraud status=${fraudStatus} for order ${orderId} — NOT credited`);
        await transactions.update(tx.id, {
          status:       'failed',
          midtrans_raw: statusResponse,
        });
      }
    } else if (transactionStatus === 'pending') {
      newStatus = 'pending';
      await transactions.update(tx.id, {
        status:       'pending',
        midtrans_raw: statusResponse,
      });
    } else if (['deny', 'expire', 'cancel', 'failure'].includes(transactionStatus)) {
      newStatus = 'failed';
      await transactions.update(tx.id, {
        status:       'failed',
        midtrans_raw: statusResponse,
      });
    }

    res.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error('[webhook/midtrans] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

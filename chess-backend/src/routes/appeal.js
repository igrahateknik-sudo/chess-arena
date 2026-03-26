/**
 * Appeal Process API — User-facing
 *
 * POST /api/appeal          — Submit banding baru
 * GET  /api/appeal/mine     — Lihat status banding sendiri
 */

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { supabase }    = require('../lib/db');

// ── POST /api/appeal ──────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { reason, evidence } = req.body;
    const userId = req.userId;

    if (!reason || reason.trim().length < 20) {
      return res.status(400).json({ error: 'Reason must be at least 20 characters' });
    }
    if (reason.length > 2000) {
      return res.status(400).json({ error: 'Reason too long (max 2000 chars)' });
    }

    // Cek apakah user memang terkena flag/suspend
    const { data: user } = await supabase
      .from('users')
      .select('flagged, flagged_reason, trust_score')
      .eq('id', userId)
      .single();

    if (!user?.flagged) {
      return res.status(400).json({ error: 'No active flag on your account to appeal' });
    }

    // Cek apakah sudah ada banding pending
    const { data: existing } = await supabase
      .from('appeals')
      .select('id, status')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: 'You already have a pending appeal',
        appealId: existing.id,
      });
    }

    // Batasi: max 3 appeal total per user (termasuk rejected).
    // NOTE: To make this truly race-safe, add a DB check constraint:
    //   ALTER TABLE appeals ADD CONSTRAINT appeals_max_per_user
    //     CHECK (... via trigger or partial unique index).
    // The JS-level count check below reduces the race window but is not atomic.
    const { count } = await supabase
      .from('appeals')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if ((count || 0) >= 3) {
      return res.status(429).json({ error: 'Maximum appeal limit reached (3). Contact support directly.' });
    }

    const { data: appeal, error } = await supabase
      .from('appeals')
      .insert({
        user_id:        userId,
        reason:         reason.trim(),
        evidence:       evidence?.trim() || null,
        status:         'pending',
        flag_reason_at: user.flagged_reason,
        trust_at:       user.trust_score,
      })
      .select()
      .single();

    // Catch race: if insert fails due to a DB constraint violation (duplicate pending appeal
    // or over-limit), return a user-friendly error rather than a 500.
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'You already have a pending appeal' });
      }
      if (error.code === '23514') {
        return res.status(429).json({ error: 'Maximum appeal limit reached (3). Contact support directly.' });
      }
      throw error;
    }

    console.info(`[Appeal] User ${userId} submitted appeal ${appeal.id}`);

    res.status(201).json({
      appeal: {
        id:         appeal.id,
        status:     appeal.status,
        created_at: appeal.created_at,
      },
      message: 'Appeal submitted. Our team will review it within 48 hours.',
    });
  } catch (err) {
    console.error('[appeal/submit]', err);
    res.status(500).json({ error: 'Failed to submit appeal' });
  }
});

// ── GET /api/appeal/mine ──────────────────────────────────────────────────
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('appeals')
      .select('id, reason, status, admin_note, created_at, reviewed_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Juga ambil status akun saat ini
    const { data: user } = await supabase
      .from('users')
      .select('flagged, flagged_reason, trust_score')
      .eq('id', req.userId)
      .single();

    res.json({
      appeals: data || [],
      account: {
        flagged:       user?.flagged       || false,
        flaggedReason: user?.flagged_reason|| null,
        trustScore:    user?.trust_score   ?? 100,
      },
    });
  } catch (err) {
    console.error('[appeal/mine]', err);
    res.status(500).json({ error: 'Failed to load appeals' });
  }
});

module.exports = router;

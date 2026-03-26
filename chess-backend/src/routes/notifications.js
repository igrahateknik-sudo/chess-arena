const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { notifications } = require('../lib/db');

// GET /api/notifications — ambil notifikasi belum dibaca
router.get('/', requireAuth, async (req, res) => {
  try {
    const notifs = await notifications.getUnread(req.userId);
    res.json({ notifications: notifs });
  } catch (err) {
    console.error('[notifications/get]', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PATCH /api/notifications/read — tandai semua sudah dibaca
router.patch('/read', requireAuth, async (req, res) => {
  try {
    await notifications.markAllRead(req.userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications/read]', err);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// PATCH /api/notifications/:id/read — tandai satu notifikasi sudah dibaca
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const notif = await notifications.markOneRead(req.params.id, req.userId);
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true, notification: notif });
  } catch (err) {
    console.error('[notifications/read-one]', err);
    // Supabase returns no rows if id doesn't exist or userId doesn't match
    if (err.code === 'PGRST116') return res.status(404).json({ error: 'Notification not found' });
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

module.exports = router;

/**
 * Admin Review Queue Monitor — SLA Enforcement
 *
 * Memeriksa secara berkala apakah ada item di review queue yang
 * melebihi SLA threshold dan mengirim alert.
 *
 * SLA Targets:
 *  - Appeals:              48 jam  (real-money user menunggu)
 *  - Collusion flags:      72 jam  (match-fixing investigation)
 *  - Multi-account flags:  72 jam  (account integrity)
 *  - Suspended users:      96 jam  (orang tidak bisa main)
 *
 * Alert Channels:
 *  - Console log (always)
 *  - Email via nodemailer (jika ADMIN_EMAIL + SMTP_* env vars di-set)
 *  - Webhook POST (jika MONITOR_WEBHOOK_URL di-set, mis: Slack/Discord/n8n)
 */

const { supabase } = require('./db');
const nodemailer   = require('nodemailer');

// ── Config ────────────────────────────────────────────────────────────────

const SLA_HOURS = {
  appeals:       48,
  collusion:     72,
  multiAccount:  72,
  suspended:     96,
};

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // setiap 1 jam

// ── Transporter Email (opsional) ──────────────────────────────────────────

let mailer = null;

function getMailer() {
  if (mailer) return mailer;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;

  mailer = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return mailer;
}

// ── Alert Sender ──────────────────────────────────────────────────────────

async function sendAlert(subject, body, urgency = 'normal') {
  const prefix = urgency === 'critical' ? '🚨 CRITICAL' : '⚠️  WARNING';
  const fullSubject = `[Chess Arena Admin] ${prefix}: ${subject}`;

  // Always log
  console.warn(`[MONITOR] ${fullSubject}`);
  console.warn(`[MONITOR] ${body}`);

  // Email
  const transport = getMailer();
  if (transport && process.env.ADMIN_EMAIL) {
    try {
      await transport.sendMail({
        from:    `Chess Arena Monitor <${process.env.SMTP_USER}>`,
        to:      process.env.ADMIN_EMAIL,
        subject: fullSubject,
        text:    body,
        html:    `<pre style="font-family:monospace">${body}</pre>`,
      });
      console.log(`[MONITOR] Email alert sent to ${process.env.ADMIN_EMAIL}`);
    } catch (e) {
      console.error('[MONITOR] Email send failed:', e.message);
    }
  }

  // Webhook (Slack, Discord, custom)
  if (process.env.MONITOR_WEBHOOK_URL) {
    try {
      const payload = {
        text:    `*${fullSubject}*\n\`\`\`${body}\`\`\``,
        // Discord format
        embeds:  [{ title: fullSubject, description: body, color: urgency === 'critical' ? 0xff0000 : 0xffa500 }],
      };
      await fetch(process.env.MONITOR_WEBHOOK_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      console.log('[MONITOR] Webhook alert sent');
    } catch (e) {
      console.error('[MONITOR] Webhook send failed:', e.message);
    }
  }
}

// ── Queue Health Check ────────────────────────────────────────────────────

/**
 * Periksa semua queue dan return health report.
 * Dipanggil oleh interval timer dan oleh /api/admin/queue-health.
 */
async function checkQueueHealth() {
  const now       = new Date();
  const alerts    = [];
  const report    = {};

  // ── Appeals ──
  try {
    const slaThreshold = new Date(now - SLA_HOURS.appeals * 3600000).toISOString();
    const { data: overdue, count } = await supabase
      .from('appeals')
      .select('id, created_at, users:user_id(username)', { count: 'exact' })
      .eq('status', 'pending')
      .lt('created_at', slaThreshold);

    const { count: total } = await supabase
      .from('appeals')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    report.appeals = {
      pending:       total || 0,
      overdueSla:    count || 0,
      slaHours:      SLA_HOURS.appeals,
      healthy:       (count || 0) === 0,
    };

    if ((count || 0) > 0) {
      const usernames = (overdue || []).map(a => a.users?.username || 'unknown').join(', ');
      alerts.push({
        urgency: (count || 0) >= 5 ? 'critical' : 'normal',
        subject: `${count} appeal(s) past ${SLA_HOURS.appeals}h SLA`,
        body:    `${count} appeal(s) are overdue for review (>${SLA_HOURS.appeals}h pending).\nUsers: ${usernames}\n\nReview at: ${process.env.FRONTEND_URL}/admin`,
      });
    }
  } catch (e) {
    console.error('[MONITOR] Appeals check failed:', e.message);
    report.appeals = { error: e.message };
  }

  // ── Collusion Flags ──
  try {
    const slaThreshold = new Date(now - SLA_HOURS.collusion * 3600000).toISOString();
    const { count: overdue } = await supabase
      .from('collusion_flags')
      .select('*', { count: 'exact', head: true })
      .eq('reviewed', false)
      .lt('detected_at', slaThreshold);

    const { count: total } = await supabase
      .from('collusion_flags')
      .select('*', { count: 'exact', head: true })
      .eq('reviewed', false);

    report.collusionFlags = {
      unreviewed:  total || 0,
      overdueSla:  overdue || 0,
      slaHours:    SLA_HOURS.collusion,
      healthy:     (overdue || 0) === 0,
    };

    if ((overdue || 0) > 0) {
      alerts.push({
        urgency: 'normal',
        subject: `${overdue} collusion flag(s) past ${SLA_HOURS.collusion}h SLA`,
        body:    `${overdue} collusion investigation(s) need review.\nReview at: ${process.env.FRONTEND_URL}/admin`,
      });
    }
  } catch (e) {
    console.error('[MONITOR] Collusion check failed:', e.message);
    report.collusionFlags = { error: e.message };
  }

  // ── Multi-Account Flags ──
  try {
    const slaThreshold = new Date(now - SLA_HOURS.multiAccount * 3600000).toISOString();
    const { count: overdue } = await supabase
      .from('multi_account_flags')
      .select('*', { count: 'exact', head: true })
      .eq('reviewed', false)
      .lt('detected_at', slaThreshold);

    const { count: total } = await supabase
      .from('multi_account_flags')
      .select('*', { count: 'exact', head: true })
      .eq('reviewed', false);

    report.multiAccountFlags = {
      unreviewed:  total || 0,
      overdueSla:  overdue || 0,
      slaHours:    SLA_HOURS.multiAccount,
      healthy:     (overdue || 0) === 0,
    };

    if ((overdue || 0) > 0) {
      alerts.push({
        urgency: 'normal',
        subject: `${overdue} multi-account flag(s) past ${SLA_HOURS.multiAccount}h SLA`,
        body:    `${overdue} multi-account case(s) need review.\nReview at: ${process.env.FRONTEND_URL}/admin`,
      });
    }
  } catch (e) {
    console.error('[MONITOR] Multi-account check failed:', e.message);
    report.multiAccountFlags = { error: e.message };
  }

  // ── Long-Suspended Users (tanpa appeal approved) ──
  try {
    const slaThreshold = new Date(now - SLA_HOURS.suspended * 3600000).toISOString();
    const { count: longSuspended } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('flagged', true)
      .lt('flagged_at', slaThreshold);

    report.longSuspended = {
      count:    longSuspended || 0,
      slaHours: SLA_HOURS.suspended,
      healthy:  (longSuspended || 0) === 0,
    };

    if ((longSuspended || 0) > 0) {
      alerts.push({
        urgency: (longSuspended || 0) >= 3 ? 'critical' : 'normal',
        subject: `${longSuspended} user(s) suspended for >${SLA_HOURS.suspended}h without resolution`,
        body:    `${longSuspended} account(s) have been suspended for over ${SLA_HOURS.suspended} hours.\nPlease review or close these cases.\nAdmin panel: ${process.env.FRONTEND_URL}/admin`,
      });
    }
  } catch (e) {
    console.error('[MONITOR] Suspended check failed:', e.message);
    report.longSuspended = { error: e.message };
  }

  // ── Summary ──
  report.checkedAt    = now.toISOString();
  report.totalAlerts  = alerts.length;
  report.healthy      = alerts.length === 0;

  return { report, alerts };
}

// ── Interval Runner ───────────────────────────────────────────────────────

let monitorInterval = null;

async function runMonitorCycle() {
  try {
    const { report, alerts } = await checkQueueHealth();

    if (alerts.length === 0) {
      console.log(`[MONITOR] Queue health OK — ${new Date().toISOString()}`);
    } else {
      console.warn(`[MONITOR] ${alerts.length} alert(s) found`);
      // Send alerts (deduplicated — kirim sebagai satu email/webhook)
      for (const alert of alerts) {
        await sendAlert(alert.subject, alert.body, alert.urgency);
      }
    }

    return report;
  } catch (err) {
    console.error('[MONITOR] Cycle error:', err.message);
  }
}

function startMonitor() {
  if (monitorInterval) return; // Already running

  console.log(`[MONITOR] Starting queue health monitor (interval: ${CHECK_INTERVAL_MS / 60000}m)`);

  // Run immediately on startup
  setTimeout(runMonitorCycle, 30_000); // delay 30s after server start

  // Then every hour
  monitorInterval = setInterval(runMonitorCycle, CHECK_INTERVAL_MS);

  // Prevent interval from blocking process exit
  if (monitorInterval.unref) monitorInterval.unref();
}

function stopMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

module.exports = { startMonitor, stopMonitor, checkQueueHealth, runMonitorCycle };

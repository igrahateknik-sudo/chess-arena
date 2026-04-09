/**
 * Chess Arena — Cloudflare Worker Alerting Layer
 *
 * Ditambahkan ke worker.js untuk mendeteksi anomali real-time:
 *  1. Auth brute-force spike (> 50 auth blocks dalam 1 menit per isolate)
 *  2. High 400/403 rate (> 30 bad requests dalam 1 menit)
 *  3. Unusual traffic spike (> 500 req/menit global)
 *
 * Alert dikirim via Cloudflare Workers Analytics Engine atau
 * webhook ke Discord / email (konfigurasi ALERT_WEBHOOK_URL env var).
 *
 * CARA PAKAI:
 *   Import di worker.js:
 *     import { trackRequest, getAlertSummary } from './alerting.js';
 *   Di fetch handler, setelah setiap response:
 *     trackRequest(path, responseStatus, ip);
 */

// ── In-memory counters (reset per isolate lifecycle) ─────────────────────────
const counters = {
  authBlocks:   0,
  badRequests:  0,
  totalRequests: 0,
  resetAt: Date.now() + 60_000,
};

function resetIfExpired() {
  if (Date.now() > counters.resetAt) {
    counters.authBlocks   = 0;
    counters.badRequests  = 0;
    counters.totalRequests = 0;
    counters.resetAt = Date.now() + 60_000;
  }
}

export function trackRequest(path, status, ip) {
  resetIfExpired();
  counters.totalRequests++;

  if (status === 429 && (path.includes('/auth/login') || path.includes('/auth/register'))) {
    counters.authBlocks++;
  }
  if (status === 400 || status === 403) {
    counters.badRequests++;
  }
}

export function getAlertSummary() {
  resetIfExpired();
  const alerts = [];

  if (counters.authBlocks > 50) {
    alerts.push({
      type: 'BRUTE_FORCE_SPIKE',
      severity: 'HIGH',
      message: `Auth brute-force spike: ${counters.authBlocks} blocks in last minute`,
      count: counters.authBlocks,
    });
  }

  if (counters.badRequests > 30) {
    alerts.push({
      type: 'HIGH_BAD_REQUEST_RATE',
      severity: 'MEDIUM',
      message: `High bad request rate: ${counters.badRequests} 400/403 in last minute`,
      count: counters.badRequests,
    });
  }

  if (counters.totalRequests > 500) {
    alerts.push({
      type: 'TRAFFIC_SPIKE',
      severity: 'LOW',
      message: `Traffic spike: ${counters.totalRequests} req/min`,
      count: counters.totalRequests,
    });
  }

  return { alerts, counters: { ...counters } };
}

/**
 * Kirim alert ke webhook (Discord / Slack / custom)
 * Panggil dari worker fetch handler jika getAlertSummary().alerts.length > 0
 */
export async function sendAlertWebhook(webhookUrl, alerts) {
  if (!webhookUrl || alerts.length === 0) return;

  const body = {
    content: alerts.map(a =>
      `**[${a.severity}] ${a.type}**\n${a.message}`
    ).join('\n\n'),
    username: 'Chess Arena Security',
  };

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {}); // non-fatal
}

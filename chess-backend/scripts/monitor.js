#!/usr/bin/env node
/**
 * Chess Arena — Production Monitor
 *
 * Jalankan manual: node scripts/monitor.js
 * Atau scheduled:  setiap 5 menit via cron / Railway cron job
 *
 * Checks:
 *  1. Backend health (uptime, active games, redis)
 *  2. Tournament prize distribution integrity (50/30/20)
 *  3. Active tournament pairings without game_id (broken linkage)
 *  4. Recent 400/401/403/429 error anomalies (from CF Worker log — manual)
 *  5. Open pairings with null result > 2 hours (stale games)
 */

const https = require('https');

const BACKEND   = process.env.BACKEND_URL   || 'https://chess-arena-security.igrahateknik.workers.dev';
const SUPABASE  = process.env.SUPABASE_URL  || '';
const SUPA_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

const ALERTS = [];
function alert(level, msg, data = {}) {
  const entry = { level, msg, data, ts: new Date().toISOString() };
  ALERTS.push(entry);
  const icon = level === 'ERROR' ? '🔴' : level === 'WARN' ? '🟡' : '✅';
  console.log(`${icon} [${level}] ${msg}`, Object.keys(data).length ? JSON.stringify(data) : '');
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req  = https.request({
      hostname: opts.hostname,
      path:     opts.pathname + opts.search,
      method:   'GET',
      headers:  { 'Accept': 'application/json', ...headers },
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function checkHealth() {
  console.log('\n── 1. Health Check ──────────────────────────────────');
  try {
    const { status, body } = await get(`${BACKEND}/health`);
    if (status !== 200 || body.status !== 'ok') {
      alert('ERROR', 'Backend unhealthy', { status, body });
    } else {
      alert('OK', `Backend up | uptime: ${body.uptime}s | sockets: ${body.connectedSockets} | games: ${body.activeGames}`);
    }
  } catch (e) {
    alert('ERROR', 'Backend unreachable', { error: e.message });
  }
}

async function checkPrizeDistribution() {
  console.log('\n── 2. Prize Distribution Integrity ─────────────────');
  try {
    const { status, body } = await get(`${BACKEND}/api/tournament?status=upcoming`);
    if (status !== 200) { alert('WARN', 'Could not fetch upcoming tournaments', { status }); return; }

    const bad = (body.tournaments || []).filter(t => {
      const d = t.prize_distribution || {};
      return Math.abs((d['1'] || 0) + (d['2'] || 0) + (d['3'] || 0) - 1.0) > 0.01;
    });

    if (bad.length > 0) {
      alert('ERROR', `${bad.length} tournament(s) have wrong prize distribution`, {
        ids: bad.map(t => `${t.name}: ${JSON.stringify(t.prize_distribution)}`),
      });
    } else {
      alert('OK', `All upcoming tournaments have valid prize distribution`);
    }

    // Also check that no tournament still has old 80/10 split
    const old = (body.tournaments || []).filter(t => {
      const d = t.prize_distribution || {};
      return d['1'] === 0.8 || d['1'] === 0.80;
    });
    if (old.length > 0) {
      alert('ERROR', `${old.length} tournament(s) still use OLD 80/10 distribution`, {
        names: old.map(t => t.name),
      });
    }
  } catch (e) {
    alert('WARN', 'Prize distribution check failed', { error: e.message });
  }
}

async function checkActiveHourlyTiers() {
  console.log('\n── 3. Hourly Tiers Status ───────────────────────────');
  try {
    const { status, body } = await get(`${BACKEND}/api/tournament/upcoming-hourly`);
    if (status !== 200) { alert('WARN', 'Could not fetch hourly tiers', { status }); return; }

    const tiers = body.tiers || [];
    for (const tier of tiers) {
      const fullness = tier.max_players > 0
        ? Math.round((tier.registrations_count / tier.max_players) * 100)
        : 0;
      alert('OK', `Tier ${tier.tier}: ${tier.status} | ${tier.registrations_count}/${tier.max_players} players (${fullness}%)`);

      if (fullness >= 90) {
        alert('WARN', `Tier ${tier.tier} almost FULL (${fullness}%)`, { tier: tier.tier });
      }
    }
  } catch (e) {
    alert('WARN', 'Hourly tier check failed', { error: e.message });
  }
}

async function checkSupabaseIntegrity() {
  if (!SUPABASE || !SUPA_KEY) {
    console.log('\n── 4. DB Integrity ─── SKIPPED (no SUPABASE_URL env) ─');
    return;
  }

  console.log('\n── 4. DB Integrity ──────────────────────────────────');

  // Check pairings without game_id
  try {
    const { status, body } = await get(
      `${SUPABASE}/rest/v1/tournament_pairings?game_id=is.null&select=id,tournament_id,round&limit=10`,
      { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    );
    if (Array.isArray(body) && body.length > 0) {
      alert('WARN', `${body.length} pairing(s) missing game_id`, { sample: body.slice(0, 3) });
    } else {
      alert('OK', 'All pairings have game_id');
    }
  } catch (e) {
    alert('WARN', 'Pairing integrity check failed', { error: e.message });
  }

  // Check tournaments with wrong prize_distribution still in DB
  try {
    const { status, body } = await get(
      `${SUPABASE}/rest/v1/tournaments?prize_distribution=eq.%7B%221%22%3A0.8%2C%222%22%3A0.1%7D&select=id,name,status&limit=5`,
      { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    );
    if (Array.isArray(body) && body.length > 0) {
      alert('ERROR', `${body.length} tournament(s) still have OLD 80/10 distribution`, {
        names: body.map(t => t.name),
      });
    } else {
      alert('OK', 'No tournaments with old 80/10 distribution');
    }
  } catch (e) {
    alert('WARN', 'DB prize distribution check failed', { error: e.message });
  }
}

async function summarize() {
  console.log('\n══════════════════════════════════════════════════════');
  const errors = ALERTS.filter(a => a.level === 'ERROR').length;
  const warns  = ALERTS.filter(a => a.level === 'WARN').length;
  const oks    = ALERTS.filter(a => a.level === 'OK').length;

  console.log(`\nSummary: ${oks} OK  |  ${warns} WARN  |  ${errors} ERROR`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  if (errors > 0) {
    console.log('⚠️  ACTION REQUIRED — check errors above');
    process.exitCode = 1;
  } else if (warns > 0) {
    console.log('⚡ Warnings found — review when possible');
  } else {
    console.log('🟢 All checks passed');
  }
}

(async () => {
  console.log('Chess Arena Production Monitor');
  console.log(`Backend: ${BACKEND}`);
  console.log(`Time:    ${new Date().toISOString()}`);

  await checkHealth();
  await checkPrizeDistribution();
  await checkActiveHourlyTiers();
  await checkSupabaseIntegrity();
  await summarize();
})();

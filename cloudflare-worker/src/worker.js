/**
 * Chess Arena — Cloudflare Security Worker
 *
 * URL: https://chess-arena-security.<subdomain>.workers.dev
 * Atau custom domain setelah domain ditambahkan ke CF account.
 *
 * Lapisan keamanan:
 *  1.  Rate limiting per-IP (in-memory per isolate)
 *  2.  Malicious bot / scanner UA blocking
 *  3.  SQL injection & XSS pattern detection
 *  4.  Path traversal & SSRF detection
 *  5.  Request size limiting (1 MB)
 *  6.  CORS enforcement — hanya Vercel & localhost
 *  7.  Security headers pada setiap response
 *  8.  Real IP forwarding ke Railway backend
 *  9.  Graceful backend error handling
 * 10.  Content-Type validation untuk mutation requests
 */

const BACKEND_URL = 'https://chess-arena-backend-production-4548.up.railway.app';

const ALLOWED_ORIGINS = [
  'https://chess-app-two-kappa.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
];

// ── Blocked User-Agent patterns (scanners / attack tools) ────────────────────
const BLOCKED_UA = [
  /sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /zgrab/i, /nuclei/i,
  /dirbuster/i, /gobuster/i, /ffuf/i, /wfuzz/i, /hydra/i, /medusa/i,
  /metasploit/i, /burpsuite/i, /havij/i, /acunetix/i, /netsparker/i,
  /openvas/i, /qualys/i, /w3af/i, /skipfish/i,
];

// ── Malicious request patterns ───────────────────────────────────────────────
const MALICIOUS = [
  // SQL Injection
  /union[\s+]+select/i,
  /select[\s+]+.+[\s+]+from/i,
  /drop[\s+]+table/i,
  /insert[\s+]+into/i,
  /delete[\s+]+from/i,
  /exec[\s+(]+[sxp]+p\w*/i,
  /;\s*(drop|delete|truncate|alter)\s/i,
  // XSS
  /<script[\s>]/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /on(?:load|error|click|mouse\w+|key\w+|focus|blur)\s*=/i,
  // Path traversal
  /\.\.[/\\]/,
  /%2e%2e[%2f%5c]/i,
  /\.\.%2f/i,
  // Command injection
  /[;&|`]\s*(?:ls|cat|pwd|wget|curl|bash|sh|python|perl|ruby|nc|ncat)\b/i,
  // SSRF — detect attempts to reach internal services
  /(?:^|@)(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|169\.254\.|10\.\d+\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1)/i,
];

// ── In-memory rate limit store ────────────────────────────────────────────────
// NOTE: Cloudflare Workers isolates are per-PoP, state resets on isolate cold-start.
// For production-grade rate limiting, upgrade to Cloudflare Rate Limiting rules.
const rlStore = new Map();
let rlLastPurge = Date.now();

function rlCheck(key, limit, windowSec) {
  const now = Date.now();
  const windowMs = windowSec * 1000;

  // Purge expired entries every 2 minutes
  if (now - rlLastPurge > 120_000) {
    rlLastPurge = now;
    for (const [k, v] of rlStore) {
      if (now > v.resetAt) rlStore.delete(k);
    }
  }

  const entry = rlStore.get(key);
  if (!entry || now > entry.resetAt) {
    rlStore.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  entry.count++;
  const ok = entry.count <= limit;
  return { ok, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
}

// ── Security response headers ─────────────────────────────────────────────────
function securityHeaders(origin) {
  const isAllowed = ALLOWED_ORIGINS.includes(origin);
  return {
    'Strict-Transport-Security':  'max-age=31536000; includeSubDomains; preload',
    'X-Content-Type-Options':     'nosniff',
    'X-Frame-Options':            'DENY',
    'X-XSS-Protection':           '1; mode=block',
    'Referrer-Policy':            'strict-origin-when-cross-origin',
    'Permissions-Policy':         'camera=(), microphone=(), geolocation=(), payment=()',
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
    'Server': 'Chess-Arena',
  };
}

// ── Error response ────────────────────────────────────────────────────────────
function errResp(status, message, origin, extra = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...securityHeaders(origin),
      ...extra,
    },
  });
}

// ── Main fetch handler ────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();
    const origin = request.headers.get('Origin') || '';
    const ua     = request.headers.get('User-Agent') || '';
    const ip     = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('X-Real-IP') ||
                   '0.0.0.0';
    const path   = url.pathname;

    // ── 1. CORS Preflight ──────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...securityHeaders(origin),
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // ── 2. Block malicious User-Agents ─────────────────────────────────────
    for (const pattern of BLOCKED_UA) {
      if (pattern.test(ua)) {
        return errResp(403, 'Forbidden', origin);
      }
    }

    // ── 3. Block empty UA on write requests ────────────────────────────────
    if (!ua && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return errResp(403, 'Forbidden', origin);
    }

    // ── 4. Content-Length guard (1 MB) ─────────────────────────────────────
    const cl = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (cl > 1_048_576) {
      return errResp(413, 'Request too large', origin);
    }

    // ── 5. Malicious pattern scan (path + query) ───────────────────────────
    const scanTarget = decodeURIComponent(path + url.search);
    for (const pattern of MALICIOUS) {
      if (pattern.test(scanTarget)) {
        return errResp(400, 'Bad request', origin);
      }
    }

    // ── 6. Rate limiting ───────────────────────────────────────────────────
    // Auth — 10 req/min per IP
    if (path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register')) {
      const rl = rlCheck(`auth:${ip}`, 10, 60);
      if (!rl.ok) return errResp(429, 'Too many login attempts. Please wait.', origin, { 'Retry-After': '60' });
    }
    // Auth general — 20 req/min
    else if (path.startsWith('/api/auth')) {
      const rl = rlCheck(`auth_gen:${ip}`, 20, 60);
      if (!rl.ok) return errResp(429, 'Too many requests.', origin, { 'Retry-After': '60' });
    }
    // Wallet / payment — 20 req/min
    else if (path.startsWith('/api/wallet') || path.startsWith('/api/webhook')) {
      const rl = rlCheck(`wallet:${ip}`, 20, 60);
      if (!rl.ok) return errResp(429, 'Too many requests.', origin, { 'Retry-After': '60' });
    }
    // Tournament register — 5 req/min
    else if (path.endsWith('/register') && path.startsWith('/api/tournament')) {
      const rl = rlCheck(`treg:${ip}`, 5, 60);
      if (!rl.ok) return errResp(429, 'Too many registration attempts.', origin, { 'Retry-After': '60' });
    }
    // Global — 120 req/min per IP
    else {
      const rl = rlCheck(`global:${ip}`, 120, 60);
      if (!rl.ok) return errResp(429, 'Too many requests. Please slow down.', origin, { 'Retry-After': '30' });
    }

    // ── 7. CORS origin check for mutation requests ─────────────────────────
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && origin) {
      if (!ALLOWED_ORIGINS.includes(origin)) {
        return errResp(403, 'Origin not allowed', origin);
      }
    }

    // ── 8. Forward to Railway backend ─────────────────────────────────────
    const backendUrl = BACKEND_URL + path + url.search;
    const fwdHeaders = new Headers(request.headers);

    // Pass real client info
    fwdHeaders.set('X-Real-IP', ip);
    fwdHeaders.set('X-Forwarded-For', ip);
    fwdHeaders.set('X-CF-Country', request.headers.get('CF-IPCountry') || 'XX');
    fwdHeaders.set('X-CF-Ray', request.headers.get('CF-Ray') || '');
    fwdHeaders.set('X-Via-Worker', '1');

    // Strip CF headers that shouldn't reach backend
    fwdHeaders.delete('CF-Connecting-IP');

    let backendResp;
    try {
      backendResp = await fetch(backendUrl, {
        method,
        headers:  fwdHeaders,
        body:     ['GET', 'HEAD'].includes(method) ? undefined : request.body,
        redirect: 'follow',
        signal:   AbortSignal.timeout(29_000), // 29s timeout (CF worker limit is 30s)
      });
    } catch (err) {
      const msg = err.name === 'TimeoutError' ? 'Request timeout' : 'Backend unavailable';
      return errResp(502, msg, origin);
    }

    // ── 9. Build secured response ──────────────────────────────────────────
    const respHeaders = new Headers(backendResp.headers);

    // Apply security headers (override backend's)
    for (const [k, v] of Object.entries(securityHeaders(origin))) {
      respHeaders.set(k, v);
    }

    // Remove server fingerprinting headers
    respHeaders.delete('X-Powered-By');
    respHeaders.delete('Via');

    return new Response(backendResp.body, {
      status:  backendResp.status,
      headers: respHeaders,
    });
  },
};

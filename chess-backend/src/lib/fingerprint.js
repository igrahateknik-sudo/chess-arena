/**
 * IP / Device Fingerprinting — Multi-Account Detection
 *
 * Tujuan:
 *  - Catat IP + User-Agent setiap kali user join game
 *  - Deteksi multi-account: fingerprint yang sama → userId berbeda
 *  - Tidak menyimpan raw IP: di-hash SHA-256 untuk privacy
 *
 * Tabel: device_fingerprints
 *   id, user_id, fingerprint_hash, ip_hash, ua_hash, seen_at, game_id
 *
 * Tabel: multi_account_flags
 *   id, user_id_a, user_id_b, fingerprint_hash, detected_at, reviewed
 */

const crypto = require('crypto');
const { supabase } = require('./db');

// ── Helpers ────────────────────────────────────────────────────────────────

function sha256(str) {
  return crypto.createHash('sha256').update(str || '').digest('hex');
}

/**
 * Ekstrak IP nyata dari socket — prioritaskan X-Forwarded-For (Railway/proxy)
 */
function extractIp(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    // X-Forwarded-For bisa berisi daftar: "client, proxy1, proxy2"
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address || 'unknown';
}

/**
 * Buat fingerprint hash dari IP + User-Agent.
 * Privacy-safe: raw IP tidak pernah disimpan ke DB.
 */
function buildFingerprintHash(ip, ua) {
  // Kombinasikan IP + UA sebagai fingerprint device
  return sha256(`${ip}|${ua}`);
}

// ── Core: Record & Detect ──────────────────────────────────────────────────

/**
 * Catat fingerprint saat user join game.
 * Returns { isMultiAccount: bool, suspectedUserIds: string[] }
 */
async function recordAndDetect(socket, userId, gameId) {
  const ip = extractIp(socket);
  const ua = socket.handshake.headers['user-agent'] || 'unknown';

  const fingerprintHash = buildFingerprintHash(ip, ua);
  const ipHash = sha256(ip);
  const uaHash = sha256(ua);

  // Simpan record fingerprint (non-blocking, fire-and-forget untuk DB)
  const insertPromise = supabase
    .from('device_fingerprints')
    .upsert({
      user_id:          userId,
      fingerprint_hash: fingerprintHash,
      ip_hash:          ipHash,
      ua_hash:          uaHash,
      game_id:          gameId,
      seen_at:          new Date(),
    }, {
      onConflict:       'user_id,fingerprint_hash',
      ignoreDuplicates: false,
    })
    .then(() => {})
    .catch(e => console.error('[Fingerprint] DB insert failed:', e.message));

  // Cek apakah fingerprint ini sudah diasosiasikan dengan userId lain
  let isMultiAccount = false;
  let suspectedUserIds = [];

  try {
    const { data: matches } = await supabase
      .from('device_fingerprints')
      .select('user_id')
      .eq('fingerprint_hash', fingerprintHash)
      .neq('user_id', userId)
      .limit(10);

    if (matches && matches.length > 0) {
      isMultiAccount = true;
      suspectedUserIds = [...new Set(matches.map(m => m.user_id))];

      console.warn('[FINGERPRINT] Multi-account detected:', {
        userId,
        sharedFingerprintWith: suspectedUserIds,
        fingerprintHash: fingerprintHash.slice(0, 12) + '…', // redacted
        gameId,
      });

      // Catat ke multi_account_flags untuk setiap pasangan
      for (const otherUserId of suspectedUserIds) {
        supabase
          .from('multi_account_flags')
          .upsert({
            user_id_a:        userId < otherUserId ? userId : otherUserId,
            user_id_b:        userId < otherUserId ? otherUserId : userId,
            fingerprint_hash: fingerprintHash,
            detected_at:      new Date(),
            reviewed:         false,
          }, {
            onConflict:       'user_id_a,user_id_b,fingerprint_hash',
            ignoreDuplicates: true,
          })
          .then(() => {})
          .catch(e => console.error('[Fingerprint] multi_account_flags insert failed:', e.message));
      }
    }
  } catch (e) {
    console.error('[Fingerprint] Detection query failed:', e.message);
  }

  await insertPromise;

  return { isMultiAccount, suspectedUserIds, fingerprintHash };
}

/**
 * Hitung suspicion score dari fingerprint detection.
 * Dipanggil oleh enforceAnticheat jika multi-account terdeteksi.
 */
function scoreFingerprintResult({ isMultiAccount, suspectedUserIds }) {
  if (!isMultiAccount) return { flags: [], score: 0 };

  const count = suspectedUserIds.length;
  const score = count >= 3 ? 50 : count >= 2 ? 35 : 25;
  const flags = [`MULTI_ACCOUNT_IP:${count}shared`];

  return { flags, score };
}

module.exports = { recordAndDetect, scoreFingerprintResult, extractIp, buildFingerprintHash };

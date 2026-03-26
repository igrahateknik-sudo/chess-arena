/**
 * Engine Detection via Stockfish + Blunder-Rate Fallback
 *
 * Layer 1 (always active): Simplified accuracy analysis menggunakan chess.js
 *   - Blunder rate (move yang menjatuhkan material tanpa kompensasi)
 *   - Non-blunder rate (kalau terlalu sering tidak blunder = suspicious)
 *   - Capture optimization rate
 *
 * Layer 2 (jika stockfish binary tersedia): Stockfish comparison via spawn
 *   - Binary dicari di PATH atau path umum (Alpine apk, macOS Homebrew)
 *   - Komunikasi via UCI protocol (stdin/stdout) — tidak butuh WASM/fetch
 *   - Bandingkan setiap move dengan top-3 rekomendasi engine
 *   - Exact match rate (>75% = sangat suspicious)
 *   - Top-3 match rate (>90% = engine-level accuracy)
 *
 * Design decision: Layer 1 selalu jalan. Layer 2 hanya jika binary terinstall
 * dan sudah ada flag timing suspicious (hemat compute).
 */

const { Chess }    = require('chess.js');
const { spawn, spawnSync } = require('child_process');

// ── Piece values (centipawn) ───────────────────────────────────────────────
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function countMaterial(chess) {
  const board  = chess.board();
  const scores = { w: 0, b: 0 };
  for (const row of board) {
    for (const sq of row) {
      if (sq) scores[sq.color] += PIECE_VALUES[sq.type] || 0;
    }
  }
  return scores;
}

// ── Stockfish binary finder ────────────────────────────────────────────────
// Cari binary stockfish di lokasi umum. Dicoba sekali, hasilnya di-cache.
let _stockfishStatus = 'unknown'; // 'available' | 'unavailable'
let _stockfishBinary = null;      // path ke binary yang berhasil dideteksi

const STOCKFISH_CANDIDATES = [
  'stockfish',                      // dalam PATH (Railway, Docker)
  '/usr/bin/stockfish',             // Alpine Linux (apk add stockfish)
  '/usr/games/stockfish',           // Debian/Ubuntu
  '/usr/local/bin/stockfish',       // macOS Homebrew (Intel)
  '/opt/homebrew/bin/stockfish',    // macOS Homebrew (Apple Silicon)
  '/usr/local/games/stockfish',
];

function tryLoadStockfish() {
  if (_stockfishStatus !== 'unknown') return _stockfishStatus === 'available';

  for (const candidate of STOCKFISH_CANDIDATES) {
    try {
      // spawnSync dengan 'quit' — cepat, tidak blocking lama
      const result = spawnSync(candidate, [], {
        input:   'quit\n',
        timeout: 3000,
        stdio:   ['pipe', 'pipe', 'pipe'],
      });
      // Exit code 0 atau ada stdout = binary bisa dijalankan
      if (result.status === 0 || (result.stdout && result.stdout.length > 0)) {
        _stockfishBinary = candidate;
        _stockfishStatus = 'available';
        console.log(`[Stockfish] ✅ Binary ditemukan: ${candidate}`);
        return true;
      }
    } catch {
      // kandidat ini gagal, coba berikutnya
    }
  }

  _stockfishStatus = 'unavailable';
  console.warn('[Stockfish] ⚠️  Binary tidak ditemukan. Gunakan Layer 1 (chess.js) saja.');
  console.warn('[Stockfish]    Untuk aktivasi: apt-get install stockfish  atau  apk add stockfish');
  return false;
}

// ── Layer 1: Blunder-rate analysis (chess.js based, always works) ──────────

/**
 * Analisis akurasi berdasarkan blunder rate dan material tracking.
 * Tidak butuh Stockfish — hanya chess.js.
 *
 * Threshold:
 *  - blunderRate < 0.01 dengan avgMoveTime < 5s → HIGH_ACCURACY (engine-like)
 *  - captureOptimality > 0.95 → engine always captures optimally
 *  - materialWinRate > 0.90 → never leaves pieces hanging
 */
function analyzeAccuracy(moveHistory) {
  if (!moveHistory || moveHistory.length < 10) {
    return { white: null, black: null };
  }

  const stats = {
    white: { blunders: 0, total: 0, captures: 0, optimalCaptures: 0 },
    black: { blunders: 0, total: 0, captures: 0, optimalCaptures: 0 },
  };

  const chess = new Chess();

  for (let i = 0; i < moveHistory.length; i++) {
    const m         = moveHistory[i];
    const color     = i % 2 === 0 ? 'white' : 'black';
    const colorChar = i % 2 === 0 ? 'w'     : 'b';

    const matBefore = countMaterial(chess);

    let result;
    try {
      result = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch {
      break;
    }
    if (!result) break;

    const matAfter = countMaterial(chess);
    stats[color].total++;

    // Blunder: player drops >150cp (1.5 pawns) of their own material
    const playerDelta = matAfter[colorChar] - matBefore[colorChar];
    const isBlunder   = playerDelta < -150;
    if (isBlunder) stats[color].blunders++;

    // Capture analysis: did player take the highest-value piece available?
    if (result.captured) {
      stats[color].captures++;
      const possibleCaptures = chess
        .history({ verbose: true })
        .filter(h => h.captured)
        .sort((a, b) => (PIECE_VALUES[b.captured] || 0) - (PIECE_VALUES[a.captured] || 0));

      const capturedValue    = PIECE_VALUES[result.captured] || 0;
      const bestCaptureValue = possibleCaptures[0]
        ? PIECE_VALUES[possibleCaptures[0].captured] || 0
        : capturedValue;

      if (capturedValue >= bestCaptureValue) {
        stats[color].optimalCaptures++;
      }
    }
  }

  const results = {};
  for (const color of ['white', 'black']) {
    const s = stats[color];
    if (s.total < 5) { results[color] = null; continue; }

    const blunderRate = s.blunders / s.total;
    const captureOpt  = s.captures > 0 ? s.optimalCaptures / s.captures : 1;

    results[color] = {
      blunderRate:    +blunderRate.toFixed(3),
      blunders:       s.blunders,
      total:          s.total,
      captureOptRate: +captureOpt.toFixed(3),
      // Accuracy score 0-100 (higher = more accurate = more suspicious if also fast)
      accuracyScore:  Math.round((1 - blunderRate) * 100),
    };
  }

  return results;
}

// ── Layer 2: Stockfish comparison (spawn-based, butuh binary) ─────────────

/**
 * Get Stockfish top-N moves untuk FEN tertentu via UCI spawn.
 * Returns { bestMove, topMoves: string[], timedOut?, unavailable?, error? }
 */
function getTopMovesFromStockfish(fen, depth = 12, multiPV = 3, timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!tryLoadStockfish()) {
      return resolve({ bestMove: null, topMoves: [], unavailable: true });
    }

    let proc;
    try {
      proc = spawn(_stockfishBinary, [], {
        stdio: ['pipe', 'pipe', 'ignore'], // stdin, stdout, stderr
      });
    } catch (e) {
      _stockfishStatus = 'unavailable'; // binary broken
      return resolve({ bestMove: null, topMoves: [], unavailable: true, error: e.message });
    }

    const pvMoves    = new Map(); // multipv index (1,2,3) → UCI move string
    let maxDepthSeen = 0;
    let resolved     = false;
    let buffer       = '';

    const done = (extra = {}) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { proc.kill('SIGTERM'); } catch {}
      const topMoves = [1, 2, 3].map(i => pvMoves.get(i)).filter(Boolean);
      resolve({ bestMove: topMoves[0] || null, topMoves, ...extra });
    };

    const timer = setTimeout(() => done({ timedOut: true }), timeoutMs);

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // simpan baris belum lengkap

      for (const line of lines) {
        const trimmed = line.trim();

        // Parse: info depth D [multipv M] pv MOVE ...
        if (trimmed.startsWith('info') && trimmed.includes(' pv ')) {
          const depthM = trimmed.match(/\bdepth (\d+)/);
          const mpvM   = trimmed.match(/\bmultipv (\d+)/);
          const pvM    = trimmed.match(/\bpv (\S+)/);
          if (depthM && pvM) {
            const d   = parseInt(depthM[1]);
            const mpv = mpvM ? parseInt(mpvM[1]) : 1;
            if (d >= maxDepthSeen) {
              maxDepthSeen = d;
              pvMoves.set(mpv, pvM[1]);
            }
          }
        }

        if (trimmed.startsWith('bestmove')) {
          const bmM = trimmed.match(/bestmove (\S+)/);
          if (bmM?.[1] && !pvMoves.get(1)) pvMoves.set(1, bmM[1]);
          done();
        }
      }
    });

    proc.on('error', (e) => {
      console.error('[Stockfish] Spawn error:', e.message);
      _stockfishStatus = 'unavailable';
      done({ unavailable: true, error: e.message });
    });

    proc.on('exit', (code) => {
      if (!resolved) done({ error: `Engine exited with code ${code}` });
    });

    // Kirim perintah UCI
    proc.stdin.write('uci\n');
    proc.stdin.write(`setoption name MultiPV value ${multiPV}\n`);
    proc.stdin.write('isready\n');
    proc.stdin.write(`position fen ${fen}\n`);
    proc.stdin.write(`go depth ${depth}\n`);
  });
}

/**
 * Full Stockfish comparison across sampled positions.
 * Mengembalikan engine match stats per warna + flags + suspicionScore.
 */
async function runStockfishComparison(moveHistory, options = {}) {
  const {
    maxSamples = 15,  // Max posisi yang dianalisis per warna
    depth      = 12,  // Kedalaman Stockfish
    minMoves   = 10,  // Minimum move untuk analisis
  } = options;

  if (!tryLoadStockfish()) return null; // binary tidak tersedia
  if (!moveHistory || moveHistory.length < minMoves) return null;

  // Rekonstruksi FEN sebelum setiap move
  const chess        = new Chess();
  const allPositions = [];

  for (let i = 0; i < moveHistory.length; i++) {
    const fenBefore = chess.fen();
    const m         = moveHistory[i];
    const color     = i % 2 === 0 ? 'white' : 'black';
    try {
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      allPositions.push({ fenBefore, move: m, color });
    } catch { break; }
  }

  // Sample secara merata agar tidak overload
  function sampleEvenly(arr, max) {
    if (arr.length <= max) return arr;
    const step = arr.length / max;
    return Array.from({ length: max }, (_, i) => arr[Math.floor(i * step)]);
  }

  const toAnalyze = [
    ...sampleEvenly(allPositions.filter(p => p.color === 'white'), maxSamples),
    ...sampleEvenly(allPositions.filter(p => p.color === 'black'), maxSamples),
  ];

  const results = {
    white: { exactMatch: 0, top3Match: 0, analyzed: 0 },
    black: { exactMatch: 0, top3Match: 0, analyzed: 0 },
  };

  console.log(`[Stockfish] Analyzing ${toAnalyze.length} positions at depth ${depth}...`);
  const t0 = Date.now();

  for (const { fenBefore, move, color } of toAnalyze) {
    try {
      const { topMoves, unavailable } = await getTopMovesFromStockfish(fenBefore, depth, 3);
      if (unavailable || !topMoves.length) break; // Stockfish not working, abort

      const playerUCI = `${move.from}${move.to}${move.promotion || ''}`;
      const isExact   = topMoves[0] === playerUCI;
      const isTop3    = topMoves.includes(playerUCI);

      results[color].analyzed++;
      if (isExact) results[color].exactMatch++;
      if (isTop3)  results[color].top3Match++;
    } catch (e) {
      console.error('[Stockfish] Position error:', e.message);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[Stockfish] Done in ${elapsed}s — white: ${results.white.analyzed}, black: ${results.black.analyzed} analyzed`);

  // Hitung rates
  for (const color of ['white', 'black']) {
    const r       = results[color];
    r.exactMatchRate = r.analyzed > 0 ? r.exactMatch / r.analyzed : 0;
    r.top3MatchRate  = r.analyzed > 0 ? r.top3Match  / r.analyzed : 0;
  }

  // Flags dan score
  const flags = [];
  let suspicionScore = 0;

  for (const color of ['white', 'black']) {
    const r      = results[color];
    const prefix = color.toUpperCase();
    if (r.analyzed < 5) continue;

    const exactPct = (r.exactMatchRate * 100).toFixed(0);
    const top3Pct  = (r.top3MatchRate  * 100).toFixed(0);

    if (r.exactMatchRate >= 0.75) {
      flags.push(`${prefix}_VERY_HIGH_ENGINE_MATCH:${exactPct}%`);
      suspicionScore += 55;
    } else if (r.exactMatchRate >= 0.60) {
      flags.push(`${prefix}_HIGH_ENGINE_MATCH:${exactPct}%`);
      suspicionScore += 35;
    }

    if (r.top3MatchRate >= 0.90) {
      flags.push(`${prefix}_PERFECT_ENGINE_ACCURACY:${top3Pct}%`);
      suspicionScore += 25;
    } else if (r.top3MatchRate >= 0.80) {
      flags.push(`${prefix}_HIGH_ENGINE_ACCURACY:${top3Pct}%`);
      suspicionScore += 15;
    }
  }

  return { white: results.white, black: results.black, flags, suspicionScore };
}

module.exports = {
  analyzeAccuracy,
  runStockfishComparison,
  getTopMovesFromStockfish,
};

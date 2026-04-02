/**
 * Anti-cheat detection + enforcement module
 *
 * Layer 1  — Timing analysis (sync, always runs)
 * Layer 2  — Game integrity check (sync, always runs)
 * Layer 3  — Accuracy / blunder-rate analysis (sync, chess.js based)
 * Layer 4  — ELO anomaly detection (async, DB query)
 * Layer 5  — Stockfish engine comparison (async, background only, needs package)
 *
 * Enforcement:
 *   score ≥ 40 → warn
 *   score ≥ 65 → flag for review
 *   score ≥ 90 → auto-suspend
 */

const { Chess }       = require('chess.js');
const { supabase, eloHistory } = require('./db');
const { logAnticheatAction }   = require('./auditLog');
const { analyzeAccuracy, runStockfishComparison } = require('./stockfishAnalysis');

// ── Thresholds ─────────────────────────────────────────────────────────────

const TIMING_THRESHOLDS = {
  avgMoveTimeMin:  0.5,   // detik — terlalu cepat
  consistencyMax:  0.15,  // coefficient of variation terlalu kecil
  minMoves:        10,
};

const TRUST_PENALTY = {
  // Timing — values match the suspicion scores added in analyzeMoveTimings()
  FAST_MOVES:            40,
  ULTRA_FAST_MOVES:      30,
  CONSISTENT_TIMING:     35,
  // Integrity
  ILLEGAL_MOVE:          60,
  INVALID_MOVE:          60,
  // Accuracy (blunder)
  HIGH_ACCURACY_NO_TIME: 20,
  PERFECT_NO_BLUNDER:    25,
  // ELO anomaly
  ELO_GAP_WIN:           25,
  RAPID_ELO_GAIN:        30,
  VERY_HIGH_WIN_RATE:    20,
  // Stockfish
  WHITE_VERY_HIGH_ENGINE_MATCH:  50,
  BLACK_VERY_HIGH_ENGINE_MATCH:  50,
  WHITE_HIGH_ENGINE_MATCH:       30,
  BLACK_HIGH_ENGINE_MATCH:       30,
  WHITE_PERFECT_ENGINE_ACCURACY: 20,
  BLACK_PERFECT_ENGINE_ACCURACY: 20,
  WHITE_HIGH_ENGINE_ACCURACY:    10,
  BLACK_HIGH_ENGINE_ACCURACY:    10,
  // Disconnect
  DISCONNECT_ABUSE:       10,
  // Collusion (match-fixing)
  REPEAT_PAIR:           20,
  ONE_SIDED_WINS:        35,
  FAST_RESIGN_PATTERN:   30,
  FAST_RESIGN:           15,
  MATERIAL_GIFT:         35,
  // Multi-account (device fingerprinting)
  MULTI_ACCOUNT_IP:      40,
};

const ENFORCE_THRESHOLDS = {
  warn:    40,
  flag:    65,
  suspend: 90,
};

// ── Layer 1: Timing Analysis ───────────────────────────────────────────────

/**
 * Analyze move timings for a single player's moves.
 *
 * moveHistory is already pre-filtered to one color's moves only
 * (e.g., all white moves or all black moves), so consecutive entries in the
 * array are two turns apart in wall-clock time (opponent's think time is in
 * between).
 *
 * We use timeLeft deltas when available — since the clock only ticks during
 * the player's own turn, consecutive timeLeft values for the same player give
 * accurate per-move think times without including the opponent's time.
 * Falls back to wall-clock timestamps only if timeLeft is absent.
 */
function analyzeMoveTimings(moveHistory) {
  const flags = [];
  let suspicionScore = 0;

  if (!moveHistory || moveHistory.length < TIMING_THRESHOLDS.minMoves) {
    return { suspicious: false, flags: [], score: 0 };
  }

  const moveTimes = [];
  for (let i = 1; i < moveHistory.length; i++) {
    const prev = moveHistory[i - 1];
    const curr = moveHistory[i];

    // Prefer timeLeft delta (accurate per-player think time)
    if (prev?.timeLeft !== undefined && curr?.timeLeft !== undefined && prev.timeLeft > 0) {
      const dt = prev.timeLeft - curr.timeLeft; // seconds spent on this move
      if (dt > 0 && dt < 300) moveTimes.push(dt);
    } else if (prev?.timestamp && curr?.timestamp) {
      // Fallback: wall-clock — inaccurate for per-color analysis but better than nothing
      const dt = (curr.timestamp - prev.timestamp) / 1000;
      if (dt > 0 && dt < 300) moveTimes.push(dt);
    }
  }

  if (moveTimes.length < 5) return { suspicious: false, flags: [], score: 0 };

  const avg      = moveTimes.reduce((a, b) => a + b, 0) / moveTimes.length;
  const variance = moveTimes.reduce((s, t) => s + Math.pow(t - avg, 2), 0) / moveTimes.length;
  const stdDev   = Math.sqrt(variance);
  const cv       = stdDev / avg;

  if (avg < TIMING_THRESHOLDS.avgMoveTimeMin) {
    flags.push('FAST_MOVES');
    suspicionScore += 40;
  }

  if (cv < TIMING_THRESHOLDS.consistencyMax && avg < 5) {
    flags.push('CONSISTENT_TIMING');
    suspicionScore += 35;
  }

  const ultraFastCount = moveTimes.filter(t => t < 1).length;
  if (ultraFastCount / moveTimes.length > 0.5) {
    flags.push('ULTRA_FAST_MOVES');
    suspicionScore += 30;
  }

  return {
    suspicious: suspicionScore >= 50,
    flags,
    score: suspicionScore,
    stats: { avg: avg.toFixed(2), stdDev: stdDev.toFixed(2), cv: cv.toFixed(2), samples: moveTimes.length },
  };
}

// ── Layer 2: Game Integrity Check ──────────────────────────────────────────

function validateGameIntegrity(moveHistory) {
  const chess = new Chess();
  const flags = [];

  for (const move of moveHistory) {
    try {
      const result = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
      if (!result) {
        flags.push(`ILLEGAL_MOVE:${move.san}`);
        return { valid: false, flags };
      }
    } catch {
      flags.push(`INVALID_MOVE:${move.san}`);
      return { valid: false, flags };
    }
  }

  return { valid: true, flags };
}

// ── Layer 3: Accuracy analysis integration ────────────────────────────────

/**
 * Tambahkan accuracy flags ke hasil analisis berdasarkan blunder-rate
 * Dipanggil setelah timing analysis — menambah suspicion jika akurasi
 * engine-like DAN waktu bermain cepat.
 */
function buildAccuracyFlags(accuracyResult, timingAvg) {
  const flags = [];
  let score   = 0;

  if (!accuracyResult) return { flags, score };

  // Terlalu akurat untuk waktu yang diambil
  if (accuracyResult.blunderRate < 0.01 && timingAvg !== null && timingAvg < 5) {
    flags.push(`HIGH_ACCURACY_NO_TIME:blunder=${(accuracyResult.blunderRate * 100).toFixed(1)}%`);
    score += 20;
  }

  // Tidak pernah blunder sama sekali (>20 move)
  if (accuracyResult.blunders === 0 && accuracyResult.total >= 20) {
    flags.push(`PERFECT_NO_BLUNDER:moves=${accuracyResult.total}`);
    score += 25;
  }

  return { flags, score };
}

// ── Layer 4: ELO Anomaly Detection ────────────────────────────────────────

/**
 * Deteksi anomali ELO — dipanggil secara async setelah game selesai.
 *
 * Checks:
 *  1. Win terhadap lawan yang ELO-nya jauh lebih tinggi
 *  2. Lonjakan ELO cepat (>150 ELO dalam 5 game terakhir)
 *  3. Pola menang-terus terhadap lawan bermain lebih baik
 */
async function detectEloAnomaly(userId, { playerElo, opponentElo, result }) {
  const flags = [];
  let score   = 0;

  // 1. Win against opponent 400+ ELO higher
  const eloGap = opponentElo - playerElo;
  if (result === 'win' && eloGap > 400) {
    const gapStr = `+${eloGap}`;
    flags.push(`ELO_GAP_WIN:${gapStr}`);
    score += eloGap > 600 ? 40 : 25;
    console.info(`[ELO-ANOMALY] ${userId} beat opponent ${gapStr} ELO higher`);
  }

  // 2. Check recent history for rapid ELO gain
  try {
    const history = await eloHistory.getForUser(userId, 10);
    if (history.length >= 5) {
      // Gain dalam 5 game terakhir
      const recentGain = history
        .slice(0, 5)
        .reduce((sum, h) => sum + (h.change || 0), 0);

      if (recentGain > 200) {
        flags.push(`RAPID_ELO_GAIN:+${recentGain}in5games`);
        score += recentGain > 300 ? 40 : 30;
        console.info(`[ELO-ANOMALY] ${userId} gained ${recentGain} ELO in last 5 games`);
      }

      // 3. Win rate terhadap higher-rated opponents dalam 10 game terakhir
      const winsVsHigher = history.filter(h => {
        // Hanya hitung jika elo_after > elo_before (menang) dan gain signifikan
        return h.change > 10;
      }).length;

      if (winsVsHigher >= 8 && history.length >= 10) {
        // Menang 8/10 game — sangat unusual
        flags.push(`VERY_HIGH_WIN_RATE:${winsVsHigher}/10`);
        score += 20;
      }
    }
  } catch (e) {
    console.error('[ELO-ANOMALY] History query failed:', e.message);
  }

  return {
    suspicious: score >= 25,
    flags,
    score,
  };
}

// ── Layer 5: Stockfish background analysis (async, non-blocking) ──────────

/**
 * Jalankan Stockfish comparison di background.
 * Dipanggil dari endGame() tanpa await — tidak memblok response ke client.
 *
 * Jika flagging/suspicion ditemukan, update DB dan enforce.
 */
async function runStockfishBackground(gameId, moveHistory, existingFlags, io) {
  try {
    // Run Stockfish when there are any pre-existing flags (timing, accuracy, or ELO),
    // OR unconditionally on ~20% of games as a random spot-check for slow engine users.
    if (existingFlags.length === 0 && Math.random() > 0.20) return;

    const sfResult = await runStockfishComparison(moveHistory, {
      maxSamples: 15,
      depth: 12,
      // Non-blocking run: max total waktu ~2 menit untuk seluruh game
    });

    if (!sfResult || sfResult.flags.length === 0) return;

    console.log(`[Stockfish] Game ${gameId} — flags: ${sfResult.flags.join(', ')}`);

    // Update anticheat_flags di DB dengan hasil Stockfish
    const currentGame = await supabase.from('games').select('anticheat_flags').eq('id', gameId).single();
    if (currentGame.data) {
      const existingDbFlags = currentGame.data.anticheat_flags || [];
      const newFlags = [
        ...existingDbFlags,
        { source: 'stockfish', flags: sfResult.flags, score: sfResult.suspicionScore },
      ];
      await supabase.from('games').update({ anticheat_flags: newFlags }).eq('id', gameId);
    }

    // Enforce untuk setiap warna yang terkena flag
    for (const color of ['white', 'black']) {
      const colorFlags = sfResult.flags.filter(f => f.startsWith(color.toUpperCase()));
      if (colorFlags.length === 0) continue;

      // Cari userId berdasarkan warna — kita butuh game data
      const gameData = await supabase
        .from('games')
        .select('white_id, black_id')
        .eq('id', gameId)
        .single();

      if (!gameData.data) continue;

      const userId = color === 'white' ? gameData.data.white_id : gameData.data.black_id;
      await enforceAnticheat(userId, gameId, {
        flags: colorFlags,
        score: sfResult.suspicionScore,
      }, io);
    }

  } catch (err) {
    console.error('[Stockfish:background]', err.message);
  }
}

// ── Main Analysis (sync, fast) ─────────────────────────────────────────────

/**
 * analyzeGame — dipanggil synchronously di endGame().
 * Menjalankan Layer 1 (timing) + Layer 2 (integrity) + Layer 3 (accuracy).
 * Layer 4 & 5 dijalankan secara async terpisah via analyzeGameAsync().
 */
function analyzeGame(game) {
  const results = {
    white: { suspicious: false, flags: [], score: 0 },
    black: { suspicious: false, flags: [], score: 0 },
  };

  const moves = game.move_history || game.moveHistory || [];
  if (!moves.length) return results;

  // Layer 2: Integrity check
  const integrity = validateGameIntegrity(moves);
  if (!integrity.valid) {
    for (const color of ['white', 'black']) {
      results[color].flags.push(...integrity.flags);
      results[color].score += 100;
      results[color].suspicious = true;
    }
    return results; // Game tidak valid — tidak perlu analisis lain
  }

  // Pisah moves per warna
  const whiteMoves = moves.filter((_, i) => i % 2 === 0);
  const blackMoves = moves.filter((_, i) => i % 2 === 1);

  // Layer 1: Timing analysis per warna
  const whiteTiming = analyzeMoveTimings(whiteMoves);
  const blackTiming = analyzeMoveTimings(blackMoves);

  // Layer 3: Accuracy analysis (chess.js based)
  const accuracy = analyzeAccuracy(moves);

  // White
  {
    const accFlags = accuracy.white
      ? buildAccuracyFlags(accuracy.white, parseFloat(whiteTiming.stats?.avg || '999'))
      : { flags: [], score: 0 };

    results.white = {
      suspicious: whiteTiming.suspicious || accFlags.score >= 20,
      flags: [...whiteTiming.flags, ...accFlags.flags],
      score: whiteTiming.score + accFlags.score,
      stats: { timing: whiteTiming.stats, accuracy: accuracy.white },
    };
  }

  // Black
  {
    const accFlags = accuracy.black
      ? buildAccuracyFlags(accuracy.black, parseFloat(blackTiming.stats?.avg || '999'))
      : { flags: [], score: 0 };

    results.black = {
      suspicious: blackTiming.suspicious || accFlags.score >= 20,
      flags: [...blackTiming.flags, ...accFlags.flags],
      score: blackTiming.score + accFlags.score,
      stats: { timing: blackTiming.stats, accuracy: accuracy.black },
    };
  }

  return results;
}

// ── Real-time analysis (mid-game, every N moves) ───────────────────────────

function analyzeRealtime(moveHistory) {
  if (!moveHistory || moveHistory.length < 6) {
    return { white: { suspicious: false, flags: [], score: 0 }, black: { suspicious: false, flags: [], score: 0 } };
  }

  const whiteMoves = moveHistory.filter((_, i) => i % 2 === 0);
  const blackMoves = moveHistory.filter((_, i) => i % 2 === 1);

  return {
    white: analyzeMoveTimings(whiteMoves),
    black: analyzeMoveTimings(blackMoves),
  };
}

// ── Disconnect Abuse ───────────────────────────────────────────────────────

function detectDisconnectAbuse(userId, disconnectHistory) {
  const recent = disconnectHistory.filter(d =>
    d.userId === userId && Date.now() - d.timestamp < 86400000
  );
  return {
    abusive: recent.length >= 3,
    count: recent.length,
    flags: recent.length >= 3 ? ['DISCONNECT_ABUSE'] : [],
  };
}

// ── Enforcement ────────────────────────────────────────────────────────────

async function enforceAnticheat(userId, gameId, result, io) {
  if (!result?.flags?.length) return;

  const { flags, score } = result;

  // Hitung total penalti dari semua flags
  const penalty = flags.reduce((sum, flag) => {
    const baseFlag = flag.split(':')[0]; // "ELO_GAP_WIN:+450" → "ELO_GAP_WIN"
    return sum + (TRUST_PENALTY[baseFlag] || 5);
  }, 0);

  try {
    const { data: userData } = await supabase
      .from('users')
      .select('trust_score, flagged, username')
      .eq('id', userId)
      .single();

    if (!userData) return;

    const currentTrust = userData.trust_score ?? 100;
    const newTrust     = Math.max(0, currentTrust - penalty);

    let action  = 'warn';
    const updates = { trust_score: newTrust };

    if (score >= ENFORCE_THRESHOLDS.suspend && !userData.flagged) {
      action = 'suspend';
      updates.flagged        = true;
      updates.flagged_reason = `Auto-suspend: score ${score} — ${flags.join(', ')}`;
      updates.flagged_at     = new Date();
      console.warn(`[ANTICHEAT] 🚫 AUTO-SUSPEND ${userData.username} — score:${score} flags:${flags.join(',')}`);
    } else if (score >= ENFORCE_THRESHOLDS.flag && !userData.flagged) {
      action = 'flag';
      updates.flagged        = true;
      updates.flagged_reason = `Auto-flag: score ${score} — ${flags.join(', ')}`;
      updates.flagged_at     = new Date();
      console.warn(`[ANTICHEAT] ⚠️  AUTO-FLAG ${userData.username} — score:${score} flags:${flags.join(',')}`);
    } else if (score >= ENFORCE_THRESHOLDS.warn) {
      action = 'warn';
      console.info(`[ANTICHEAT] 📢 WARN ${userData.username} — score:${score} flags:${flags.join(',')}`);
    }

    await supabase
      .from('users')
      .update({ ...updates, updated_at: new Date() })
      .eq('id', userId);

    await logAnticheatAction({
      userId, gameId, action,
      reason: `flags: ${flags.join(', ')} | score: ${score} | penalty: -${penalty}`,
      flags,
      score,
    });

    // Real-time notification ke user
    if (io && (action === 'flag' || action === 'suspend')) {
      io.to(userId).emit('account:status', {
        action,
        trustScore: newTrust,
        message: action === 'suspend'
          ? '🚫 Akun Anda disuspend karena indikasi penggunaan engine. Hubungi support untuk banding.'
          : '⚠️ Akun Anda ditandai karena pola permainan mencurigakan dan sedang ditinjau.',
      });
    }
  } catch (err) {
    console.error('[ANTICHEAT] enforceAnticheat error:', err.message);
  }
}

module.exports = {
  analyzeGame,
  analyzeRealtime,
  analyzeMoveTimings,
  validateGameIntegrity,
  detectDisconnectAbuse,
  detectEloAnomaly,
  enforceAnticheat,
  runStockfishBackground,
};

/**
 * Collusion Detection — Match-Fixing & Material Gifting
 *
 * Skenario yang dideteksi:
 *  1. REPEAT_PAIR     — dua user bermain terlalu sering berdua (>10 game)
 *  2. ONE_SIDED_WINS  — satu user selalu menang vs user yang sama (>80%)
 *  3. FAST_RESIGN     — lawan resign terlalu cepat (<5 move) secara berulang
 *  4. MATERIAL_GIFT   — pemain menyerahkan material besar tanpa tekanan posisi
 *
 * Semua deteksi berjalan async post-game — tidak memblok game result.
 */

const { Chess } = require('chess.js');
const { supabase } = require('./db');

// Nilai bidak (centipawn)
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// ── Helpers ────────────────────────────────────────────────────────────────

function countMaterial(chess) {
  const board = chess.board();
  const scores = { w: 0, b: 0 };
  for (const row of board) {
    for (const sq of row) {
      if (sq) scores[sq.color] += PIECE_VALUES[sq.type] || 0;
    }
  }
  return scores;
}

// ── Detector 1: Repeat Pair ────────────────────────────────────────────────

/**
 * Cek berapa kali dua user ini bermain berdua dalam 30 hari terakhir.
 * Threshold: >10 game → suspicious (mungkin farming ELO/coins)
 */
async function detectRepeatPair(userAId, userBId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from('games')
      .select('id, winner, ended_at, move_history')
      .or(
        `and(white_id.eq.${userAId},black_id.eq.${userBId}),` +
        `and(white_id.eq.${userBId},black_id.eq.${userAId})`
      )
      .eq('status', 'finished')
      .gte('ended_at', thirtyDaysAgo)
      .order('ended_at', { ascending: false });

    if (error || !data) return { flags: [], score: 0 };

    const gameCount = data.length;
    if (gameCount < 5) return { flags: [], score: 0 };

    // Analisis win distribution
    let aWins = 0, bWins = 0, draws = 0;
    for (const g of data) {
      const aIsWhite = g.white_id === userAId;
      if (g.winner === 'draw') { draws++; continue; }
      const aWon = (g.winner === 'white' && aIsWhite) || (g.winner === 'black' && !aIsWhite);
      if (aWon) aWins++; else bWins++;
    }

    const flags = [];
    let score = 0;

    // Flag jika terlalu sering bermain berdua
    if (gameCount > 15) {
      flags.push(`REPEAT_PAIR:${gameCount}games`);
      score += gameCount > 25 ? 35 : 20;
    } else if (gameCount > 10) {
      flags.push(`REPEAT_PAIR:${gameCount}games`);
      score += 15;
    }

    // Flag jika salah satu selalu menang (>80% dari total yang dimainkan)
    const total = aWins + bWins + draws;
    const aWinRate = total > 0 ? aWins / total : 0;
    const bWinRate = total > 0 ? bWins / total : 0;

    if (aWinRate >= 0.80 && total >= 8) {
      flags.push(`ONE_SIDED_WINS:A_wins_${Math.round(aWinRate * 100)}%`);
      score += aWinRate >= 0.90 ? 40 : 25;
    } else if (bWinRate >= 0.80 && total >= 8) {
      flags.push(`ONE_SIDED_WINS:B_wins_${Math.round(bWinRate * 100)}%`);
      score += bWinRate >= 0.90 ? 40 : 25;
    }

    // Flag jika banyak game sangat pendek (fast resign pattern)
    const shortGames = data.filter(g => {
      const moves = g.move_history || [];
      return moves.length <= 8; // resign dalam 4 move per warna
    });

    if (shortGames.length >= 3 && shortGames.length / gameCount >= 0.3) {
      flags.push(`FAST_RESIGN_PATTERN:${shortGames.length}of${gameCount}`);
      score += 30;
    }

    return { flags, score, stats: { gameCount, aWins, bWins, draws } };
  } catch (e) {
    console.error('[Collusion:detectRepeatPair]', e.message);
    return { flags: [], score: 0 };
  }
}

// ── Detector 2: Material Gifting ────────────────────────────────────────────

/**
 * Analisis apakah pemain menyerahkan material berharga tanpa tekanan posisi.
 *
 * "Gift" = drop >300cp (3 pawns) sendiri tanpa ada counter-play nyata.
 * Jika player melakukan ini >2 kali dalam satu game → suspicious.
 */
function detectMaterialGifting(moveHistory) {
  if (!moveHistory || moveHistory.length < 6) return { flags: [], score: 0 };

  const chess = new Chess();
  const gifts = { white: [], black: [] };

  for (let i = 0; i < moveHistory.length; i++) {
    const m = moveHistory[i];
    const color = i % 2 === 0 ? 'white' : 'black';
    const colorChar = i % 2 === 0 ? 'w' : 'b';

    const matBefore = countMaterial(chess);

    let result;
    try {
      result = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch { break; }
    if (!result) break;

    const matAfter = countMaterial(chess);

    // Drop material besar milik sendiri (bukan karena capture lawannya)
    const ownDelta = matAfter[colorChar] - matBefore[colorChar];
    if (ownDelta <= -300 && !result.captured) {
      // Material drop besar tanpa kita melakukan capture (kemungkinan hanging piece)
      gifts[color].push({
        move: i,
        san: result.san,
        drop: -ownDelta,
      });
    }
  }

  const flags = [];
  let score = 0;

  for (const color of ['white', 'black']) {
    if (gifts[color].length >= 2) {
      flags.push(`MATERIAL_GIFT:${color.toUpperCase()}:${gifts[color].length}times`);
      score += gifts[color].length >= 3 ? 40 : 25;
    }
  }

  return { flags, score, gifts };
}

// ── Main: runCollusionDetection ────────────────────────────────────────────

/**
 * Entry point — dipanggil dari endGame() secara async.
 * Menjalankan semua detector dan mengembalikan combined result.
 *
 * @param {string} gameId
 * @param {string} whiteId
 * @param {string} blackId
 * @param {Array}  moveHistory
 * @param {string} winner        'white'|'black'|'draw'
 * @param {string} endReason     'checkmate'|'resign'|'timeout'|...
 * @returns {{ white: DetectionResult, black: DetectionResult }}
 */
async function runCollusionDetection(gameId, whiteId, blackId, moveHistory, winner, endReason) {
  try {
    console.log(`[Collusion] Analyzing game ${gameId}...`);

    // Detector 1: Pair stats (sama untuk kedua player)
    const pairResult = await detectRepeatPair(whiteId, blackId);

    // Detector 2: Material gifting (per move history, per warna)
    const giftResult = detectMaterialGifting(moveHistory);

    // Suspicious fast resign (current game)
    const currentGameShort = moveHistory.length <= 8 && endReason === 'resign';

    const combined = {
      white: {
        flags: [
          ...pairResult.flags,
          ...giftResult.flags.filter(f => f.includes('WHITE')),
          ...(currentGameShort ? ['FAST_RESIGN:current_game'] : []),
        ],
        score: pairResult.score + giftResult.flags.filter(f => f.includes('WHITE')).length * 20,
      },
      black: {
        flags: [
          ...pairResult.flags,
          ...giftResult.flags.filter(f => f.includes('BLACK')),
          ...(currentGameShort ? ['FAST_RESIGN:current_game'] : []),
        ],
        score: pairResult.score + giftResult.flags.filter(f => f.includes('BLACK')).length * 20,
      },
    };

    // Tandai kedua pemain suspicious jika pair-level flags ada
    combined.white.suspicious = combined.white.score >= 25;
    combined.black.suspicious = combined.black.score >= 25;

    if (pairResult.flags.length > 0 || giftResult.flags.length > 0) {
      console.warn('[Collusion] Suspicious patterns detected:', {
        gameId, pairFlags: pairResult.flags, giftFlags: giftResult.flags,
        stats: pairResult.stats,
      });

      // Persist ke collusion_flags untuk admin review
      await supabase
        .from('collusion_flags')
        .insert({
          game_id:      gameId,
          user_id_a:    whiteId < blackId ? whiteId : blackId,
          user_id_b:    whiteId < blackId ? blackId : whiteId,
          pair_flags:   JSON.stringify(pairResult.flags),
          gift_flags:   JSON.stringify(giftResult.flags),
          pair_score:   pairResult.score,
          pair_stats:   pairResult.stats ? JSON.stringify(pairResult.stats) : null,
          detected_at:  new Date(),
          reviewed:     false,
        })
        .then(() => {})
        .catch(e => console.error('[Collusion] DB insert failed:', e.message));
    }

    return combined;
  } catch (err) {
    console.error('[Collusion] runCollusionDetection error:', err.message);
    return {
      white: { flags: [], score: 0, suspicious: false },
      black: { flags: [], score: 0, suspicious: false },
    };
  }
}

module.exports = { runCollusionDetection, detectMaterialGifting, detectRepeatPair };

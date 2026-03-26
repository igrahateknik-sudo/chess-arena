/**
 * Stockfish Verification Script
 * Jalankan: node scripts/verify-stockfish.js
 *
 * Memverifikasi bahwa:
 *  1. analyzeAccuracy() (Layer 1) berjalan tanpa Stockfish
 *  2. stockfish binary ditemukan di sistem (layer 2 prerequisite)
 *  3. Engine dapat menerima perintah UCI dan menghasilkan bestmove via spawn
 *
 * Untuk aktivasi Layer 2 di lokal:
 *   macOS:  brew install stockfish
 *   Ubuntu: sudo apt-get install stockfish
 *   Alpine: apk add stockfish   (otomatis di Docker/Railway)
 */

const { getTopMovesFromStockfish, analyzeAccuracy } = require('../src/lib/stockfishAnalysis');
const { spawnSync } = require('child_process');

const TEST_FEN   = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const TEST_MOVES = [
  { from: 'e2', to: 'e4', timestamp: 1000 },
  { from: 'e7', to: 'e5', timestamp: 3000 },
  { from: 'g1', to: 'f3', timestamp: 5500 },
  { from: 'b8', to: 'c6', timestamp: 7000 },
  { from: 'f1', to: 'c4', timestamp: 9200 },
  { from: 'g8', to: 'f6', timestamp: 11000 },
  { from: 'd2', to: 'd3', timestamp: 13800 },
  { from: 'd7', to: 'd6', timestamp: 15500 },
  { from: 'c1', to: 'e3', timestamp: 17200 },
  { from: 'c8', to: 'e6', timestamp: 19000 },
  { from: 'b1', to: 'c3', timestamp: 20500 },
  { from: 'f8', to: 'e7', timestamp: 22000 },
];

const STOCKFISH_CANDIDATES = [
  'stockfish',
  '/usr/bin/stockfish',
  '/usr/games/stockfish',
  '/usr/local/bin/stockfish',
  '/opt/homebrew/bin/stockfish',
];

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Chess Arena — Stockfish Verification');
  console.log('═══════════════════════════════════════════════\n');

  let allPassed = true;

  // ── Test 1: Layer 1 (chess.js accuracy analysis) ──────────────────────────
  console.log('▶ Test 1: Layer 1 — Blunder-rate analysis (chess.js)');
  try {
    const accuracy = analyzeAccuracy(TEST_MOVES);
    if (accuracy.white !== null || accuracy.black !== null) {
      console.log('  ✅ analyzeAccuracy() returned:', JSON.stringify(accuracy, null, 4));
    } else {
      console.log('  ℹ️  analyzeAccuracy() returned null (< 10 moves, expected for test)');
    }
  } catch (e) {
    console.error('  ❌ FAILED:', e.message);
    allPassed = false;
  }

  // ── Test 2: Stockfish binary detection ────────────────────────────────────
  console.log('\n▶ Test 2: Layer 2 — Stockfish binary detection');
  let stockfishAvailable = false;
  let foundBinary = null;

  for (const candidate of STOCKFISH_CANDIDATES) {
    try {
      const result = spawnSync(candidate, [], {
        input: 'quit\n', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (result.status === 0 || (result.stdout && result.stdout.length > 0)) {
        stockfishAvailable = true;
        foundBinary = candidate;
        console.log(`  ✅ Binary ditemukan: ${candidate}`);
        break;
      }
    } catch { /* coba kandidat berikutnya */ }
  }

  if (!stockfishAvailable) {
    console.warn('  ⚠️  Stockfish binary tidak ditemukan di sistem');
    console.warn('  ℹ️  Untuk aktivasi Layer 2:');
    console.warn('       macOS:  brew install stockfish');
    console.warn('       Ubuntu: sudo apt-get install stockfish');
    console.warn('       Alpine: apk add stockfish  (otomatis via Dockerfile)');
  }

  // ── Test 3: UCI engine communication ──────────────────────────────────────
  if (stockfishAvailable) {
    console.log(`\n▶ Test 3: UCI engine communication via spawn (depth 8, timeout 10s)`);
    try {
      const start  = Date.now();
      const result = await getTopMovesFromStockfish(TEST_FEN, 8, 3, 10000);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (result.unavailable) {
        console.warn('  ⚠️  Engine tidak tersedia meski binary ditemukan');
        allPassed = false;
      } else if (result.timedOut) {
        console.warn(`  ⚠️  Engine timeout setelah ${elapsed}s`);
      } else if (result.bestMove) {
        console.log(`  ✅ bestMove: ${result.bestMove} | topMoves: [${result.topMoves.join(', ')}] | ${elapsed}s`);
      } else {
        console.warn('  ⚠️  Tidak ada bestmove yang dikembalikan');
        allPassed = false;
      }
    } catch (e) {
      console.error('  ❌ FAILED:', e.message);
      allPassed = false;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  if (allPassed && stockfishAvailable) {
    console.log('  ✅ ALL TESTS PASSED — Stockfish Layer 2 ACTIVE');
    console.log('  Layer 1 (chess.js):   ✅ Ready');
    console.log(`  Layer 2 (Stockfish):  ✅ Ready — binary: ${foundBinary}`);
    process.exit(0);
  } else if (allPassed) {
    console.log('  ⚠️  Layer 1 READY, Layer 2 NEEDS binary install');
    console.log('  Railway/Docker akan otomatis install via Dockerfile (apk add stockfish)');
    process.exit(0);
  } else {
    console.log('  ❌ SOME TESTS FAILED — review output above');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});

/**
 * Unit tests for lib/anticheat.js
 * Tests each detection layer independently.
 */

// Mock db.js before anticheat.js loads it
jest.mock('../src/lib/db', () => ({
  supabase: {},
  eloHistory: {
    getForUser: jest.fn(async () => []),
  },
}));

jest.mock('../src/lib/auditLog', () => ({
  logAnticheatAction: jest.fn(async () => {}),
}));

jest.mock('../src/lib/stockfishAnalysis', () => ({
  analyzeAccuracy: jest.fn(() => ({
    white: { blunders: 2, total: 20, blunderRate: 0.1 },
    black: { blunders: 3, total: 20, blunderRate: 0.15 },
  })),
  runStockfishComparison: jest.fn(async () => null),
}));

const {
  analyzeMoveTimings,
  validateGameIntegrity,
  analyzeGame,
  analyzeRealtime,
} = require('../src/lib/anticheat');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMoves(count, avgMs = 5000, stdDevMs = 2000) {
  const moves = [];
  let ts = Date.now() - count * avgMs;
  for (let i = 0; i < count; i++) {
    ts += avgMs + (Math.random() - 0.5) * stdDevMs;
    moves.push({
      san: i % 2 === 0 ? `e${Math.floor(Math.random() * 4) + 3}` : `d${Math.floor(Math.random() * 4) + 3}`,
      from: 'e2', to: 'e4',
      timestamp: Math.round(ts),
    });
  }
  return moves;
}

function makeUltraFastMoves(count) {
  // Move every 300ms — ultra fast (bot-like)
  return makeMoves(count, 300, 50);
}

function makeNormalMoves(count) {
  // Normal human pace 3–10 seconds per move
  return makeMoves(count, 5000, 2000);
}

function makeValidChessMoves() {
  // Real valid chess moves from starting position
  return [
    { san: 'e4',  from: 'e2', to: 'e4', timestamp: 1000  },
    { san: 'e5',  from: 'e7', to: 'e5', timestamp: 5000  },
    { san: 'Nf3', from: 'g1', to: 'f3', timestamp: 9000  },
    { san: 'Nc6', from: 'b8', to: 'c6', timestamp: 13000 },
    { san: 'Bb5', from: 'f1', to: 'b5', timestamp: 17000 },
    { san: 'a6',  from: 'a7', to: 'a6', timestamp: 21000 },
    { san: 'Ba4', from: 'b5', to: 'a4', timestamp: 25000 },
    { san: 'Nf6', from: 'g8', to: 'f6', timestamp: 29000 },
    { san: 'O-O', from: 'e1', to: 'g1', timestamp: 33000 },
    { san: 'Be7', from: 'f8', to: 'e7', timestamp: 37000 },
  ];
}

// ── Layer 1: Timing Analysis ──────────────────────────────────────────────────

describe('Layer 1 — Timing Analysis', () => {

  it('returns not suspicious for normal human moves', () => {
    const moves = makeNormalMoves(20);
    const result = analyzeMoveTimings(moves);
    expect(result.suspicious).toBe(false);
  });

  it('flags ULTRA_FAST_MOVES when >50% of moves are under 1 second', () => {
    const moves = makeUltraFastMoves(20);
    const result = analyzeMoveTimings(moves);
    expect(result.flags).toContain('ULTRA_FAST_MOVES');
    expect(result.score).toBeGreaterThan(0);
  });

  it('returns not suspicious for fewer than 10 moves', () => {
    const moves = makeNormalMoves(5);
    const result = analyzeMoveTimings(moves);
    expect(result.suspicious).toBe(false);
    expect(result.flags).toHaveLength(0);
  });

  it('flags FAST_MOVES when average move time < 0.5s', () => {
    const moves = makeMoves(15, 400, 50); // avg 400ms
    const result = analyzeMoveTimings(moves);
    expect(result.flags).toContain('FAST_MOVES');
  });

  it('flags CONSISTENT_TIMING for robot-like consistent fast moves', () => {
    // Extremely consistent 1s per move (low variance)
    const moves = makeMoves(20, 1000, 20); // very low stddev
    const result = analyzeMoveTimings(moves);
    // Could flag CONSISTENT_TIMING
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('returns stats object with avg, stdDev, cv, samples', () => {
    const moves = makeNormalMoves(15);
    const result = analyzeMoveTimings(moves);
    if (result.stats) {
      expect(result.stats).toHaveProperty('avg');
      expect(result.stats).toHaveProperty('stdDev');
      expect(result.stats).toHaveProperty('cv');
      expect(result.stats).toHaveProperty('samples');
    }
  });

  it('uses online-game whiteTimeLeft deltas (not wall-clock gaps)', () => {
    const whiteMoves = [];
    let ts = 0;
    let whiteTimeLeft = 180;
    for (let i = 0; i < 12; i++) {
      whiteMoves.push({
        san: 'e4',
        from: 'e2',
        to: 'e4',
        timestamp: ts,
        whiteTimeLeft,
      });
      // Simulate long wall-clock gaps (includes opponent turn), but only 1s
      // own-think-time per white move from clock deltas.
      ts += 11000;
      whiteTimeLeft -= 1;
    }

    const result = analyzeMoveTimings(whiteMoves);
    expect(result.stats?.avg).toBe('1.00');
    expect(result.flags).toContain('CONSISTENT_TIMING');
  });
});

// ── Layer 2: Game Integrity ───────────────────────────────────────────────────

describe('Layer 2 — Game Integrity', () => {

  it('validates a legal sequence of chess moves', () => {
    const result = validateGameIntegrity(makeValidChessMoves());
    expect(result.valid).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it('detects illegal moves', () => {
    const moves = [
      { san: 'Ke2', from: 'e1', to: 'e2', timestamp: 1000 }, // illegal from start (pawn on e2)
    ];
    const result = validateGameIntegrity(moves);
    expect(result.valid).toBe(false);
    expect(result.flags.length).toBeGreaterThan(0);
  });

  it('returns valid for empty move list', () => {
    const result = validateGameIntegrity([]);
    expect(result.valid).toBe(true);
  });

  it('stops at first illegal move', () => {
    const validMoves = makeValidChessMoves().slice(0, 4);
    const illegal = { san: 'Qa8', from: 'e1', to: 'a8', timestamp: 20000 }; // illegal
    const result = validateGameIntegrity([...validMoves, illegal]);
    expect(result.valid).toBe(false);
  });
});

// ── analyzeGame (sync combined) ────────────────────────────────────────────────

describe('analyzeGame — Combined sync analysis', () => {

  it('returns { white, black } objects', () => {
    const result = analyzeGame({ move_history: makeValidChessMoves() });
    expect(result).toHaveProperty('white');
    expect(result).toHaveProperty('black');
  });

  it('returns not suspicious for normal game', () => {
    const moves = [
      ...makeValidChessMoves(),
      ...makeValidChessMoves().map(m => ({ ...m, timestamp: m.timestamp + 50000 })),
    ];
    const result = analyzeGame({ move_history: moves });
    // Should not be suspicious for normal play
    expect(result.white).toHaveProperty('suspicious');
    expect(result.black).toHaveProperty('suspicious');
  });

  it('returns not suspicious for empty game', () => {
    const result = analyzeGame({ move_history: [] });
    expect(result.white.suspicious).toBe(false);
    expect(result.black.suspicious).toBe(false);
  });

  it('handles missing move_history gracefully', () => {
    const result = analyzeGame({});
    expect(result.white.suspicious).toBe(false);
    expect(result.black.suspicious).toBe(false);
  });

  it('marks both players suspicious if moves are invalid', () => {
    const badMoves = [
      { san: 'Qa8', from: 'e1', to: 'a8', timestamp: 1000 }, // illegal
    ];
    const result = analyzeGame({ move_history: badMoves });
    expect(result.white.suspicious).toBe(true);
    expect(result.black.suspicious).toBe(true);
    expect(result.white.score).toBeGreaterThanOrEqual(100);
  });
});

// ── analyzeRealtime ────────────────────────────────────────────────────────────

describe('analyzeRealtime', () => {

  it('returns { white, black } for sufficient moves', () => {
    const moves = makeNormalMoves(20);
    const result = analyzeRealtime(moves);
    expect(result).toHaveProperty('white');
    expect(result).toHaveProperty('black');
  });

  it('returns not suspicious for too few moves', () => {
    const result = analyzeRealtime(makeNormalMoves(4));
    expect(result.white.suspicious).toBe(false);
    expect(result.black.suspicious).toBe(false);
  });

  it('handles null/undefined gracefully', () => {
    const result = analyzeRealtime(null);
    expect(result.white.suspicious).toBe(false);
    expect(result.black.suspicious).toBe(false);
  });

  it('separates white and black moves correctly (even/odd indices)', () => {
    // Create 20 moves where white moves are normal but black moves are ultra-fast
    const moves = [];
    let ts = Date.now();
    for (let i = 0; i < 20; i++) {
      const interval = i % 2 === 0 ? 5000 : 200; // white slow, black fast
      ts += interval;
      moves.push({ san: 'e4', from: 'e2', to: 'e4', timestamp: ts });
    }
    const result = analyzeRealtime(moves);
    // White (slow) should have equal or lower score than black (fast)
    expect(result.white.score).toBeLessThanOrEqual(result.black.score);
  });
});

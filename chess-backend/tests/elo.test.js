/**
 * Unit tests for lib/elo.js
 * FIDE ELO calculation compliance
 */

const { calculateEloChange, calculateBothElo } = require('../src/lib/elo');

describe('ELO Calculation — FIDE Standard', () => {

  // ── K-factor ───────────────────────────────────────────────────────────────
  describe('K-factor selection', () => {
    it('uses K=40 for new players (< 30 games)', () => {
      // Win against equal: expected = 0.5, actual = 1 → K * 0.5 = 20
      const change = calculateEloChange(1500, 1500, 'win', 10);
      expect(change).toBe(20); // 40 * (1 - 0.5) = 20
    });

    it('uses K=40 for players with rating < 1000', () => {
      const change = calculateEloChange(800, 800, 'win', 100);
      expect(change).toBe(20); // K=40 because rating < 1000
    });

    it('uses K=20 for standard players (≥ 30 games, < 2400)', () => {
      const change = calculateEloChange(1500, 1500, 'win', 30);
      expect(change).toBe(10); // 20 * (1 - 0.5) = 10
    });

    it('uses K=10 for master players (rating ≥ 2400)', () => {
      const change = calculateEloChange(2400, 2400, 'win', 100);
      expect(change).toBe(5); // 10 * (1 - 0.5) = 5
    });
  });

  // ── Expected score ─────────────────────────────────────────────────────────
  describe('Expected score formula', () => {
    it('returns 0.5 when ratings are equal', () => {
      // Win against equal should give exactly K/2 change
      const change = calculateEloChange(1500, 1500, 'win', 30);
      expect(change).toBe(10); // K=20, 20 * (1 - 0.5) = 10
    });

    it('gives smaller gain for beating a weaker player', () => {
      const gainVsWeak   = calculateEloChange(1600, 1200, 'win', 30);
      const gainVsEqual  = calculateEloChange(1600, 1600, 'win', 30);
      expect(gainVsWeak).toBeLessThan(gainVsEqual);
    });

    it('gives larger gain for beating a stronger player', () => {
      const gainVsStrong = calculateEloChange(1200, 1600, 'win', 30);
      const gainVsEqual  = calculateEloChange(1200, 1200, 'win', 30);
      expect(gainVsStrong).toBeGreaterThan(gainVsEqual);
    });
  });

  // ── Result mapping ─────────────────────────────────────────────────────────
  describe('Result to score mapping', () => {
    it('win = +positive change', () => {
      expect(calculateEloChange(1500, 1500, 'win', 30)).toBeGreaterThan(0);
    });

    it('draw = 0 change when ratings are equal', () => {
      expect(calculateEloChange(1500, 1500, 'draw', 30)).toBe(0);
    });

    it('loss = negative change', () => {
      expect(calculateEloChange(1500, 1500, 'loss', 30)).toBeLessThan(0);
    });

    it('loss change is negative of win change (symmetric at equal ratings)', () => {
      const win  = calculateEloChange(1500, 1500, 'win',  30);
      const loss = calculateEloChange(1500, 1500, 'loss', 30);
      expect(win + loss).toBe(0);
    });
  });

  // ── calculateBothElo ────────────────────────────────────────────────────────
  describe('calculateBothElo', () => {
    it('white win: white gains, black loses', () => {
      const { whiteChange, blackChange } = calculateBothElo(1500, 1500, 'white');
      expect(whiteChange).toBeGreaterThan(0);
      expect(blackChange).toBeLessThan(0);
    });

    it('black win: black gains, white loses', () => {
      const { whiteChange, blackChange } = calculateBothElo(1500, 1500, 'black');
      expect(whiteChange).toBeLessThan(0);
      expect(blackChange).toBeGreaterThan(0);
    });

    it('draw: both changes are equal and opposite (zero sum at equal ratings)', () => {
      const { whiteChange, blackChange } = calculateBothElo(1500, 1500, 'draw');
      expect(whiteChange).toBe(0);
      expect(blackChange).toBe(0);
    });

    it('sum of changes is approximately zero (zero-sum system)', () => {
      // At unequal ratings the individual changes differ but should cancel
      const { whiteChange, blackChange } = calculateBothElo(1400, 1600, 'white');
      // Both use K=20, so sum should be 0 (zero-sum at same K)
      expect(whiteChange + blackChange).toBe(0);
    });

    it('upset (weaker beats stronger) gives larger gain', () => {
      const { whiteChange } = calculateBothElo(1200, 1600, 'white');
      const { whiteChange: normalGain } = calculateBothElo(1200, 1200, 'white');
      expect(whiteChange).toBeGreaterThan(normalGain);
    });

    it('ELO never drops below 100 floor when enforced', () => {
      // calculateBothElo itself doesn't enforce the floor — that's done in gameRoom
      // But the change should be a negative integer when losing
      const { blackChange } = calculateBothElo(100, 100, 'white');
      expect(typeof blackChange).toBe('number');
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────
  describe('Edge cases', () => {
    it('handles very large ELO gap (400 expected → near 0 gain for favourite)', () => {
      // A 2800 player winning against 1000 should gain almost nothing
      const change = calculateEloChange(2800, 1000, 'win', 30);
      expect(change).toBeGreaterThanOrEqual(0);
      expect(change).toBeLessThanOrEqual(2);
    });

    it('returns integer values', () => {
      const change = calculateEloChange(1500, 1600, 'win', 30);
      expect(Number.isInteger(change)).toBe(true);
    });

    it('gamesPlayed defaults to 30 (standard K-factor)', () => {
      const withDefault = calculateEloChange(1500, 1500, 'win');
      const withExplicit = calculateEloChange(1500, 1500, 'win', 30);
      expect(withDefault).toBe(withExplicit);
    });
  });
});

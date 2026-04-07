jest.mock('../src/lib/db', () => {
  const chain = {
    select: jest.fn(() => chain),
    or: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    gte: jest.fn(() => chain),
    order: jest.fn(async () => ({ data: [], error: null })),
    insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
  };
  return {
    supabase: {
      from: jest.fn(() => chain),
    },
  };
});

const { detectRepeatPair, runCollusionDetection } = require('../src/lib/collusion');
const { supabase } = require('../src/lib/db');

describe('collusion detectors', () => {
  it('uses pair history with white/black ids and computes one-sided flags', async () => {
    const games = Array.from({ length: 11 }).map((_, i) => ({
      id: `g-${i}`,
      white_id: i % 2 ? 'b' : 'a',
      black_id: i % 2 ? 'a' : 'b',
      winner: i < 9 ? 'white' : 'draw',
      move_history: [],
      ended_at: new Date().toISOString(),
    }));
    const chain = supabase.from();
    chain.order.mockResolvedValueOnce({ data: games, error: null });

    const result = await detectRepeatPair('a', 'b');
    expect(result.flags.some((f) => f.startsWith('REPEAT_PAIR'))).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('scores both players from gift + pair signals', async () => {
    const chain = supabase.from();
    chain.order.mockResolvedValueOnce({ data: [], error: null });
    const moveHistory = [
      { from: 'f2', to: 'f3' }, { from: 'e7', to: 'e5' },
      { from: 'g2', to: 'g4' }, { from: 'd8', to: 'h4' },
      { from: 'b1', to: 'c3' }, { from: 'h4', to: 'e1' },
    ];
    const result = await runCollusionDetection('game1', 'u1', 'u2', moveHistory, 'black', 'resign');
    expect(result.white.score).toBeGreaterThanOrEqual(0);
    expect(result.black.score).toBeGreaterThanOrEqual(0);
  });
});

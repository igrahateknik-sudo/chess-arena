-- ── Tournament Pairings Table ─────────────────────────────────────────────────
-- Menyimpan pairing Swiss setiap ronde tournament

CREATE TABLE IF NOT EXISTS tournament_pairings (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id  UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  round          INTEGER NOT NULL,
  board_number   INTEGER NOT NULL,
  white_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  black_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  game_id        UUID REFERENCES games(id) ON DELETE SET NULL,
  result         VARCHAR(20),  -- '1-0' | '0-1' | '1/2-1/2' | 'bye' | NULL (pending)
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_pairings_tournament ON tournament_pairings(tournament_id, round);
CREATE INDEX IF NOT EXISTS idx_tournament_pairings_game ON tournament_pairings(game_id);

-- ── Add missing columns to tournament_registrations ───────────────────────────
ALTER TABLE tournament_registrations
  ADD COLUMN IF NOT EXISTS wins   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draws  INTEGER DEFAULT 0;

-- ── Add current_round to tournaments ─────────────────────────────────────────
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS current_round INTEGER DEFAULT 0;

-- ── Add game_id to existing tournament_games (ensure it's correct) ────────────
ALTER TABLE tournament_games
  ADD COLUMN IF NOT EXISTS white_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS black_id UUID REFERENCES users(id);

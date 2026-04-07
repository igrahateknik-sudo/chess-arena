-- ============================================================
-- Chess Arena — Supabase PostgreSQL Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      VARCHAR(30) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  elo           INTEGER DEFAULT 1200,
  games_played  INTEGER DEFAULT 0,
  wins          INTEGER DEFAULT 0,
  losses        INTEGER DEFAULT 0,
  draws         INTEGER DEFAULT 0,
  title         VARCHAR(5),        -- GM, IM, FM, CM, WGM, WIM
  country       VARCHAR(3) DEFAULT 'ID',
  avatar_url    TEXT,
  verified      BOOLEAN DEFAULT FALSE,
  verify_token  TEXT,
  reset_token   TEXT,
  online        BOOLEAN DEFAULT FALSE,
  socket_id     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Wallets ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance    BIGINT DEFAULT 0,  -- stored in IDR (Rupiah)
  locked     BIGINT DEFAULT 0,  -- amount locked in active matches
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create wallet on user insert
CREATE OR REPLACE FUNCTION create_wallet_on_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO wallets (user_id, balance) VALUES (NEW.id, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_wallet
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION create_wallet_on_user();

-- ── Transactions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  type            VARCHAR(30) NOT NULL,  -- deposit|withdraw|game-win|game-loss|game-draw|tournament-prize|commission|refund
  amount          BIGINT NOT NULL,       -- positive = credit, negative = debit
  balance_after   BIGINT,
  status          VARCHAR(20) DEFAULT 'pending',  -- pending|completed|failed|expired
  description     TEXT,
  reference       VARCHAR(100) UNIQUE,
  midtrans_order_id TEXT UNIQUE,
  midtrans_va_number TEXT,
  midtrans_payment_type TEXT,
  midtrans_raw    JSONB,
  game_id         UUID,
  tournament_id   UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Games ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS games (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  white_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  black_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  fen             TEXT DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  pgn             TEXT DEFAULT '',
  move_history    JSONB DEFAULT '[]',
  status          VARCHAR(20) DEFAULT 'active',  -- active|finished|draw|aborted
  winner          VARCHAR(10),   -- white|black|draw|null
  end_reason      VARCHAR(30),   -- checkmate|timeout|resign|draw-agreement|disconnect|stalemate
  time_control    JSONB NOT NULL,
  stakes          BIGINT DEFAULT 0,
  white_elo_before INTEGER,
  black_elo_before INTEGER,
  white_elo_after  INTEGER,
  black_elo_after  INTEGER,
  white_time_left  INTEGER,
  black_time_left  INTEGER,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  anticheat_flags JSONB DEFAULT '[]',
  responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  fairness_outcome VARCHAR(30) DEFAULT 'normal',
  fairness_context JSONB
);

ALTER TABLE games ADD COLUMN IF NOT EXISTS responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE games ADD COLUMN IF NOT EXISTS fairness_outcome VARCHAR(30) DEFAULT 'normal';
ALTER TABLE games ADD COLUMN IF NOT EXISTS fairness_context JSONB;

-- ── Tournaments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  format          VARCHAR(20) NOT NULL,   -- swiss|round-robin|knockout|arena
  time_control    JSONB NOT NULL,
  prize_pool      BIGINT DEFAULT 0,
  prize_distribution JSONB DEFAULT '[50,30,20]',  -- % per place
  entry_fee       BIGINT DEFAULT 0,
  max_players     INTEGER DEFAULT 64,
  min_elo         INTEGER DEFAULT 0,
  max_elo         INTEGER DEFAULT 9999,
  status          VARCHAR(20) DEFAULT 'upcoming',  -- upcoming|active|finished|cancelled
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ,
  winner_id       UUID REFERENCES users(id),
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_registrations (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id  UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  paid           BOOLEAN DEFAULT FALSE,
  score          DECIMAL(5,1) DEFAULT 0,
  registered_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS tournament_games (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id  UUID REFERENCES tournaments(id),
  game_id        UUID REFERENCES games(id),
  round          INTEGER,
  board          INTEGER
);

-- ── ELO History ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS elo_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  elo_before  INTEGER,
  elo_after   INTEGER,
  change      INTEGER,
  game_id     UUID REFERENCES games(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Notifications ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(30),
  title       TEXT,
  body        TEXT,
  read        BOOLEAN DEFAULT FALSE,
  data        JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_users ON games(white_id, black_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_active_white ON games(white_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_games_active_black ON games(black_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_games_status_ended_at ON games(status, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_elo_history_user ON elo_history(user_id, created_at DESC);

-- ── Enable Row Level Security ────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Public read for leaderboard
CREATE POLICY "Public read users" ON users FOR SELECT USING (true);
CREATE POLICY "Users manage own wallet" ON wallets FOR ALL USING (auth.uid()::text = user_id::text);
CREATE POLICY "Users view own transactions" ON transactions FOR SELECT USING (auth.uid()::text = user_id::text);

-- ── Wallet RPC Functions ──────────────────────────────────────
-- These are called by the backend service key (bypasses RLS)

CREATE OR REPLACE FUNCTION credit_wallet(p_user_id UUID, p_amount BIGINT)
RETURNS wallets AS $$
DECLARE
  updated_wallet wallets;
BEGIN
  UPDATE wallets
  SET balance = balance + p_amount, updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING * INTO updated_wallet;
  RETURN updated_wallet;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION debit_wallet(p_user_id UUID, p_amount BIGINT)
RETURNS wallets AS $$
DECLARE
  updated_wallet wallets;
BEGIN
  IF (SELECT balance FROM wallets WHERE user_id = p_user_id) < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;
  UPDATE wallets
  SET balance = balance - p_amount, updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING * INTO updated_wallet;
  RETURN updated_wallet;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION lock_wallet_funds(p_user_id UUID, p_amount BIGINT)
RETURNS void AS $$
BEGIN
  IF (SELECT balance - locked FROM wallets WHERE user_id = p_user_id) < p_amount THEN
    RAISE EXCEPTION 'Insufficient available balance';
  END IF;
  UPDATE wallets
  SET balance = balance - p_amount, locked = locked + p_amount, updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION unlock_wallet_funds(p_user_id UUID, p_amount BIGINT)
RETURNS void AS $$
DECLARE
  unlock_amt BIGINT;
BEGIN
  SELECT LEAST(COALESCE(locked, 0), GREATEST(p_amount, 0))
    INTO unlock_amt
  FROM wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF unlock_amt IS NULL OR unlock_amt <= 0 THEN
    RETURN;
  END IF;

  UPDATE wallets
  SET balance = balance + unlock_amt, locked = locked - unlock_amt, updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Atomic Game Payout Function (v3)
-- Settles stakes for a finished game in a single DB transaction.
-- Prevents partial-payout state if app crashes mid-sequence.
--
-- Parameters:
--   p_winner_id  — UUID of winner (NULL for draw)
--   p_loser_id   — UUID of loser  (NULL for draw)
--   p_white_id   — UUID of white player
--   p_black_id   — UUID of black player
--   p_stakes     — stakes amount each player had locked
--   p_fee        — platform fee to deduct from winner's payout
--
-- All 4 wallet ops (unlock x2, debit, credit) run atomically.
-- ============================================================
CREATE OR REPLACE FUNCTION settle_game_payout(
  p_winner_id UUID,
  p_loser_id  UUID,
  p_white_id  UUID,
  p_black_id  UUID,
  p_stakes    BIGINT,
  p_fee       BIGINT
) RETURNS void AS $$
BEGIN
  IF p_stakes <= 0 THEN
    RETURN;
  END IF;

  -- Step 1: Unlock both players' locked stakes
  UPDATE wallets
  SET
    balance = balance + LEAST(locked, p_stakes),
    locked = GREATEST(0, locked - p_stakes),
    updated_at = NOW()
    WHERE user_id = p_white_id;
  UPDATE wallets
  SET
    balance = balance + LEAST(locked, p_stakes),
    locked = GREATEST(0, locked - p_stakes),
    updated_at = NOW()
    WHERE user_id = p_black_id;

  -- Step 2: If not a draw, transfer stakes from loser to winner minus fee
  IF p_winner_id IS NOT NULL AND p_loser_id IS NOT NULL THEN
    -- Debit loser
    IF (SELECT balance FROM wallets WHERE user_id = p_loser_id) < p_stakes THEN
      RAISE EXCEPTION 'Loser has insufficient balance for payout (user: %)', p_loser_id;
    END IF;
    UPDATE wallets SET balance = balance - p_stakes, updated_at = NOW()
      WHERE user_id = p_loser_id;

    -- Credit winner (stakes - fee)
    UPDATE wallets SET balance = balance + (p_stakes - p_fee), updated_at = NOW()
      WHERE user_id = p_winner_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Anti-Cheat Migration (v2)
-- Jalankan setelah schema awal jika sudah punya data.
-- Kalau fresh install, ini berjalan otomatis bersamaan.
-- ============================================================

-- ── Trust Score & Flagging di tabel users ────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS trust_score   INTEGER DEFAULT 100;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flagged        BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flagged_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flagged_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_flagged ON users(flagged) WHERE flagged = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_trust   ON users(trust_score);

-- ── Move Audit Log ────────────────────────────────────────────
-- Setiap move yang diterima server dicatat di sini (immutable)
CREATE TABLE IF NOT EXISTS move_audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id       UUID REFERENCES games(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  move_seq      INTEGER NOT NULL,
  san           TEXT,
  from_sq       TEXT,
  to_sq         TEXT,
  fen_after     TEXT,
  time_taken_ms INTEGER,
  time_left     INTEGER,
  server_ts     BIGINT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_game    ON move_audit_log(game_id);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON move_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_seq     ON move_audit_log(game_id, move_seq);
CREATE INDEX IF NOT EXISTS idx_audit_created ON move_audit_log(created_at DESC);

-- ── Anti-Cheat Actions Log ────────────────────────────────────
CREATE TABLE IF NOT EXISTS anticheat_actions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  game_id    UUID REFERENCES games(id) ON DELETE SET NULL,
  action     VARCHAR(20) NOT NULL,
  reason     TEXT,
  flags      TEXT,
  score      INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anticheat_user   ON anticheat_actions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anticheat_action ON anticheat_actions(action);

-- RLS: hanya service key backend yang bisa akses tabel audit
ALTER TABLE move_audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE anticheat_actions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Anti-Cheat Migration (v3) — Fingerprinting & Collusion
-- ============================================================

-- ── Device Fingerprints ───────────────────────────────────────
-- Menyimpan hash IP + User-Agent per user (privacy-safe, no raw IP)
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  fingerprint_hash TEXT NOT NULL,  -- sha256(ip|ua)
  ip_hash          TEXT NOT NULL,  -- sha256(ip)
  ua_hash          TEXT NOT NULL,  -- sha256(user-agent)
  game_id          UUID REFERENCES games(id) ON DELETE SET NULL,
  seen_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, fingerprint_hash)
);

CREATE INDEX IF NOT EXISTS idx_fp_fingerprint ON device_fingerprints(fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_fp_user        ON device_fingerprints(user_id);
CREATE INDEX IF NOT EXISTS idx_fp_seen        ON device_fingerprints(seen_at DESC);

ALTER TABLE device_fingerprints ENABLE ROW LEVEL SECURITY;

-- ── Multi-Account Flags ───────────────────────────────────────
-- Dicatat ketika dua user berbagi fingerprint yang sama
CREATE TABLE IF NOT EXISTS multi_account_flags (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id_a        UUID REFERENCES users(id) ON DELETE CASCADE,
  user_id_b        UUID REFERENCES users(id) ON DELETE CASCADE,
  fingerprint_hash TEXT NOT NULL,
  detected_at      TIMESTAMPTZ DEFAULT NOW(),
  reviewed         BOOLEAN DEFAULT FALSE,
  review_note      TEXT,
  UNIQUE (user_id_a, user_id_b, fingerprint_hash)
);

CREATE INDEX IF NOT EXISTS idx_maf_user_a    ON multi_account_flags(user_id_a);
CREATE INDEX IF NOT EXISTS idx_maf_user_b    ON multi_account_flags(user_id_b);
CREATE INDEX IF NOT EXISTS idx_maf_reviewed  ON multi_account_flags(reviewed) WHERE reviewed = FALSE;

ALTER TABLE multi_account_flags ENABLE ROW LEVEL SECURITY;

-- ── Collusion Flags ───────────────────────────────────────────
-- Dicatat ketika pola kolusi antara dua pemain terdeteksi
CREATE TABLE IF NOT EXISTS collusion_flags (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id       UUID REFERENCES games(id) ON DELETE SET NULL,
  user_id_a     UUID REFERENCES users(id) ON DELETE CASCADE,
  user_id_b     UUID REFERENCES users(id) ON DELETE CASCADE,
  pair_flags    TEXT,   -- JSON array of pair-level flags
  gift_flags    TEXT,   -- JSON array of material-gifting flags
  pair_score    INTEGER DEFAULT 0,
  pair_stats    TEXT,   -- JSON: { gameCount, aWins, bWins, draws }
  detected_at   TIMESTAMPTZ DEFAULT NOW(),
  reviewed      BOOLEAN DEFAULT FALSE,
  review_note   TEXT
);

CREATE INDEX IF NOT EXISTS idx_cf_user_a   ON collusion_flags(user_id_a);
CREATE INDEX IF NOT EXISTS idx_cf_user_b   ON collusion_flags(user_id_b);
CREATE INDEX IF NOT EXISTS idx_cf_reviewed ON collusion_flags(reviewed) WHERE reviewed = FALSE;
CREATE INDEX IF NOT EXISTS idx_cf_detected ON collusion_flags(detected_at DESC);

ALTER TABLE collusion_flags ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Anti-Cheat Migration (v4) — Admin Review, Appeals, Security Events
-- ============================================================

-- ── is_admin flag di users ────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin) WHERE is_admin = TRUE;

-- ── Appeals ───────────────────────────────────────────────────
-- User bisa submit banding atas flag/suspend yang mereka terima
CREATE TABLE IF NOT EXISTS appeals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,
  evidence        TEXT,
  status          VARCHAR(20) DEFAULT 'pending',  -- pending | approved | rejected
  flag_reason_at  TEXT,   -- snapshot flagged_reason saat appeal dibuat
  trust_at        INTEGER,  -- snapshot trust_score saat appeal dibuat
  admin_note      TEXT,
  reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appeals_user   ON appeals(user_id);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status);
CREATE INDEX IF NOT EXISTS idx_appeals_created ON appeals(created_at DESC);

ALTER TABLE appeals ENABLE ROW LEVEL SECURITY;

-- User hanya bisa lihat appeal milik sendiri
CREATE POLICY "users_view_own_appeals" ON appeals
  FOR SELECT USING (auth.uid() = user_id);

-- ── Security Events ───────────────────────────────────────────
-- Log tindakan keamanan penting dari socket layer
CREATE TABLE IF NOT EXISTS security_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type  VARCHAR(60) NOT NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  details     TEXT,   -- JSON string
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_type    ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sec_user    ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_sec_created ON security_events(created_at DESC);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

-- ── Per-time-control ELO columns (migration) ─────────────────
-- Run this migration to add per-TC ELO tracking.
-- Existing users default to 1200 (standard starting ELO).
-- These columns are updated alongside the main `elo` column
-- after each game, scoped by time control type.
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo_bullet INTEGER DEFAULT 1200;
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo_blitz  INTEGER DEFAULT 1200;
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo_rapid  INTEGER DEFAULT 1200;

-- Index for fast leaderboard queries per time control
CREATE INDEX IF NOT EXISTS idx_users_elo_bullet ON users(elo_bullet DESC);
CREATE INDEX IF NOT EXISTS idx_users_elo_blitz  ON users(elo_blitz  DESC);
CREATE INDEX IF NOT EXISTS idx_users_elo_rapid  ON users(elo_rapid  DESC);

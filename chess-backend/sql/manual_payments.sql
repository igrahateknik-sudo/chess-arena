-- ============================================================
-- Manual Payment Tables
-- Run this in Supabase SQL Editor
-- ============================================================

-- Manual Deposits (transfer bank → admin approves → wallet credited)
CREATE TABLE IF NOT EXISTS manual_deposits (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          INTEGER     NOT NULL CHECK (amount > 0),
  unique_code     SMALLINT    NOT NULL,            -- 3-digit suffix (001–999)
  transfer_amount INTEGER     NOT NULL,            -- amount + unique_code (displayed to user)
  proof_url       TEXT,                            -- Supabase Storage URL for bukti transfer
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note      TEXT,
  reviewed_by     UUID        REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Manual Withdrawals (user requests → admin approves → manual bank transfer)
CREATE TABLE IF NOT EXISTS manual_withdrawals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          INTEGER     NOT NULL CHECK (amount > 0),
  bank_name       TEXT        NOT NULL,
  account_number  TEXT        NOT NULL,
  account_name    TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'completed', 'rejected')),
  admin_note      TEXT,
  reviewed_by     UUID        REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_manual_deposits_user_id  ON manual_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_manual_deposits_status   ON manual_deposits(status);
CREATE INDEX IF NOT EXISTS idx_manual_withdrawals_user_id ON manual_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_manual_withdrawals_status  ON manual_withdrawals(status);

-- Updated_at trigger helper (reuse if already exists)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_manual_deposits_updated_at
  BEFORE UPDATE ON manual_deposits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_manual_withdrawals_updated_at
  BEFORE UPDATE ON manual_withdrawals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Supabase Storage bucket for deposit proofs
-- Run this separately or via Supabase dashboard:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('deposit-proofs', 'deposit-proofs', false)
-- ON CONFLICT DO NOTHING;

/**
 * Migration: Create tournament_pairings table and add missing columns.
 *
 * Run with:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/migrate_tournament_pairings.js
 *
 * Or set env vars in .env.local and run:
 *   node -r dotenv/config scripts/migrate_tournament_pairings.js dotenv_config_path=.env.local
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const STEPS = [
  // 1. tournament_pairings table
  `CREATE TABLE IF NOT EXISTS tournament_pairings (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id  UUID REFERENCES tournaments(id) ON DELETE CASCADE,
    round          INTEGER NOT NULL,
    board_number   INTEGER NOT NULL,
    white_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    black_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    game_id        UUID REFERENCES games(id) ON DELETE SET NULL,
    result         VARCHAR(20),
    created_at     TIMESTAMPTZ DEFAULT NOW()
  )`,

  // 2. Index on tournament + round
  `CREATE INDEX IF NOT EXISTS idx_tournament_pairings_t ON tournament_pairings(tournament_id, round)`,

  // 3. Index on game_id
  `CREATE INDEX IF NOT EXISTS idx_tournament_pairings_g ON tournament_pairings(game_id)`,

  // 4. wins column on tournament_registrations
  `ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0`,

  // 5. losses column
  `ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0`,

  // 6. draws column
  `ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS draws INTEGER DEFAULT 0`,

  // 7. current_round on tournaments
  `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS current_round INTEGER DEFAULT 0`,
];

async function runMigration() {
  console.log('Running tournament_pairings migration...\n');

  for (const [i, sql] of STEPS.entries()) {
    const stepName = sql.trim().split('\n')[0].slice(0, 70);
    try {
      const { error } = await supabase.rpc('exec_sql', { sql });
      if (error) {
        // exec_sql doesn't exist — fall back to direct table operation check
        console.log(`  Step ${i + 1}: ⚠  exec_sql not available. Run migration manually in Supabase Dashboard.`);
        console.log(`  SQL: ${stepName}...\n`);
      } else {
        console.log(`  Step ${i + 1}: ✓  ${stepName}`);
      }
    } catch (e) {
      console.error(`  Step ${i + 1}: ✗  ${e.message}`);
    }
  }

  // Verify
  const { error } = await supabase.from('tournament_pairings').select('id').limit(1);
  if (error && error.code === 'PGRST205') {
    console.log('\n⚠  tournament_pairings table does NOT exist yet.');
    console.log('Please run the SQL from chess-backend/sql/tournament_pairings.sql');
    console.log('in the Supabase Dashboard → SQL Editor.\n');
  } else {
    console.log('\n✓  tournament_pairings table is ready.\n');
  }
}

runMigration().catch(console.error);

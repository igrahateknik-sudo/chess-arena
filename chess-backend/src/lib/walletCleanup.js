/**
 * Wallet Lock Cleanup
 *
 * Problem: If a user disconnects from the matchmaking queue after their stake
 * was locked, the funds remain locked indefinitely.
 *
 * Solution:
 *   1. At queue join, lock funds (existing behavior)
 *   2. At queue leave / disconnect, the matchmaking handler calls unlockForUser()
 *      to release locked funds immediately (within the process)
 *   3. A periodic cron job checks for games that never started (status = 'active'
 *      but no moves made) older than LOCK_TIMEOUT_MS and unlocks the funds.
 *
 * Usage:
 *   const { startWalletCleanupJob, unlockForUser } = require('./walletCleanup');
 *   startWalletCleanupJob(io);  // call once at server start
 */

const { supabase, wallets, games } = require('./db');

const LOCK_TIMEOUT_MS  = 60 * 1000;        // 60 seconds — funds unlock if game never starts
const CLEANUP_INTERVAL = 30 * 1000;        // Run cleanup check every 30 seconds
const GAME_ABANDONED_MS = 5 * 60 * 1000;   // Game with 0 moves after 5 min = abandoned

// Track per-user locked stakes (userId → { amount, lockedAt })
// This is the in-memory source of truth for queue-locked funds.
const lockedStakes = new Map();
const unlockRetryCounts = new Map();

/**
 * Record that a stake was locked for a user joining the queue.
 * Called by matchmaking.js after wallets.lock() succeeds.
 */
function recordLock(userId, amount) {
  lockedStakes.set(userId, { amount, lockedAt: Date.now() });
}

/**
 * Immediately unlock funds for a user leaving the queue or on disconnect.
 * Called by matchmaking.js when user leaves queue before a game is found.
 *
 * @param {string} userId
 * @param {number} amount - amount that was locked (0 = no-op)
 */
async function unlockForUser(userId, amount) {
  if (!amount || amount <= 0) return;
  try {
    await wallets.unlock(userId, amount);
    lockedStakes.delete(userId);
    console.log(`[WalletCleanup] Unlocked ${amount} for user ${userId}`);
  } catch (err) {
    const retries = (unlockRetryCounts.get(userId) || 0) + 1;
    unlockRetryCounts.set(userId, retries);
    console.error(`[WalletCleanup] Failed to unlock for ${userId}:`, err.message);
    console.warn(`[WalletCleanup] unlock_retry user=${userId} retries=${retries}`);
  }
}

/**
 * Scan for timed-out queue locks and unlock them.
 * Fires every CLEANUP_INTERVAL milliseconds.
 */
async function runCleanup() {
  const now = Date.now();

  // 1. In-memory lock timeout: users who locked funds but never got paired
  for (const [userId, { amount, lockedAt }] of lockedStakes.entries()) {
    if (now - lockedAt > LOCK_TIMEOUT_MS) {
      console.warn(`[WalletCleanup] Timeout unlock for user ${userId} — stake ${amount} locked for ${Math.round((now - lockedAt) / 1000)}s`);
      await unlockForUser(userId, amount);
    }
  }

  // 2. DB scan: games that were created but have 0 moves and are older than GAME_ABANDONED_MS.
  //    This covers cases where both players joined the game room but no moves were made
  //    (e.g. both disconnected immediately) and stakes are still locked.
  try {
    const cutoff = new Date(now - GAME_ABANDONED_MS).toISOString();

    const { data: stuckGames, error } = await supabase
      .from('games')
      .select('id, white_id, black_id, stakes, created_at, move_history')
      .eq('status', 'active')
      .gt('stakes', 0)
      .lt('created_at', cutoff);

    if (error) {
      console.error('[WalletCleanup] DB query error:', error.message);
      return;
    }

    for (const game of (stuckGames || [])) {
      const moveCount = Array.isArray(game.move_history) ? game.move_history.length : 0;
      if (moveCount > 0) continue; // Game has moves — not stuck

      const ageMin = Math.round((now - new Date(game.created_at).getTime()) / 60000);
      console.warn(
        `[WalletCleanup] Abandoned game ${game.id} — ${ageMin}min old, 0 moves, stakes=${game.stakes}. Unlocking both players.`
      );

      // Claim game first so only one worker/process can settle this abandoned game.
      const claimed = await games.updateIfStatus(game.id, 'active', {
        status: 'aborting',
        end_reason: 'never_started',
        updated_at: new Date(),
      }).catch(() => null);
      if (!claimed) continue;

      // Unlock both players' locked stakes
      await Promise.allSettled([
        wallets.unlock(game.white_id, game.stakes),
        wallets.unlock(game.black_id, game.stakes),
      ]);

      // Mark game as aborted so it doesn't appear as active
      await games.update(game.id, {
        status: 'aborted',
        end_reason: 'never_started',
        ended_at: new Date(),
      });

      console.log(`[WalletCleanup] ✅ Aborted game ${game.id} and unlocked stakes for both players`);
    }
  } catch (err) {
    console.error('[WalletCleanup] Cleanup scan error:', err.message);
  }
}

/**
 * Start the periodic cleanup job.
 * Call once at server startup.
 */
function startWalletCleanupJob() {
  console.log(`[WalletCleanup] Starting cleanup job (interval: ${CLEANUP_INTERVAL / 1000}s, lock timeout: ${LOCK_TIMEOUT_MS / 1000}s)`);
  setInterval(runCleanup, CLEANUP_INTERVAL);
  // Run immediately on startup to catch any leftovers from previous process
  setTimeout(runCleanup, 5000);
}

module.exports = { startWalletCleanupJob, unlockForUser, recordLock };

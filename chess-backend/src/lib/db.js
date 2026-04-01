const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key bypasses RLS
);

// ── Users ─────────────────────────────────────────────────────────────────
const users = {
  async create({ username, email, passwordHash, verifyToken }) {
    const avatarUrl = `https://api.dicebear.com/9.x/avataaars/svg?seed=${username}`;
    const { data, error } = await supabase
      .from('users')
      .insert({
        username,
        email,
        password_hash: passwordHash,
        avatar_url: avatarUrl,
        verify_token: verifyToken || null,
        verified: !verifyToken, // guests have no token → auto-verified
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async findByEmail(email) {
    const { data } = await supabase.from('users').select('*').eq('email', email).single();
    return data;
  },

  async findByUsername(username) {
    const { data } = await supabase.from('users').select('*').ilike('username', username).single();
    return data;
  },

  async findByVerifyToken(token) {
    const hashed = hashToken(token);
    const { data } = await supabase
      .from('users').select('*').eq('verify_token', hashed).single();
    return data;
  },

  async findByResetToken(token) {
    const hashed = hashToken(token);
    const { data } = await supabase
      .from('users').select('*').eq('reset_token', hashed).single();
    return data;
  },

  async findById(id) {
    const { data } = await supabase.from('users').select('*').eq('id', id).single();
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('users').update({ ...updates, updated_at: new Date() }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async setOnline(id, socketId) {
    await supabase.from('users').update({ online: true, socket_id: socketId }).eq('id', id);
  },

  async setOffline(id) {
    await supabase.from('users').update({ online: false, socket_id: null }).eq('id', id);
  },

  async getLeaderboard(limit = 50, timeControl = 'global') {
    const sortCol = timeControl === 'bullet' ? 'elo_bullet'
      : timeControl === 'blitz'  ? 'elo_blitz'
      : timeControl === 'rapid'  ? 'elo_rapid'
      : 'elo'; // 'global' or unrecognized → sort by global ELO
    const { data } = await supabase
      .from('users')
      .select('id, username, elo, elo_bullet, elo_blitz, elo_rapid, title, country, avatar_url, wins, losses, draws, games_played')
      .order(sortCol, { ascending: false })
      .gt('games_played', 0)
      .limit(Math.min(limit, 100));
    return data || [];
  },

  public(user) {
    if (!user) return null;
    const { password_hash, verify_token, reset_token, ...pub } = user;
    return pub;
  },
};

// ── Wallets ───────────────────────────────────────────────────────────────
const wallets = {
  async get(userId) {
    const { data } = await supabase.from('wallets').select('*').eq('user_id', userId).single();
    return data;
  },

  async getBalance(userId) {
    const { data } = await supabase.from('wallets').select('balance, locked').eq('user_id', userId).single();
    return data || { balance: 0, locked: 0 };
  },

  async credit(userId, amount, client = supabase) {
    const { data, error } = await client.rpc('credit_wallet', { p_user_id: userId, p_amount: amount });
    if (error) throw error;
    return data;
  },

  async debit(userId, amount, client = supabase) {
    const { data, error } = await client.rpc('debit_wallet', { p_user_id: userId, p_amount: amount });
    if (error) throw error;
    return data;
  },

  async lock(userId, amount) {
    // Lock funds for a match (escrow)
    const { error } = await supabase.rpc('lock_wallet_funds', { p_user_id: userId, p_amount: amount });
    if (error) throw error;
  },

  async unlock(userId, amount) {
    const { error } = await supabase.rpc('unlock_wallet_funds', { p_user_id: userId, p_amount: amount });
    if (error) throw error;
  },

  /**
   * Atomic game payout — settle stakes in a single DB transaction.
   * Use instead of unlock/debit/credit sequence to prevent partial-payout state.
   *
   * @param {string|null} winnerId  - null for draw
   * @param {string|null} loserId   - null for draw
   * @param {string}      whiteId
   * @param {string}      blackId
   * @param {number}      stakes    - amount each player had locked
   * @param {number}      fee       - platform fee deducted from winner's gross payout
   */
  async settleGamePayout(winnerId, loserId, whiteId, blackId, stakes, fee) {
    const { error } = await supabase.rpc('settle_game_payout', {
      p_winner_id: winnerId || null,
      p_loser_id:  loserId  || null,
      p_white_id:  whiteId,
      p_black_id:  blackId,
      p_stakes:    stakes,
      p_fee:       fee,
    });
    if (error) throw error;
  },
};

// ── Transactions ──────────────────────────────────────────────────────────
const transactions = {
  async create(data) {
    const { data: tx, error } = await supabase.from('transactions').insert(data).select().single();
    if (error) throw error;
    return tx;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('transactions').update({ ...updates, updated_at: new Date() }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async findByOrderId(orderId) {
    const { data } = await supabase.from('transactions').select('*').eq('midtrans_order_id', orderId).single();
    return data;
  },

  async findByUserId(userId, limit = 30) {
    const { data } = await supabase
      .from('transactions').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  },
};

// ── Games ─────────────────────────────────────────────────────────────────
const games = {
  async create(data) {
    const { data: game, error } = await supabase.from('games').insert(data).select().single();
    if (error) throw error;
    return game;
  },

  async findById(id) {
    const { data } = await supabase.from('games').select('*').eq('id', id).single();
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase.from('games').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async findActiveByUser(userId) {
    const { data } = await supabase
      .from('games').select('*')
      .or(`white_id.eq.${userId},black_id.eq.${userId}`)
      .eq('status', 'active').single();
    return data;
  },

  async getHistory(userId, limit = 20) {
    const { data } = await supabase
      .from('games').select(`
        id, winner, end_reason, time_control, stakes,
        white_elo_before, black_elo_before, white_elo_after, black_elo_after,
        move_history, started_at, ended_at,
        white:white_id(id, username, elo, avatar_url, title),
        black:black_id(id, username, elo, avatar_url, title)
      `)
      .or(`white_id.eq.${userId},black_id.eq.${userId}`)
      .neq('status', 'active')
      .order('ended_at', { ascending: false })
      .limit(limit);
    return data || [];
  },
};

// ── Notifications ─────────────────────────────────────────────────────────
const notifications = {
  async create(userId, type, title, body, data = {}) {
    await supabase.from('notifications').insert({ user_id: userId, type, title, body, data });
  },

  async getUnread(userId) {
    const { data } = await supabase
      .from('notifications').select('*').eq('user_id', userId).eq('read', false)
      .order('created_at', { ascending: false }).limit(20);
    return data || [];
  },

  async markAllRead(userId) {
    await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
  },

  async markOneRead(notificationId, userId) {
    const { data, error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .eq('user_id', userId) // ownership check: user can only mark their own notifications
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// ── ELO History ───────────────────────────────────────────────────────────
const eloHistory = {
  async create(userId, eloBefore, eloAfter, gameId) {
    await supabase.from('elo_history').insert({
      user_id: userId,
      elo_before: eloBefore,
      elo_after: eloAfter,
      change: eloAfter - eloBefore,
      game_id: gameId,
    });
  },

  async getForUser(userId, limit = 30) {
    const { data } = await supabase
      .from('elo_history').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  },
};

// ── Manual Deposits ───────────────────────────────────────────────────────
const manualDeposits = {
  async create(userId, amount) {
    // Generate unique 3-digit code (001-999) not already pending for this user+amount
    const code = Math.floor(Math.random() * 999) + 1;
    const { data, error } = await supabase
      .from('manual_deposits')
      .insert({
        user_id: userId,
        amount,
        unique_code: code,
        transfer_amount: amount + code,
        status: 'pending',
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async setProof(id, userId, proofUrl) {
    const { data, error } = await supabase
      .from('manual_deposits')
      .update({ proof_url: proofUrl })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async findById(id) {
    const { data } = await supabase.from('manual_deposits').select('*, users:user_id(id, username, email)').eq('id', id).single();
    return data;
  },

  async findByUserId(userId, limit = 20) {
    const { data } = await supabase
      .from('manual_deposits').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  },

  async listPending(limit = 50) {
    const { data } = await supabase
      .from('manual_deposits')
      .select('*, users:user_id(id, username, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit);
    return data || [];
  },

  async listAll(status, limit = 50) {
    let query = supabase
      .from('manual_deposits')
      .select('*, users:user_id(id, username, email)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status && status !== 'all') query = query.eq('status', status);
    const { data } = await query;
    return data || [];
  },

  async approve(id, adminId) {
    const { data, error } = await supabase
      .from('manual_deposits')
      .update({ status: 'approved', reviewed_by: adminId, reviewed_at: new Date() })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async reject(id, adminId, note) {
    const { data, error } = await supabase
      .from('manual_deposits')
      .update({ status: 'rejected', reviewed_by: adminId, reviewed_at: new Date(), admin_note: note || '' })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// ── Manual Withdrawals ────────────────────────────────────────────────────
const manualWithdrawals = {
  async create(userId, amount, bankName, accountNumber, accountName) {
    const { data, error } = await supabase
      .from('manual_withdrawals')
      .insert({
        user_id: userId,
        amount,
        bank_name: bankName,
        account_number: accountNumber,
        account_name: accountName,
        status: 'pending',
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async findById(id) {
    const { data } = await supabase.from('manual_withdrawals').select('*, users:user_id(id, username, email)').eq('id', id).single();
    return data;
  },

  async findByUserId(userId, limit = 20) {
    const { data } = await supabase
      .from('manual_withdrawals').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  },

  async listAll(status, limit = 50) {
    let query = supabase
      .from('manual_withdrawals')
      .select('*, users:user_id(id, username, email)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status && status !== 'all') query = query.eq('status', status);
    const { data } = await query;
    return data || [];
  },

  async approve(id, adminId, note) {
    const { data, error } = await supabase
      .from('manual_withdrawals')
      .update({ status: 'approved', reviewed_by: adminId, reviewed_at: new Date(), admin_note: note || '' })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async complete(id, adminId, note) {
    const { data, error } = await supabase
      .from('manual_withdrawals')
      .update({ status: 'completed', reviewed_by: adminId, reviewed_at: new Date(), admin_note: note || '' })
      .eq('id', id)
      .eq('status', 'approved')
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async reject(id, adminId, note) {
    const { data, error } = await supabase
      .from('manual_withdrawals')
      .update({ status: 'rejected', reviewed_by: adminId, reviewed_at: new Date(), admin_note: note || '' })
      .eq('id', id)
      .in('status', ['pending', 'approved'])
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

module.exports = { supabase, users, wallets, transactions, games, notifications, eloHistory, manualDeposits, manualWithdrawals };

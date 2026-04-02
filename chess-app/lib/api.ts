const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function fetchAPI(path: string, options: RequestInit = {}, token?: string) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || 'Request failed', data.code);
  return data;
}

export { ApiError };

export const api = {
  auth: {
    register: (body: { username: string; email: string; password: string }) =>
      fetchAPI('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),

    login: (body: { email?: string; username?: string; password: string }) =>
      fetchAPI('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),

    guest: () =>
      fetchAPI('/api/auth/guest', { method: 'POST' }),

    me: (token: string) =>
      fetchAPI('/api/auth/me', {}, token),

    updateProfile: (token: string, body: { country?: string; avatar_url?: string }) =>
      fetchAPI('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(body) }, token),

    forgotPassword: (email: string) =>
      fetchAPI('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),

    resetPassword: (token: string, password: string) =>
      fetchAPI('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),

    verifyEmail: (token: string) =>
      fetchAPI('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),

    resendVerification: (email: string) =>
      fetchAPI('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),
  },

  wallet: {
    balance: (token: string) =>
      fetchAPI('/api/wallet/balance', {}, token),

    transactions: (token: string, limit = 30) =>
      fetchAPI(`/api/wallet/transactions?limit=${limit}`, {}, token),

    deposit: (token: string, amount: number) =>
      fetchAPI('/api/wallet/deposit', { method: 'POST', body: JSON.stringify({ amount }) }, token),

    withdraw: (token: string, body: { amount: number; bankCode: string; accountNumber: string; accountName: string }) =>
      fetchAPI('/api/wallet/withdraw', { method: 'POST', body: JSON.stringify(body) }, token),

    bankInfo: () =>
      fetchAPI('/api/wallet/bank-info'),

    manualDeposit: (token: string, amount: number) =>
      fetchAPI('/api/wallet/manual-deposit', { method: 'POST', body: JSON.stringify({ amount }) }, token),

    uploadDepositProof: async (token: string, depositId: string, file: File) => {
      const formData = new FormData();
      formData.append('proof', file);
      const res = await fetch(`${BACKEND_URL}/api/wallet/manual-deposit/${depositId}/proof`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new ApiError(data.error || 'Upload failed');
      return data;
    },

    myManualDeposits: (token: string) =>
      fetchAPI('/api/wallet/manual-deposits', {}, token),

    manualWithdraw: (token: string, body: { amount: number; bankName: string; accountNumber: string; accountName: string }) =>
      fetchAPI('/api/wallet/manual-withdraw', { method: 'POST', body: JSON.stringify(body) }, token),

    myManualWithdrawals: (token: string) =>
      fetchAPI('/api/wallet/manual-withdrawals', {}, token),
  },


  tournament: {
    list: (status?: string) =>
      fetchAPI(`/api/tournament${status ? `?status=${status}` : ''}`),

    upcomingHourly: () =>
      fetchAPI('/api/tournament/upcoming-hourly'),

    get: (id: string) =>
      fetchAPI(`/api/tournament/${id}`),

    register: (id: string, token: string) =>
      fetchAPI(`/api/tournament/${id}/register`, { method: 'POST' }, token),

    players: (id: string) =>
      fetchAPI(`/api/tournament/${id}/players`),

    create: (token: string, body: Record<string, unknown>) =>
      fetchAPI('/api/tournament', { method: 'POST', body: JSON.stringify(body) }, token),
  },

  leaderboard: {
    get: (limit = 50, timeControl?: 'global' | 'bullet' | 'blitz' | 'rapid') =>
      fetchAPI(`/api/leaderboard?limit=${limit}${timeControl ? `&timeControl=${timeControl}` : ''}`),
  },

  game: {
    get: (gameId: string, token: string) =>
      fetchAPI(`/api/game/${gameId}`, {}, token),

    history: (token: string, limit = 20) =>
      fetchAPI(`/api/game/history/me?limit=${limit}`, {}, token),

    eloHistory: (token: string) =>
      fetchAPI('/api/game/elo-history/me', {}, token),

    pgn: (gameId: string, token: string) =>
      fetchAPI(`/api/game/${gameId}/pgn`, {}, token),
  },

  notifications: {
    list: (token: string) =>
      fetchAPI('/api/notifications', {}, token),

    markRead: (token: string) =>
      fetchAPI('/api/notifications/read', { method: 'PATCH' }, token),
  },

  appeal: {
    submit: (token: string, body: { reason: string; evidence?: string }) =>
      fetchAPI('/api/appeal', { method: 'POST', body: JSON.stringify(body) }, token),

    mine: (token: string) =>
      fetchAPI('/api/appeal/mine', {}, token),
  },

  admin: {
    stats: (token: string) =>
      fetchAPI('/api/admin/stats', {}, token),

    flaggedUsers: (token: string, page = 1) =>
      fetchAPI(`/api/admin/flagged-users?page=${page}`, {}, token),

    reviewUser: (token: string, id: string, body: { action: string; note?: string; newTrust?: number }) =>
      fetchAPI(`/api/admin/users/${id}/review`, { method: 'POST', body: JSON.stringify(body) }, token),

    anticheatActions: (token: string, action?: string) =>
      fetchAPI(`/api/admin/anticheat-actions${action ? `?action=${action}` : ''}`, {}, token),

    collusionFlags: (token: string) =>
      fetchAPI('/api/admin/collusion-flags', {}, token),

    reviewCollusion: (token: string, id: string, body: { verdict: string; note?: string }) =>
      fetchAPI(`/api/admin/collusion-flags/${id}/review`, { method: 'POST', body: JSON.stringify(body) }, token),

    multiAccountFlags: (token: string) =>
      fetchAPI('/api/admin/multi-account-flags', {}, token),

    reviewMultiAccount: (token: string, id: string, body: { verdict: string; note?: string }) =>
      fetchAPI(`/api/admin/multi-account-flags/${id}/review`, { method: 'POST', body: JSON.stringify(body) }, token),

    appeals: (token: string, status = 'pending') =>
      fetchAPI(`/api/admin/appeals?status=${status}`, {}, token),

    reviewAppeal: (token: string, id: string, body: { verdict: string; note?: string; restoreTrust?: number }) =>
      fetchAPI(`/api/admin/appeals/${id}/review`, { method: 'POST', body: JSON.stringify(body) }, token),

    securityEvents: (token: string, type?: string) =>
      fetchAPI(`/api/admin/security-events${type ? `?type=${type}` : ''}`, {}, token),

    queueHealth: (token: string) =>
      fetchAPI('/api/admin/queue-health', {}, token),

    manualDeposits: (token: string, status = 'pending') =>
      fetchAPI(`/api/admin/manual-deposits?status=${status}`, {}, token),

    approveDeposit: (token: string, id: string) =>
      fetchAPI(`/api/admin/manual-deposits/${id}/approve`, { method: 'POST' }, token),

    rejectDeposit: (token: string, id: string, note?: string) =>
      fetchAPI(`/api/admin/manual-deposits/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) }, token),

    manualWithdrawals: (token: string, status = 'pending') =>
      fetchAPI(`/api/admin/manual-withdrawals?status=${status}`, {}, token),

    approveWithdrawal: (token: string, id: string, note?: string) =>
      fetchAPI(`/api/admin/manual-withdrawals/${id}/approve`, { method: 'POST', body: JSON.stringify({ note }) }, token),

    completeWithdrawal: (token: string, id: string, note?: string) =>
      fetchAPI(`/api/admin/manual-withdrawals/${id}/complete`, { method: 'POST', body: JSON.stringify({ note }) }, token),

    rejectWithdrawal: (token: string, id: string, note?: string) =>
      fetchAPI(`/api/admin/manual-withdrawals/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) }, token),
  },

  health: () =>
    fetchAPI('/health'),
};

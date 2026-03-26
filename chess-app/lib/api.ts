const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

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
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

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
  },


  tournament: {
    list: (status?: string) =>
      fetchAPI(`/api/tournament${status ? `?status=${status}` : ''}`),

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
  },

  health: () =>
    fetchAPI('/health'),
};

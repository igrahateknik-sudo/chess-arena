'use client';

/**
 * useRealtime — hook yang mengelola semua koneksi socket real-time:
 * - lobby:online  → update jumlah pemain online + game aktif
 * - wallet:update → update saldo wallet user di store
 * - user:stats    → update ELO, wins, losses, draws user setelah game selesai
 * - notification:new → update daftar notifikasi server
 *
 * Juga melakukan refresh user profile setiap 30 detik via REST API.
 */

import { useEffect, useRef } from 'react';
import { getSocket } from './socket';
import { useAppStore } from './store';
import { api } from './api';

export function useRealtime() {
  const { token, user, updateUser, setLobbyStats, setServerNotifications } = useAppStore();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!token || !user) return;

    const socket = getSocket(token);

    // ── Jumlah pemain online + game aktif ─────────────────────────────────
    const onLobbyOnline = ({ count, activeGames }: { count: number; activeGames: number }) => {
      setLobbyStats(count, activeGames ?? 0);
    };

    // ── Saldo wallet berubah (setelah game selesai/deposit/withdraw) ──────
    const onWalletUpdate = ({ balance }: { balance: number }) => {
      updateUser({ balance });
    };

    // ── Stats user berubah (ELO, W/L/D) setelah game selesai ─────────────
    const onUserStats = ({
      elo, wins, losses, draws,
    }: { elo: number; wins: number; losses: number; draws: number }) => {
      updateUser({ elo, wins, losses, draws });
    };

    // ── Notifikasi baru dari server ───────────────────────────────────────
    const onNotifNew = ({ notifications }: { notifications: import('@/types').ServerNotification[] }) => {
      setServerNotifications(notifications);
    };

    socket.on('lobby:online', onLobbyOnline);
    socket.on('wallet:update', onWalletUpdate);
    socket.on('user:stats', onUserStats);
    socket.on('notification:new', onNotifNew);

    // ── Fetch notifikasi awal dari REST API ───────────────────────────────
    api.notifications.list(token)
      .then((data) => setServerNotifications(data.notifications || []))
      .catch(() => {});

    // ── Refresh user profile (ELO, stats, balance) tiap 30 detik ─────────
    const refreshProfile = () => {
      api.auth.me(token)
        .then((data) => {
          if (!data.user) return;
          updateUser({
            elo: data.user.elo,
            wins: data.user.wins,
            losses: data.user.losses,
            draws: data.user.draws,
          });
        })
        .catch(() => {});

      api.wallet.balance(token)
        .then((data) => {
          if (typeof data.balance === 'number') {
            updateUser({ balance: data.balance });
          }
        })
        .catch(() => {});
    };

    intervalRef.current = setInterval(refreshProfile, 30_000);

    return () => {
      socket.off('lobby:online', onLobbyOnline);
      socket.off('wallet:update', onWalletUpdate);
      socket.off('user:stats', onUserStats);
      socket.off('notification:new', onNotifNew);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [token, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Moon, Sun, Menu, Search, ChevronDown, Zap, DollarSign, Shield, Users } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';

function formatIDR(amount: number): string {
  if (amount >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}K`;
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins}m lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}j lalu`;
  return `${Math.floor(hours / 24)}h lalu`;
}

const NOTIF_ICONS: Record<string, string> = {
  game_result: '⚔️',
  tournament: '🏆',
  wallet: '💰',
  system: '📢',
};

interface TopbarProps {
  onMenuClick: () => void;
  title?: string;
}

export default function Topbar({ onMenuClick, title }: TopbarProps) {
  const {
    user, theme, toggleTheme, sidebarOpen, logout,
    serverNotifications, markServerNotificationsRead, setServerNotifications,
    onlineUsers, activeGames, token,
  } = useAppStore();

  const [showNotifs, setShowNotifs] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const unreadCount = serverNotifications.filter((n) => !n.read).length;

  const handleOpenNotifs = () => {
    setShowNotifs((v) => !v);
    setShowProfile(false);
  };

  const handleMarkRead = async () => {
    markServerNotificationsRead();
    if (token) {
      await api.notifications.markRead(token).catch(() => {});
      api.notifications.list(token)
        .then((data) => setServerNotifications(data.notifications || []))
        .catch(() => {});
    }
  };

  const handleLogout = () => {
    logout();
    window.location.href = '/';
  };

  return (
    <header className={`fixed top-0 right-0 z-20 h-16 bg-[var(--bg-card)]/90 backdrop-blur-xl border-b border-[var(--border)] flex items-center px-4 gap-3 transition-all duration-300
      ${sidebarOpen ? 'lg:left-60' : 'lg:left-[68px]'} left-0`}>

      {/* Mobile menu */}
      <button onClick={onMenuClick} className="lg:hidden w-9 h-9 rounded-xl flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
        <Menu className="w-5 h-5" />
      </button>

      {/* Search */}
      <div className="hidden sm:flex flex-1 max-w-sm items-center gap-2 bg-[var(--bg-hover)] rounded-xl px-3 py-2">
        <Search className="w-4 h-4 text-[var(--text-muted)]" />
        <input placeholder="Cari pemain, game..." className="bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-full" readOnly />
      </div>

      <div className="flex-1" />

      {/* Online users (real-time via socket lobby:online) */}
      {onlineUsers > 0 && (
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <Users className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs font-semibold text-emerald-400">{onlineUsers.toLocaleString()}</span>
          <span className="text-xs text-emerald-400/70">online</span>
          {activeGames > 0 && (
            <span className="text-xs text-emerald-400/60 ml-1">· {activeGames} game</span>
          )}
        </div>
      )}

      {/* Quick play */}
      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
        className="hidden sm:flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl text-sm font-semibold text-white shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity"
        onClick={() => window.location.href = '/game'}>
        <Zap className="w-4 h-4" />
        Quick Play
      </motion.button>

      {/* Balance (real-time via socket wallet:update atau refresh 30s) */}
      {user && (
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
          <DollarSign className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-emerald-400">{formatIDR(user.balance)}</span>
        </div>
      )}

      {/* Theme toggle */}
      <button onClick={toggleTheme}
        className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
        {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      {/* Notifications — real dari server DB, diupdate via socket notification:new */}
      <div className="relative">
        <button onClick={handleOpenNotifs}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors relative">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-[var(--bg-card)]" />
          )}
        </button>
        <AnimatePresence>
          {showNotifs && (
            <motion.div initial={{ opacity: 0, y: -10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="absolute right-0 top-12 w-80 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl z-50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <span className="font-semibold text-[var(--text-primary)]">
                  Notifikasi {unreadCount > 0 && <span className="text-sky-400">({unreadCount})</span>}
                </span>
                {unreadCount > 0 && (
                  <button onClick={handleMarkRead} className="text-xs text-sky-400 font-medium hover:text-sky-300">
                    Tandai dibaca
                  </button>
                )}
              </div>

              {serverNotifications.length === 0 ? (
                <div className="py-10 text-center text-[var(--text-muted)]">
                  <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Belum ada notifikasi</p>
                </div>
              ) : (
                serverNotifications.slice(0, 10).map((n) => (
                  <div key={n.id} className={`flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer ${!n.read ? 'bg-sky-500/5' : ''}`}>
                    <div className="w-9 h-9 rounded-xl bg-[var(--bg-hover)] flex items-center justify-center text-lg flex-shrink-0">
                      {NOTIF_ICONS[n.type] || '🔔'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-[var(--text-primary)]">{n.title}</span>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-sky-400 flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{n.body}</p>
                      <span className="text-xs text-[var(--text-muted)] mt-1 block">{timeAgo(n.created_at)}</span>
                    </div>
                  </div>
                ))
              )}

              <div className="p-3 border-t border-[var(--border)]">
                <button className="w-full text-center text-sm text-sky-400 hover:text-sky-300 font-medium transition-colors">
                  Lihat semua
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* User profile */}
      {user && (
        <div className="relative">
          <button onClick={() => { setShowProfile((v) => !v); setShowNotifs(false); }}
            className="flex items-center gap-2 hover:bg-[var(--bg-hover)] rounded-xl p-1.5 transition-colors">
            <div className="w-8 h-8 rounded-lg overflow-hidden bg-gradient-to-br from-sky-400 to-blue-600 flex-shrink-0">
              <img src={user.avatar || `https://api.dicebear.com/9.x/avataaars/svg?seed=${user.username}`} alt={user.username} className="w-full h-full object-cover" />
            </div>
            <div className="hidden md:block text-left">
              <div className="text-xs font-semibold text-[var(--text-primary)] leading-none">{user.username}</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">ELO {user.elo}</div>
            </div>
            <ChevronDown className="w-4 h-4 text-[var(--text-muted)] hidden md:block" />
          </button>
          <AnimatePresence>
            {showProfile && (
              <motion.div initial={{ opacity: 0, y: -10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="absolute right-0 top-12 w-56 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl z-50 overflow-hidden">
                <div className="p-4 border-b border-[var(--border)]">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl overflow-hidden">
                      <img src={user.avatar || `https://api.dicebear.com/9.x/avataaars/svg?seed=${user.username}`} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        {user.title && <span className="text-xs font-bold text-yellow-400">{user.title}</span>}
                        <span className="font-semibold text-[var(--text-primary)] text-sm">{user.username}</span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">{user.email}</div>
                      {user.verified && (
                        <div className="flex items-center gap-1 mt-1">
                          <Shield className="w-3 h-3 text-sky-400" />
                          <span className="text-xs text-sky-400">Verified</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {[
                  { label: 'Profil', href: '/profile' },
                  { label: 'Game Saya', href: '/games' },
                  { label: 'Pengaturan', href: '/settings' },
                ].map((item) => (
                  <a key={item.label} href={item.href}
                    className="block px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
                    {item.label}
                  </a>
                ))}
                <div className="border-t border-[var(--border)]">
                  <button onClick={handleLogout} className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                    Keluar
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </header>
  );
}

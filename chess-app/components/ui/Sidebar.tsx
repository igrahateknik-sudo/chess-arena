'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Swords, Wallet, Trophy, Users,
  BarChart2, Settings, Crown, ChevronLeft, Bell,
  LogOut, X, AlertTriangle, Shield
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import Image from 'next/image';

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/game', icon: Swords, label: 'Play', badge: 'LIVE' },
  { href: '/tournament', icon: Trophy, label: 'Tournaments' },
  { href: '/leaderboard', icon: Users, label: 'Leaderboard' },
  { href: '/wallet', icon: Wallet, label: 'Wallet' },
  { href: '/stats', icon: BarChart2, label: 'Statistics' },
];

function formatIDR(amount: number): string {
  if (amount >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}K`;
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, sidebarOpen, setSidebarOpen, theme } = useAppStore();

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-5 ${!sidebarOpen && 'justify-center'}`}>
        <div className="w-9 h-9 flex-shrink-0 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
          <span className="text-xl">♔</span>
        </div>
        <AnimatePresence>
          {sidebarOpen && (
            <motion.span initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }}
              className="text-lg font-bold whitespace-nowrap overflow-hidden text-[var(--text-primary)]">
              Chess<span className="text-sky-400">Arena</span>
            </motion.span>
          )}
        </AnimatePresence>
        {sidebarOpen && (
          <button onClick={() => setSidebarOpen(false)} className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors lg:flex hidden">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href}
              onClick={onMobileClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group relative
                ${active
                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/20'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                } ${!sidebarOpen ? 'justify-center' : ''}`}>
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-sky-400 rounded-r-full" />}
              <item.icon className={`w-5 h-5 flex-shrink-0 ${active ? 'text-sky-400' : ''}`} />
              <AnimatePresence>
                {sidebarOpen && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="font-medium text-sm whitespace-nowrap overflow-hidden">
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {sidebarOpen && item.badge && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="ml-auto text-xs font-bold px-1.5 py-0.5 rounded-md bg-red-500 text-white animate-pulse">
                  {item.badge}
                </motion.span>
              )}
              {!sidebarOpen && item.badge && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="border-t border-[var(--border)] mx-4 my-2" />

      {/* Bottom nav */}
      <div className="px-2 pb-2 space-y-1">
        {/* Appeal — tampil jika user di-flag */}
        {user?.flagged && (
          <Link href="/appeal" onClick={onMobileClose}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/20 transition-all ${!sidebarOpen ? 'justify-center' : ''}`}>
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm font-medium">Appeal</motion.span>}
          </Link>
        )}
        {/* Admin panel — tampil jika user is_admin */}
        {user?.is_admin && (
          <Link href="/admin" onClick={onMobileClose}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-red-400 hover:bg-red-500/10 transition-all ${!sidebarOpen ? 'justify-center' : ''}`}>
            <Shield className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm font-medium">Admin</motion.span>}
          </Link>
        )}
        <Link href="/settings" onClick={onMobileClose}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-all ${!sidebarOpen ? 'justify-center' : ''}`}>
          <Settings className="w-5 h-5 flex-shrink-0" />
          {sidebarOpen && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm font-medium">Settings</motion.span>}
        </Link>
      </div>

      {/* User profile */}
      {user && (
        <div className={`border-t border-[var(--border)] p-3 ${!sidebarOpen ? 'flex justify-center' : ''}`}>
          <div className={`flex items-center gap-3 p-2 rounded-xl hover:bg-[var(--bg-hover)] transition-colors cursor-pointer ${!sidebarOpen ? '' : ''}`}>
            <div className="relative flex-shrink-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center overflow-hidden">
                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[var(--bg-card)]" />
            </div>
            <AnimatePresence>
              {sidebarOpen && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {user.title && <span className="text-xs font-bold text-yellow-400 bg-yellow-400/10 px-1 rounded">{user.title}</span>}
                    <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{user.username}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)]">ELO {user.elo}</span>
                    <span className="text-xs font-medium text-emerald-400">{formatIDR(user.balance)}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex flex-col fixed left-0 top-0 h-full z-30 bg-[var(--bg-card)] border-r border-[var(--border)] transition-all duration-300 ${sidebarOpen ? 'w-60' : 'w-[68px]'}`}>
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)}
            className="absolute -right-3 top-[72px] w-6 h-6 bg-sky-500 rounded-full flex items-center justify-center shadow-lg z-10">
            <ChevronLeft className="w-3 h-3 text-white rotate-180" />
          </button>
        )}
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={onMobileClose} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed left-0 top-0 h-full w-64 z-50 bg-[var(--bg-card)] border-r border-[var(--border)] lg:hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-5 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center">
                    <span className="text-xl">♔</span>
                  </div>
                  <span className="text-lg font-bold text-[var(--text-primary)]">Chess<span className="text-sky-400">Arena</span></span>
                </div>
                <button onClick={onMobileClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <SidebarContent />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Search, Zap, Clock, Target, Globe } from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';

const SCOPE_TABS = ['Global', 'Country', 'Friends', 'Weekly'] as const;
type ScopeTab = (typeof SCOPE_TABS)[number];

type TimeControl = 'global' | 'bullet' | 'blitz' | 'rapid';

const TC_TABS: { label: string; value: TimeControl; icon: React.ElementType; color: string }[] = [
  { label: 'Overall',  value: 'global', icon: Globe,  color: 'text-amber-400' },
  { label: 'Bullet',   value: 'bullet', icon: Zap,    color: 'text-red-400' },
  { label: 'Blitz',    value: 'blitz',  icon: Target,  color: 'text-orange-400' },
  { label: 'Rapid',    value: 'rapid',  icon: Clock,   color: 'text-emerald-400' },
];

interface LeaderboardEntry {
  rank: number; id: string; username: string; avatar_url: string;
  elo: number; elo_bullet?: number; elo_blitz?: number; elo_rapid?: number;
  displayElo: number;
  title?: string; country: string;
  wins: number; losses: number; draws: number; games_played: number; winRate: number;
}

export default function LeaderboardPage() {
  const { user } = useAppStore();
  const [scopeTab, setScopeTab] = useState<ScopeTab>('Global');
  const [tc, setTc] = useState<TimeControl>('global');
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    api.leaderboard.get(100, tc)
      .then(data => setEntries(data.leaderboard || []))
      .catch(() => setLoadError('Gagal memuat leaderboard. Coba muat ulang.'))
      .finally(() => setLoading(false));
  }, [tc]);

  const filtered = entries.filter(e =>
    e.username.toLowerCase().includes(search.toLowerCase())
  );

  const myEntry = entries.find(e => e.id === user?.id);
  const top3 = entries.slice(0, 3);

  function getDisplayElo(entry: LeaderboardEntry) {
    if (tc === 'bullet') return entry.elo_bullet ?? entry.elo;
    if (tc === 'blitz')  return entry.elo_blitz  ?? entry.elo;
    if (tc === 'rapid')  return entry.elo_rapid  ?? entry.elo;
    return entry.elo;
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)] flex items-center gap-2">
              <Trophy className="w-7 h-7 text-yellow-400" />
              Papan Peringkat
            </h1>
            <p className="text-[var(--text-muted)] mt-1">Diperbarui tiap 15 menit</p>
          </div>
        </motion.div>
        {loadError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {loadError}
          </div>
        )}

        {/* Time control tabs */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}
          className="flex gap-2 flex-wrap">
          {TC_TABS.map(t => (
            <button key={t.value} onClick={() => setTc(t.value)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all border
                ${tc === t.value
                  ? 'bg-[var(--bg-card)] border-[var(--accent)] text-[var(--text-primary)] shadow-sm'
                  : 'bg-[var(--bg-hover)] border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
              <t.icon className={`w-4 h-4 ${tc === t.value ? t.color : ''}`} />
              {t.label}
            </button>
          ))}
        </motion.div>

        {/* Top 3 */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="grid grid-cols-3 gap-4">
          {loading ? (
            <div className="col-span-3 flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : [top3[1], top3[0], top3[2]].filter(Boolean).map((entry, i) => {
            if (!entry) return null;
            const actualRank = i === 0 ? 2 : i === 1 ? 1 : 3;
            const isFirst = actualRank === 1;
            return (
              <motion.div key={entry.id} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.07 }}
                className={`card rounded-2xl p-4 text-center relative overflow-hidden ${isFirst ? 'ring-2 ring-yellow-400/50' : ''}`}
                style={{ marginTop: isFirst ? 0 : '16px' }}>
                {isFirst && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-400" />
                )}
                <div className="text-3xl mb-1">{['🥈', '🥇', '🥉'][i]}</div>
                <div className={`w-16 h-16 rounded-2xl overflow-hidden mx-auto mb-3 ${isFirst ? 'ring-2 ring-yellow-400 shadow-lg shadow-yellow-400/20' : 'ring-1 ring-[var(--border)]'}`}>
                  <img src={entry.avatar_url || `https://api.dicebear.com/9.x/avataaars/svg?seed=${entry.username}`} alt={entry.username} className="w-full h-full object-cover" />
                </div>
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  {entry.title && <span className="text-xs font-bold text-yellow-400">{entry.title}</span>}
                  <span className="font-bold text-sm text-[var(--text-primary)] truncate max-w-[80px]">{entry.username}</span>
                </div>
                <div className="text-lg font-black text-[var(--text-primary)]">{getDisplayElo(entry)}</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">{entry.country}</div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Scope Tabs and search */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex p-1 bg-[var(--bg-hover)] rounded-xl gap-1">
            {SCOPE_TABS.map(t => (
              <button key={t} onClick={() => setScopeTab(t)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all
                  ${scopeTab === t ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-[var(--bg-hover)] rounded-xl px-3 py-2">
            <Search className="w-4 h-4 text-[var(--text-muted)]" />
            <input placeholder="Cari pemain..." value={search} onChange={e => setSearch(e.target.value)}
              className="bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-32" />
          </div>
        </motion.div>

        {/* Table */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[40px_1fr_90px_80px_80px] gap-4 px-5 py-3 border-b border-[var(--border)] text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
            <span>#</span>
            <span>Player</span>
            <span className="text-right">
              {tc === 'global' ? 'ELO' : `${tc.charAt(0).toUpperCase() + tc.slice(1)} ELO`}
            </span>
            <span className="text-right hidden sm:block">Games</span>
            <span className="text-right hidden md:block">Win%</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-10 text-[var(--text-muted)]">
                <Trophy className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Pemain tidak ditemukan</p>
              </div>
            ) : filtered.map((entry, i) => (
              <motion.div key={entry.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}
                className={`grid grid-cols-[40px_1fr_90px_80px_80px] gap-4 px-5 py-3.5 items-center hover:bg-[var(--bg-hover)] transition-colors cursor-pointer
                  ${entry.id === user?.id ? 'bg-amber-500/5' : ''}`}>
                <div className={`text-sm font-black text-center
                  ${entry.rank === 1 ? 'text-yellow-400' : entry.rank === 2 ? 'text-slate-300' : entry.rank === 3 ? 'text-amber-600' : 'text-[var(--text-muted)]'}`}>
                  {entry.rank <= 3 ? ['🥇','🥈','🥉'][entry.rank - 1] : entry.rank}
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 ${entry.id === user?.id ? 'ring-2 ring-amber-400' : ''}`}>
                    <img src={entry.avatar_url || `https://api.dicebear.com/9.x/avataaars/svg?seed=${entry.username}`} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {entry.title && <span className="text-xs font-bold text-yellow-400 bg-yellow-400/10 px-1.5 rounded hidden sm:block">{entry.title}</span>}
                      <span className={`font-semibold text-sm truncate ${entry.id === user?.id ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>
                        {entry.username}{entry.id === user?.id && ' (Kamu)'}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{entry.country}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-[var(--text-primary)] text-sm">{getDisplayElo(entry)}</div>
                  {tc !== 'global' && (
                    <div className="text-xs text-[var(--text-muted)]">Overall: {entry.elo}</div>
                  )}
                </div>
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{(entry.games_played || 0).toLocaleString()}</div>
                </div>
                <div className="text-right hidden md:block">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{entry.winRate}%</div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Your position sticky */}
        {myEntry && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="card border-amber-500/30 rounded-2xl p-4 bg-amber-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center text-sm font-bold text-amber-400">#{myEntry.rank}</div>
                <div className="w-9 h-9 rounded-xl overflow-hidden">
                  <img src={user?.avatar || `https://api.dicebear.com/9.x/avataaars/svg?seed=${user?.username}`} alt="" className="w-full h-full object-cover" />
                </div>
                <div>
                  <div className="font-semibold text-[var(--text-primary)] text-sm">Posisi Kamu</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {tc === 'global' ? `ELO ${user?.elo}` : `${tc.charAt(0).toUpperCase() + tc.slice(1)} ELO ${getDisplayElo(myEntry)}`}
                    {' • '}{myEntry.winRate}% WR
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </AppLayout>
  );
}

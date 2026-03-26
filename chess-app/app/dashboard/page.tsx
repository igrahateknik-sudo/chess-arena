'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import {
  TrendingUp, Swords, Trophy, DollarSign, Zap,
  Crown, Target, ChevronRight, Clock, Shield, Loader2, Globe
} from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';

const FADE = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };
const STAGGER = { show: { transition: { staggerChildren: 0.07 } } };

function formatIDR(n: number) {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}K`;
  return `Rp ${n.toLocaleString('id-ID')}`;
}

const RANK_COLORS: Record<string, string> = {
  Bronze: '#cd7f32', Silver: '#c0c0c0', Gold: '#ffd700',
  Platinum: '#a0b2c6', Diamond: '#4da6ff', Master: '#9b59b6', Grandmaster: '#e74c3c',
};

interface GameHistoryEntry {
  id: string; winner: string; end_reason: string;
  white: { username: string; elo: number; avatar_url: string };
  black: { username: string; elo: number; avatar_url: string };
  white_elo_before: number; black_elo_before: number;
  white_elo_after: number; black_elo_after: number;
  stakes: number; time_control: { initial: number; increment: number };
  ended_at: string;
}

interface EloPoint { date: string; elo: number }

interface LeaderboardEntry {
  rank: number; id: string; username: string; avatar_url: string;
  elo: number; title?: string; country: string;
  wins: number; losses: number; draws: number; winRate: number;
}

export default function DashboardPage() {
  const { user, token } = useAppStore();
  const [recentGames, setRecentGames] = useState<GameHistoryEntry[]>([]);
  const [eloChart, setEloChart] = useState<EloPoint[]>([]);
  const [todayEloChange, setTodayEloChange] = useState<number | null>(null);
  const [topPlayers, setTopPlayers] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loadingChart, setLoadingChart] = useState(true);
  const [loadingGames, setLoadingGames] = useState(true);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);

  useEffect(() => {
    if (!token || !user) return;

    // Riwayat game
    api.game.history(token, 10)
      .then((data) => setRecentGames(data.history || []))
      .catch(() => {})
      .finally(() => setLoadingGames(false));

    // Riwayat ELO + hitung perubahan hari ini
    api.game.eloHistory(token)
      .then((data) => {
        const history: Array<{ elo_after: number; change: number; created_at: string }> = data.history || [];
        if (!history.length) return;

        const today = new Date().toDateString();
        let todayChange = 0;

        const points: EloPoint[] = history
          .slice()
          .reverse()
          .map((h) => {
            if (new Date(h.created_at).toDateString() === today) {
              todayChange += h.change || 0;
            }
            return {
              date: new Date(h.created_at).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' }),
              elo: h.elo_after,
            };
          });

        setEloChart(points);
        setTodayEloChange(todayChange);
      })
      .catch(() => {})
      .finally(() => setLoadingChart(false));

    // Leaderboard top 5 + posisi user
    api.leaderboard.get(100)
      .then((data) => {
        const lb: LeaderboardEntry[] = data.leaderboard || [];
        setTopPlayers(lb.slice(0, 5));
        const pos = lb.findIndex((e) => e.id === user.id);
        if (pos !== -1) setMyRank(pos + 1);
      })
      .catch(() => {})
      .finally(() => setLoadingLeaderboard(false));
  }, [token, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return (
    <AppLayout>
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      </div>
    </AppLayout>
  );

  const totalGames = user.wins + user.losses + user.draws;
  const winRate = totalGames > 0 ? Math.round((user.wins / totalGames) * 100) : 0;
  const rankColor = RANK_COLORS[(user.rank ?? '').split(' ')[0]] || '#ffd700';

  const statCards = [
    {
      label: 'ELO Rating', value: user.elo.toString(), icon: TrendingUp,
      change: todayEloChange !== null ? (todayEloChange >= 0 ? `+${todayEloChange}` : `${todayEloChange}`) : null,
      positive: (todayEloChange ?? 0) >= 0, color: 'sky', desc: 'Standar FIDE',
    },
    {
      label: 'Win Rate', value: `${winRate}%`, icon: Target,
      change: totalGames > 0 ? `${totalGames} game` : null,
      positive: true, color: 'emerald', desc: `${user.wins}M ${user.losses}K ${user.draws}S`,
    },
    {
      label: 'Saldo', value: formatIDR(user.balance), icon: DollarSign,
      change: null, positive: true, color: 'yellow', desc: 'Tersedia',
    },
    {
      label: 'Peringkat', value: myRank ? `#${myRank}` : user.rank, icon: Crown,
      change: myRank ? 'Global' : null, positive: true, color: 'purple',
      desc: myRank ? `Top ${myRank} dunia` : 'Belum ada peringkat',
    },
  ];

  return (
    <AppLayout>
      <motion.div variants={STAGGER} initial="hidden" animate="show" className="space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <motion.div variants={FADE} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl overflow-hidden ring-2 ring-sky-400/50 shadow-lg shadow-sky-500/20">
                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg"
                style={{ background: `linear-gradient(135deg, ${rankColor}, ${rankColor}aa)` }}>
                {user.wins > 200 ? '♛' : '♟'}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                {user.title && (
                  <span className="text-xs font-bold text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-lg border border-yellow-400/20">
                    {user.title}
                  </span>
                )}
                {user.verified && <Shield className="w-4 h-4 text-sky-400" />}
              </div>
              <h1 className="text-2xl font-black text-[var(--text-primary)] mt-0.5">{user.username}</h1>
              <p className="text-sm text-[var(--text-muted)]">{user.rank} · {user.country}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Link href="/game"
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl font-semibold text-sm text-white shadow-lg shadow-blue-500/25 hover:opacity-90 transition-opacity">
              <Zap className="w-4 h-4" />
              Quick Play
            </Link>
            <Link href="/tournament"
              className="flex items-center gap-2 px-5 py-2.5 bg-[var(--bg-hover)] rounded-xl font-semibold text-sm text-[var(--text-primary)] hover:bg-[var(--border)] transition-colors border border-[var(--border)]">
              <Trophy className="w-4 h-4" />
              Turnamen
            </Link>
          </div>
        </motion.div>

        {/* Stat cards */}
        <motion.div variants={STAGGER} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <motion.div key={card.label} variants={FADE}
              className="card p-4 rounded-2xl hover:border-[var(--accent)] transition-all group cursor-default">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center
                  ${card.color === 'sky' ? 'bg-sky-500/10' : card.color === 'emerald' ? 'bg-emerald-500/10' : card.color === 'yellow' ? 'bg-yellow-500/10' : 'bg-purple-500/10'}`}>
                  <card.icon className={`w-5 h-5 ${card.color === 'sky' ? 'text-sky-400' : card.color === 'emerald' ? 'text-emerald-400' : card.color === 'yellow' ? 'text-yellow-400' : 'text-purple-400'}`} />
                </div>
                {card.change && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${card.positive ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`}>
                    {card.change}
                  </span>
                )}
              </div>
              <div className="text-2xl font-black text-[var(--text-primary)] mb-0.5">{card.value}</div>
              <div className="text-xs font-medium text-[var(--text-muted)]">{card.label}</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">{card.desc}</div>
            </motion.div>
          ))}
        </motion.div>

        {/* Main grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* ELO chart */}
          <motion.div variants={FADE} className="lg:col-span-2 card p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-[var(--text-primary)]">Performa ELO</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Riwayat rating Anda</p>
              </div>
              {todayEloChange !== null && (
                <div className={`flex items-center gap-2 text-sm font-semibold ${todayEloChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  <TrendingUp className="w-4 h-4" />
                  {todayEloChange >= 0 ? '+' : ''}{todayEloChange} hari ini
                </div>
              )}
            </div>
            {loadingChart ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
              </div>
            ) : eloChart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-[var(--text-muted)]">
                <TrendingUp className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">Belum ada data ELO</p>
                <p className="text-xs mt-1">Mainkan game pertama Anda!</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={eloChart} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eloGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                    itemStyle={{ color: '#38bdf8' }} />
                  <Area type="monotone" dataKey="elo" stroke="#38bdf8" strokeWidth={2.5} fill="url(#eloGrad)" dot={{ fill: '#38bdf8', r: 4 }} activeDot={{ r: 6 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* Win/Loss Ratio */}
          <motion.div variants={FADE} className="card p-5 rounded-2xl">
            <h3 className="font-bold text-[var(--text-primary)] mb-1">Rasio M/K/S</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">{totalGames} total game</p>
            {totalGames === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-[var(--text-muted)]">
                <Swords className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">Belum ada game</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-center mb-4">
                  <PieChart width={160} height={160}>
                    <Pie data={[
                      { name: 'Menang', value: user.wins },
                      { name: 'Kalah', value: user.losses },
                      { name: 'Seri', value: user.draws },
                    ]} cx={75} cy={75} innerRadius={50} outerRadius={70} paddingAngle={3} dataKey="value">
                      <Cell fill="#4ade80" />
                      <Cell fill="#f87171" />
                      <Cell fill="#94a3b8" />
                    </Pie>
                  </PieChart>
                </div>
                <div className="space-y-2">
                  {[
                    { label: 'Menang', value: user.wins, color: '#4ade80', pct: Math.round(user.wins / totalGames * 100) },
                    { label: 'Kalah', value: user.losses, color: '#f87171', pct: Math.round(user.losses / totalGames * 100) },
                    { label: 'Seri', value: user.draws, color: '#94a3b8', pct: Math.round(user.draws / totalGames * 100) },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                      <span className="text-sm text-[var(--text-secondary)] flex-1">{item.label}</span>
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{item.value}</span>
                      <span className="text-xs text-[var(--text-muted)] w-8 text-right">{item.pct}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </div>

        {/* Recent games + top players */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Recent games */}
          <motion.div variants={FADE} className="card rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="font-bold text-[var(--text-primary)]">Game Terakhir</h3>
              <Link href="/games" className="text-sm text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors">
                Lihat semua <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {loadingGames ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
                </div>
              ) : recentGames.length === 0 ? (
                <div className="text-center py-10 text-[var(--text-muted)]">
                  <Swords className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Belum ada game yang dimainkan</p>
                </div>
              ) : recentGames.map((game) => {
                const isWhite = game.white?.username === user.username;
                const opponent = isWhite ? game.black : game.white;
                const eloBefore = isWhite ? game.white_elo_before : game.black_elo_before;
                const eloAfter = isWhite ? game.white_elo_after : game.black_elo_after;
                const eloChange = (eloAfter || eloBefore || 0) - (eloBefore || 0);
                const result = game.winner === 'draw' ? 'draw'
                  : (game.winner === 'white') === isWhite ? 'win' : 'loss';
                return (
                  <div key={game.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold
                      ${result === 'win' ? 'bg-emerald-500/10 text-emerald-400' : result === 'loss' ? 'bg-red-500/10 text-red-400' : 'bg-slate-500/10 text-slate-400'}`}>
                      {result === 'win' ? 'M' : result === 'loss' ? 'K' : 'S'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-[var(--text-primary)]">vs {opponent?.username}</span>
                        <span className="text-xs text-[var(--text-muted)]">({opponent?.elo})</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Clock className="w-3 h-3 text-[var(--text-muted)]" />
                        <span className="text-xs text-[var(--text-muted)]">
                          {game.time_control?.initial ? `${Math.floor(game.time_control.initial / 60)}+${game.time_control.increment || 0}` : '—'} · {game.end_reason}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-sm font-bold ${eloChange > 0 ? 'text-emerald-400' : eloChange < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {eloChange > 0 ? '+' : ''}{eloChange || '—'}
                      </div>
                      {game.stakes > 0 && (
                        <div className={`text-xs font-medium ${result === 'win' ? 'text-emerald-400' : result === 'loss' ? 'text-red-400' : 'text-slate-400'}`}>
                          {result === 'win' ? `+Rp ${(game.stakes / 1000).toFixed(0)}K` : result === 'loss' ? `-Rp ${(game.stakes / 1000).toFixed(0)}K` : '±0'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Top players */}
          <motion.div variants={FADE} className="card rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="font-bold text-[var(--text-primary)]">Pemain Teratas</h3>
              <Link href="/leaderboard" className="text-sm text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors">
                Leaderboard <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {loadingLeaderboard ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
                </div>
              ) : topPlayers.length === 0 ? (
                <div className="text-center py-10 text-[var(--text-muted)]">
                  <Crown className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Leaderboard kosong</p>
                </div>
              ) : topPlayers.map((entry, idx) => (
                <div key={entry.id}
                  className={`flex items-center gap-3 px-5 py-3 transition-colors cursor-pointer
                    ${entry.id === user.id ? 'bg-sky-500/5 hover:bg-sky-500/10' : 'hover:bg-[var(--bg-hover)]'}`}>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black flex-shrink-0
                    ${idx === 0 ? 'bg-yellow-500/20 text-yellow-400' : idx === 1 ? 'bg-slate-300/20 text-slate-300' : idx === 2 ? 'bg-amber-700/20 text-amber-600' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}>
                    {idx < 3 ? ['🥇', '🥈', '🥉'][idx] : idx + 1}
                  </div>
                  <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-[var(--bg-hover)]">
                    <img src={entry.avatar_url} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {entry.title && <span className="text-xs font-bold text-yellow-400">{entry.title}</span>}
                      <span className={`text-sm font-semibold truncate ${entry.id === user.id ? 'text-sky-400' : 'text-[var(--text-primary)]'}`}>
                        {entry.username}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{entry.country} · {entry.winRate}% WR</span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-sm text-[var(--text-primary)]">{entry.elo}</div>
                    <div className="text-xs text-[var(--text-muted)]">{entry.wins}M</div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* ELO per time control */}
        <motion.div variants={FADE} className="card p-5 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-[var(--text-primary)]">ELO per Kontrol Waktu</h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Rating Anda di tiap format</p>
            </div>
            <Globe className="w-5 h-5 text-[var(--text-muted)]" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Bullet', icon: '⚡', elo: (user as any).elo_bullet ?? user.elo, color: 'text-red-400', bg: 'bg-red-500/10', desc: '< 3 min' },
              { label: 'Blitz',  icon: '🔥', elo: (user as any).elo_blitz  ?? user.elo, color: 'text-orange-400', bg: 'bg-orange-500/10', desc: '3–9 min' },
              { label: 'Rapid',  icon: '⏱',  elo: (user as any).elo_rapid  ?? user.elo, color: 'text-emerald-400', bg: 'bg-emerald-500/10', desc: '≥ 10 min' },
            ].map(tc => (
              <div key={tc.label} className={`${tc.bg} rounded-xl p-4 text-center`}>
                <div className="text-2xl mb-1">{tc.icon}</div>
                <div className={`text-xl font-black ${tc.color}`}>{tc.elo}</div>
                <div className="text-sm font-semibold text-[var(--text-primary)] mt-0.5">{tc.label}</div>
                <div className="text-xs text-[var(--text-muted)]">{tc.desc}</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Quick start banners */}
        <motion.div variants={FADE} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { title: 'Quick Bullet', sub: '1+0 · Tanpa taruhan', icon: '⚡', href: '/game', gradient: 'from-sky-500 to-blue-600', badge: 'Gratis' },
            { title: 'Paid Match', sub: 'Min Rp 10.000', icon: '💰', href: '/game', gradient: 'from-emerald-500 to-teal-600', badge: 'Hot' },
            { title: 'Turnamen', sub: 'Hadiah besar', icon: '🏆', href: '/tournament', gradient: 'from-yellow-500 to-orange-500', badge: 'Prize' },
          ].map((item) => (
            <Link key={item.title} href={item.href}
              className={`relative overflow-hidden p-5 rounded-2xl bg-gradient-to-br ${item.gradient} hover:opacity-90 transition-all group shadow-lg`}>
              <div className="absolute top-0 right-0 w-24 h-24 opacity-10 text-7xl flex items-center justify-center">{item.icon}</div>
              <span className="inline-block text-xs font-bold text-white/70 bg-white/20 px-2 py-0.5 rounded-full mb-3">{item.badge}</span>
              <div className="text-xl font-black text-white">{item.title}</div>
              <div className="text-sm text-white/70 mt-0.5">{item.sub}</div>
              <div className="flex items-center gap-1 text-white/70 text-sm mt-4 group-hover:gap-2 transition-all">
                Main sekarang <ChevronRight className="w-4 h-4" />
              </div>
            </Link>
          ))}
        </motion.div>
      </motion.div>
    </AppLayout>
  );
}

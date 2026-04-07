'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend
} from 'recharts';
import { TrendingUp, Target, Clock, Zap, Brain, Trophy, Loader2 } from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';

interface EloPoint { date: string; elo: number }
interface GameRecord {
  id: string;
  white_id?: string;           // direct column (if selected)
  white?: { id: string };      // nested join alias from getHistory()
  black_id?: string;
  black?: { id: string };
  result: string;
  time_control: { type: string; label: string };
  elo_before?: number;
  elo_after?: number;
}

export default function StatsPage() {
  const { user, token } = useAppStore();
  const [eloHistory, setEloHistory] = useState<EloPoint[]>([]);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [loadingElo, setLoadingElo] = useState(true);
  const [loadingGames, setLoadingGames] = useState(true);
  const [eloError, setEloError] = useState('');
  const [gamesError, setGamesError] = useState('');

  useEffect(() => {
    if (!token) { setLoadingElo(false); setLoadingGames(false); return; }

    api.game.eloHistory(token)
      .then(data => {
        const points: EloPoint[] = (data.history || [])
          .slice()
          .reverse()
          .map((h: { created_at: string; elo_after: number }) => ({
            date: new Date(h.created_at).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' }),
            elo: h.elo_after,
          }));
        setEloHistory(points);
      })
      .catch(() => setEloError('Data performa ELO tidak tersedia saat ini.'))
      .finally(() => setLoadingElo(false));

    api.game.history(token, 50)
      .then(data => setGames(data.history || data.games || []))
      .catch(() => {
        setGames([]);
        setGamesError('Riwayat pertandingan gagal dimuat.');
      })
      .finally(() => setLoadingGames(false));
  }, [token]);

  if (!user) return (
    <AppLayout>
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      </div>
    </AppLayout>
  );

  const totalGames = user.wins + user.losses + user.draws;
  const winRate = totalGames > 0 ? Math.round((user.wins / totalGames) * 100) : 0;

  // Derive results by time control from game history
  const tcMap: Record<string, { wins: number; losses: number; draws: number }> = {};
  games.forEach(g => {
    const tc = g.time_control?.type || 'other';
    if (!tcMap[tc]) tcMap[tc] = { wins: 0, losses: 0, draws: 0 };
    const isWhite = (g.white_id ?? g.white?.id) === user.id;
    if (g.result === 'white') { isWhite ? tcMap[tc].wins++ : tcMap[tc].losses++; }
    else if (g.result === 'black') { isWhite ? tcMap[tc].losses++ : tcMap[tc].wins++; }
    else if (g.result === 'draw') { tcMap[tc].draws++; }
  });

  const tcData = Object.entries(tcMap)
    .map(([name, v]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), ...v }))
    .filter(d => d.wins + d.losses + d.draws > 0);

  const eloChange = eloHistory.length >= 2
    ? eloHistory[eloHistory.length - 1].elo - eloHistory[0].elo
    : 0;

  // Current streak from recent games
  let streak = 0;
  let streakType = '';
  for (const g of [...games].reverse()) {
    const isWhite = (g.white_id ?? g.white?.id) === user.id;
    const won = (g.result === 'white' && isWhite) || (g.result === 'black' && !isWhite);
    if (streak === 0) { streakType = won ? 'W' : 'L'; streak = 1; }
    else if ((won && streakType === 'W') || (!won && streakType === 'L')) streak++;
    else break;
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">Statistik Performa</h1>
          <p className="text-[var(--text-muted)] mt-1">Pantau perkembangan permainan kamu</p>
        </motion.div>
        {(eloError || gamesError) && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {eloError || gamesError}
          </div>
        )}

        {/* Key metrics */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Win Rate', value: `${winRate}%`, icon: Target, color: 'emerald', sub: `${user.wins}M ${user.losses}K ${user.draws}S` },
            { label: 'Total Game', value: totalGames.toLocaleString(), icon: Clock, color: 'sky', sub: 'Sepanjang waktu' },
            { label: 'Streak', value: streak > 0 ? `${streak}${streakType}` : '—', icon: Zap, color: 'yellow', sub: 'Rangkaian saat ini' },
            { label: 'Perubahan ELO', value: eloChange >= 0 ? `+${eloChange}` : `${eloChange}`, icon: TrendingUp, color: eloChange >= 0 ? 'emerald' : 'red', sub: 'Sepanjang waktu' },
          ].map((m) => (
            <div key={m.label} className="card p-4 rounded-2xl">
              <div className={`w-9 h-9 rounded-xl mb-3 flex items-center justify-center
                ${m.color === 'emerald' ? 'bg-emerald-500/10' : m.color === 'sky' ? 'bg-sky-500/10' : m.color === 'yellow' ? 'bg-yellow-500/10' : m.color === 'red' ? 'bg-red-500/10' : 'bg-purple-500/10'}`}>
                <m.icon className={`w-4 h-4 ${m.color === 'emerald' ? 'text-emerald-400' : m.color === 'sky' ? 'text-sky-400' : m.color === 'yellow' ? 'text-yellow-400' : m.color === 'red' ? 'text-red-400' : 'text-purple-400'}`} />
              </div>
              <div className="text-2xl font-black text-[var(--text-primary)] mb-0.5">{m.value}</div>
              <div className="text-xs font-medium text-[var(--text-muted)]">{m.label}</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">{m.sub}</div>
            </div>
          ))}
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* ELO Progress */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-[var(--text-primary)]">Progress ELO</h3>
                <p className="text-xs text-[var(--text-muted)]">{eloHistory.length} data points</p>
              </div>
              <span className={`text-sm font-bold ${eloChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {eloChange >= 0 ? '+' : ''}{eloChange}
              </span>
            </div>
            {loadingElo ? (
              <div className="h-[180px] flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={eloHistory}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} itemStyle={{ color: '#38bdf8' }} />
                  <Area type="monotone" dataKey="elo" stroke="#38bdf8" fill="url(#g1)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* W/L/D summary */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="card p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-[var(--text-primary)]">Menang / Kalah / Seri</h3>
                <p className="text-xs text-[var(--text-muted)]">Rekor sepanjang waktu</p>
              </div>
              <span className="text-emerald-400 text-sm font-bold">{winRate}% WR</span>
            </div>
            <div className="space-y-4 mt-6">
              {[
                { label: 'Menang', value: user.wins, color: '#4ade80', bg: 'bg-emerald-500/10' },
                { label: 'Kalah', value: user.losses, color: '#f87171', bg: 'bg-red-500/10' },
                { label: 'Seri', value: user.draws, color: '#94a3b8', bg: 'bg-slate-500/10' },
              ].map(item => (
                <div key={item.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-[var(--text-muted)]">{item.label}</span>
                    <span className="text-sm font-bold text-[var(--text-primary)]">{item.value}</span>
                  </div>
                  <div className="h-2 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: totalGames > 0 ? `${(item.value / totalGames) * 100}%` : '0%',
                      backgroundColor: item.color
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Win/Loss by time control */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[var(--text-primary)]">Hasil per Kontrol Waktu</h3>
            </div>
            {loadingGames ? (
              <div className="h-[180px] flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
              </div>
            ) : tcData.length === 0 ? (
              <div className="h-[180px] flex items-center justify-center text-[var(--text-muted)] text-sm">Belum ada data pertandingan</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={tcData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="wins" name="Menang" fill="#4ade80" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="losses" name="Kalah" fill="#f87171" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="draws" name="Seri" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* Recent game results */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="font-bold text-[var(--text-primary)]">Pertandingan Terakhir</h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{Math.min(games.length, 10)} pertandingan terakhir</p>
            </div>
            {loadingGames ? (
              <div className="p-8 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
              </div>
            ) : games.length === 0 ? (
              <div className="p-8 text-center text-[var(--text-muted)] text-sm">
                <Trophy className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Belum ada pertandingan
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {games.slice(0, 10).map((g) => {
                  const isWhite = (g.white_id ?? g.white?.id) === user.id;
                  const won = (g.result === 'white' && isWhite) || (g.result === 'black' && !isWhite);
                  const drew = g.result === 'draw';
                  const eloChange = g.elo_after && g.elo_before ? g.elo_after - g.elo_before : null;
                  return (
                    <div key={g.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[var(--bg-hover)] transition-colors">
                      <div className={`w-2 h-8 rounded-full flex-shrink-0 ${won ? 'bg-emerald-400' : drew ? 'bg-yellow-400' : 'bg-red-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-[var(--text-primary)]">{won ? 'Menang' : drew ? 'Seri' : 'Kalah'}</div>
                        <div className="text-xs text-[var(--text-muted)]">{g.time_control?.label || '—'} • {isWhite ? 'Putih' : 'Hitam'}</div>
                      </div>
                      {eloChange !== null && (
                        <div className={`text-sm font-bold flex-shrink-0 ${eloChange > 0 ? 'text-emerald-400' : eloChange < 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                          {eloChange > 0 ? '+' : ''}{eloChange}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
}

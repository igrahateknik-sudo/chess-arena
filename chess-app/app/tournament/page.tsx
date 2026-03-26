'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, ChevronRight, Zap, Calendar, CheckCircle, Loader2, AlertCircle
} from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';

function formatIDR(n: number) {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}K`;
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function getTimeUntil(date: string) {
  const now = new Date();
  const target = new Date(date);
  const diff = target.getTime() - now.getTime();
  if (diff < 0) return 'Started';
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${mins}m`;
}

interface ApiTournament {
  id: string;
  name: string;
  description?: string;
  format: string;
  time_control: { type: string; initial: number; increment: number; label: string };
  prize_pool: number;
  prize_distribution?: Record<string, number>;
  entry_fee: number;
  max_players: number | null;
  min_elo?: number | null;
  max_elo?: number | null;
  status: 'upcoming' | 'active' | 'finished';
  starts_at: string;
  ends_at?: string | null;
  winner_id?: string | null;
  registrations_count?: number;
}

export default function TournamentPage() {
  const { user, token } = useAppStore();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'live' | 'finished'>('live');
  const [tournaments, setTournaments] = useState<ApiTournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);
  const [joined, setJoined] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const statusParam = activeTab === 'live' ? 'active' : activeTab;
    api.tournament.list(statusParam)
      .then(data => setTournaments(data.tournaments || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeTab]);

  const handleJoin = async (t: ApiTournament) => {
    if (!token) { setJoinError('Please log in to register'); return; }
    setJoining(t.id);
    setJoinError(null);
    try {
      await api.tournament.register(t.id, token);
      setJoined(prev => [...prev, t.id]);
      // Refresh count
      setTournaments(prev => prev.map(x =>
        x.id === t.id ? { ...x, registrations_count: (x.registrations_count || 0) + 1 } : x
      ));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      setJoinError(msg);
    } finally {
      setJoining(null);
    }
  };

  const currentCount = (t: ApiTournament) => t.registrations_count ?? 0;
  const isFull = (t: ApiTournament) => t.max_players !== null && currentCount(t) >= t.max_players;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-black text-[var(--text-primary)] flex items-center gap-2">
            <Trophy className="w-7 h-7 text-yellow-400" />
            Tournaments
          </h1>
          <p className="text-[var(--text-muted)] mt-1">Compete for real prize pools</p>
        </motion.div>

        {/* Hero banner */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-yellow-600 via-orange-600 to-red-700 p-6 md:p-8">
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
            <div className="flex-1">
              <div className="text-yellow-200 text-sm font-bold mb-2 flex items-center gap-2">
                <Zap className="w-4 h-4" /> FEATURED TOURNAMENT
              </div>
              <h2 className="text-3xl font-black text-white mb-2">Weekly Blitz Championship</h2>
              <p className="text-white/70 mb-4">Swiss system • 64 players • Register now to compete</p>
              <div className="flex flex-wrap gap-3">
                <div className="bg-white/20 rounded-xl px-4 py-2 text-center">
                  <div className="text-2xl font-black text-white">Rp 5M</div>
                  <div className="text-xs text-white/70">Prize Pool</div>
                </div>
                <div className="bg-white/20 rounded-xl px-4 py-2 text-center">
                  <div className="text-2xl font-black text-white">64</div>
                  <div className="text-xs text-white/70">Max Players</div>
                </div>
                <div className="bg-white/20 rounded-xl px-4 py-2 text-center">
                  <div className="text-2xl font-black text-white">5+3</div>
                  <div className="text-xs text-white/70">Time Control</div>
                </div>
              </div>
            </div>
            <div className="text-center">
              <div className="text-7xl mb-3">🏆</div>
              <button className="px-6 py-3 bg-white text-orange-700 rounded-2xl font-bold hover:bg-yellow-50 transition-colors shadow-lg">
                View Tournaments
              </button>
            </div>
          </div>
        </motion.div>

        {/* Join error */}
        {joinError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {joinError}
          </div>
        )}

        {/* Tabs */}
        <div className="flex p-1 bg-[var(--bg-hover)] rounded-xl w-fit gap-1">
          {(['live', 'upcoming', 'finished'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2
                ${activeTab === t ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
              {t === 'live' && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Tournament cards */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
          </div>
        ) : tournaments.length === 0 ? (
          <div className="card rounded-2xl p-12 text-center text-[var(--text-muted)]">
            <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No {activeTab === 'live' ? 'live' : activeTab} tournaments</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <AnimatePresence>
              {tournaments.map((tournament, i) => (
                <motion.div key={tournament.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ delay: i * 0.08 }}
                  className="card rounded-2xl overflow-hidden hover:border-[var(--accent)] transition-all group">
                  {/* Card header */}
                  <div className={`relative overflow-hidden px-5 py-4
                    ${tournament.status === 'active' ? 'bg-gradient-to-r from-red-500/10 to-orange-500/10' : tournament.status === 'upcoming' ? 'bg-gradient-to-r from-sky-500/10 to-blue-500/10' : 'bg-gradient-to-r from-slate-500/10 to-gray-500/10'}`}>
                    {tournament.status === 'active' && (
                      <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        LIVE
                      </div>
                    )}
                    <div className="pr-16">
                      <h3 className="font-bold text-[var(--text-primary)] text-lg mb-1">{tournament.name}</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)] capitalize font-medium">{tournament.format}</span>
                        {tournament.time_control?.label && (
                          <span className="text-xs font-mono font-bold text-[var(--text-secondary)]">{tournament.time_control.label}</span>
                        )}
                        {tournament.time_control?.type && (
                          <span className="text-xs text-[var(--text-muted)] capitalize">{tournament.time_control.type}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="p-5">
                    <div className="grid grid-cols-2 gap-4 mb-5">
                      <div>
                        <div className="text-xs text-[var(--text-muted)] mb-1">Prize Pool</div>
                        <div className="text-xl font-black text-yellow-400">{formatIDR(tournament.prize_pool)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--text-muted)] mb-1">Entry Fee</div>
                        <div className="text-xl font-black text-[var(--text-primary)]">
                          {tournament.entry_fee === 0 ? 'FREE' : formatIDR(tournament.entry_fee)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--text-muted)] mb-1">Players</div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-[var(--text-primary)]">
                              {currentCount(tournament)}{tournament.max_players ? `/${tournament.max_players}` : ''}
                            </span>
                            {tournament.max_players && (
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${isFull(tournament) ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                {isFull(tournament) ? 'FULL' : `${tournament.max_players - currentCount(tournament)} spots left`}
                              </span>
                            )}
                          </div>
                          {tournament.max_players && (
                            <div className="h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-sky-500 to-blue-600 rounded-full transition-all"
                                style={{ width: `${Math.min((currentCount(tournament) / tournament.max_players) * 100, 100)}%` }} />
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--text-muted)] mb-1">
                          {tournament.status === 'finished' ? 'Status' : tournament.status === 'active' ? 'Started' : 'Starts in'}
                        </div>
                        <div className={`text-sm font-bold ${tournament.status === 'active' ? 'text-red-400' : tournament.status === 'finished' ? 'text-slate-400' : 'text-sky-400'}`}>
                          {tournament.status === 'finished' ? 'Finished' :
                           tournament.status === 'active' ? '● LIVE NOW' :
                           getTimeUntil(tournament.starts_at)}
                        </div>
                      </div>
                    </div>

                    {/* Prize distribution */}
                    {tournament.prize_pool > 0 && (
                      <div className="mb-4 p-3 bg-[var(--bg-hover)] rounded-xl">
                        <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Prize Distribution</div>
                        <div className="flex gap-3">
                          {[
                            { place: '1st', pct: 50, color: 'yellow' },
                            { place: '2nd', pct: 30, color: 'slate' },
                            { place: '3rd', pct: 20, color: 'amber' },
                          ].map(p => (
                            <div key={p.place} className="flex-1 text-center">
                              <div className={`text-xs font-bold ${p.color === 'yellow' ? 'text-yellow-400' : p.color === 'slate' ? 'text-slate-300' : 'text-amber-600'}`}>{p.place}</div>
                              <div className="text-sm font-black text-[var(--text-primary)]">{formatIDR(tournament.prize_pool * p.pct / 100)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action */}
                    {tournament.status === 'finished' ? (
                      <button className="w-full py-2.5 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--bg-hover)] transition-colors flex items-center justify-center gap-2">
                        View Results <ChevronRight className="w-4 h-4" />
                      </button>
                    ) : tournament.status === 'active' ? (
                      joined.includes(tournament.id) ? (
                        <button className="w-full py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-semibold flex items-center justify-center gap-2">
                          <CheckCircle className="w-4 h-4" /> Joined — View Bracket
                        </button>
                      ) : (
                        <button onClick={() => handleJoin(tournament)}
                          disabled={joining === tournament.id}
                          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-orange-500 text-white text-sm font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-lg shadow-red-500/20 disabled:opacity-60">
                          {joining === tournament.id ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Zap className="w-4 h-4" />}
                          Join Live Tournament
                        </button>
                      )
                    ) : (
                      joined.includes(tournament.id) ? (
                        <button className="w-full py-2.5 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20 text-sm font-semibold flex items-center justify-center gap-2">
                          <CheckCircle className="w-4 h-4" /> Registered
                        </button>
                      ) : (
                        <button onClick={() => handleJoin(tournament)}
                          disabled={joining === tournament.id || isFull(tournament)}
                          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20">
                          {joining === tournament.id ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Trophy className="w-4 h-4" />}
                          Register {tournament.entry_fee > 0 ? `— ${formatIDR(tournament.entry_fee)}` : '— FREE'}
                        </button>
                      )
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Schedule */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="card rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Calendar className="w-4 h-4 text-sky-400" /> Upcoming Schedule
            </h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {[
              { name: 'Daily Bullet Arena', time: 'Today 22:00', prize: 'Rp 1M', fee: 'Free', players: 'Open', tc: '1+0' },
              { name: 'Weekend Blitz Open', time: 'Sat 10:00', prize: 'Rp 3M', fee: 'Rp 30K', players: '128 max', tc: '3+2' },
              { name: 'Monthly Championship', time: 'Apr 1, 10:00', prize: 'Rp 20M', fee: 'Rp 200K', players: '256 max', tc: '10+5' },
              { name: 'GM Invitational', time: 'Apr 15, 14:00', prize: 'Rp 100M', fee: 'Invite only', players: '16', tc: '15+10' },
            ].map((t, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5 hover:bg-[var(--bg-hover)] transition-colors">
                <div className="w-10 h-10 rounded-xl bg-[var(--bg-hover)] flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-5 h-5 text-[var(--text-muted)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[var(--text-primary)]">{t.name}</div>
                  <div className="text-xs text-[var(--text-muted)]">{t.time} • {t.tc} • {t.players}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-sm text-yellow-400">{t.prize}</div>
                  <div className="text-xs text-[var(--text-muted)]">{t.fee}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </AppLayout>
  );
}

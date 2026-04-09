'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, Crown, Users, Clock, ChevronLeft, Loader2,
  Swords, Medal, RefreshCw, Zap, CheckCircle, AlertCircle,
  ExternalLink, Ticket, ArrowRight
} from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import { getSocket, getSocketInstance } from '@/lib/socket';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TournamentUser {
  id: string;
  username: string;
  elo: number;
  avatar_url?: string;
  title?: string;
}

interface Pairing {
  id: string;
  round: number;
  board_number: number;
  result: string | null;
  game_id: string | null;
  white: TournamentUser;
  black: TournamentUser;
}

interface Standing {
  rank: number;
  userId: string;
  user: TournamentUser;
  score: number;
  wins: number;
  losses: number;
  draws: number;
  projectedPrize?: number;
}

interface RegisteredPlayer {
  id: string;
  user_id: string;
  paid: boolean;
  score: number;
  registered_at: string;
  user: {
    id: string;
    username: string;
    elo: number;
    avatar_url?: string;
    title?: string;
    country?: string;
  };
}

interface Tournament {
  id: string;
  name: string;
  format: string;
  status: 'upcoming' | 'active' | 'finished';
  time_control: { type: string; initial: number; increment: number; label: string };
  prize_pool: number;
  prize_distribution?: Record<string, number>;
  entry_fee: number;
  max_players: number | null;
  current_round: number;
  starts_at: string;
  ends_at?: string | null;
  winner_id?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatResult(result: string | null): { label: string; color: string } {
  if (!result) return { label: 'Berlangsung', color: 'text-amber-400' };
  if (result === '1-0') return { label: '1 – 0', color: 'text-emerald-400' };
  if (result === '0-1') return { label: '0 – 1', color: 'text-red-400' };
  if (result === '1/2-1/2') return { label: '½ – ½', color: 'text-slate-400' };
  if (result === 'bye') return { label: 'Bye', color: 'text-slate-500' };
  return { label: result, color: 'text-slate-400' };
}

function scoreDisplay(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function useCountdown(targetIso: string | null | undefined) {
  const [countdown, setCountdown] = useState('');
  useEffect(() => {
    if (!targetIso) { setCountdown(''); return; }
    function calc() {
      const diff = new Date(targetIso).getTime() - Date.now();
      if (diff <= 0) { setCountdown('Sebentar lagi'); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setCountdown(h > 0 ? `${h}j ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    }
    calc();
    const iv = setInterval(calc, 1000);
    return () => clearInterval(iv);
  }, [targetIso]);
  return countdown;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TournamentDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const { user, token } = useAppStore();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [players, setPlayers] = useState<RegisteredPlayer[]>([]);
  const [activeTab, setActiveTab] = useState<'pairing' | 'klasemen'>('pairing');
  const [loading, setLoading] = useState(true);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const countdown = useCountdown(tournament?.starts_at);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [bracketData, standingsData] = await Promise.all([
        api.tournament.bracket(id),
        api.tournament.standings(id),
      ]);
      setTournament(bracketData.tournament);
      setCurrentRound(bracketData.currentRound || 1);
      setPairings(bracketData.pairings || []);
      setStandings(standingsData.standings || []);
      setError(null);
    } catch {
      setError('Gagal memuat data tournament.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  const loadPlayers = useCallback(async () => {
    if (!id) return;
    setPlayersLoading(true);
    try {
      const data = await api.tournament.players(id);
      setPlayers(data.players || []);
    } catch {
      // non-fatal
    } finally {
      setPlayersLoading(false);
    }
  }, [id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Auto-load players for upcoming tournaments
  useEffect(() => {
    if (tournament?.status === 'upcoming') loadPlayers();
  }, [tournament?.status, loadPlayers]);

  // Real-time socket updates
  useEffect(() => {
    if (!id) return;
    const socket = token ? getSocket(token) : getSocketInstance();
    if (!socket) return;

    socket.emit('tournament:join', { tournamentId: id });
    const refresh = () => { load(); loadPlayers(); };
    socket.on('tournament:round_start', refresh);
    socket.on('tournament:finished', refresh);
    socket.on('tournament:update', (data: { tournamentId: string }) => {
      if (data.tournamentId === id) refresh();
    });

    return () => {
      socket.emit('tournament:leave', { tournamentId: id });
      socket.off('tournament:round_start', refresh);
      socket.off('tournament:finished', refresh);
      socket.off('tournament:update', refresh);
    };
  }, [id, load, loadPlayers]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (error || !tournament) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto py-16 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400 opacity-60" />
          <p className="text-[var(--text-muted)] mb-4">{error || 'Tournament tidak ditemukan.'}</p>
          <Link href="/tournament" className="text-amber-400 hover:underline text-sm">← Kembali ke Turnamen</Link>
        </div>
      </AppLayout>
    );
  }

  const isUpcoming = tournament.status === 'upcoming';
  const isActive   = tournament.status === 'active';
  const isFinished = tournament.status === 'finished';
  const myStanding = standings.find(s => s.userId === user?.id);
  const amRegistered = players.some(p => p.user_id === user?.id) || standings.some(s => s.userId === user?.id);
  const fillPct = tournament.max_players && players.length
    ? Math.min((players.length / tournament.max_players) * 100, 100)
    : 0;
  const netPool = Math.floor(tournament.prize_pool * 0.96);

  const statusBadge = {
    upcoming: { label: 'Mendatang', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    active:   { label: '● Live',    cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
    finished: { label: 'Selesai',   cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  }[tournament.status];

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5">

        {/* ── Back nav ──────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Link href="/tournament"
            className="inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm transition-colors mb-3">
            <ChevronLeft className="w-4 h-4" /> Arena Turnamen
          </Link>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${statusBadge.cls}`}>
                  {statusBadge.label}
                </span>
                <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-hover)] px-2 py-0.5 rounded-full capitalize">
                  {tournament.format}
                </span>
                <span className="text-xs font-mono font-bold text-[var(--text-secondary)]">
                  {tournament.time_control?.label}
                </span>
                {amRegistered && !isFinished && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    <CheckCircle className="w-2.5 h-2.5" /> Terdaftar
                  </span>
                )}
              </div>
              <h1 className="text-xl font-black text-[var(--text-primary)]">{tournament.name}</h1>
            </div>

            <button onClick={() => { setRefreshing(true); load(); if (isUpcoming) loadPlayers(); }}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </motion.div>

        {/* ── Quick stats strip ─────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: 'Hadiah Pool',
              value: tournament.prize_pool > 0 ? `Rp ${tournament.prize_pool.toLocaleString('id-ID')}` : '—',
              icon: <Trophy className="w-4 h-4 text-yellow-400" />,
            },
            {
              label: 'Tiket Masuk',
              value: tournament.entry_fee > 0 ? `Rp ${tournament.entry_fee.toLocaleString('id-ID')}` : 'GRATIS',
              icon: <Ticket className="w-4 h-4 text-amber-400" />,
            },
            {
              label: 'Peserta',
              value: isUpcoming
                ? `${players.length}${tournament.max_players ? `/${tournament.max_players}` : ''}`
                : `${standings.length}`,
              icon: <Users className="w-4 h-4 text-slate-400" />,
            },
            {
              label: isUpcoming ? 'Mulai Dalam' : isActive ? 'Ronde' : 'Status',
              value: isUpcoming ? (countdown || '—') : isActive ? `${currentRound}` : 'Selesai',
              icon: <Clock className="w-4 h-4 text-amber-400" />,
            },
          ].map(s => (
            <div key={s.label} className="card rounded-xl p-3 flex items-center gap-3">
              {s.icon}
              <div>
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">{s.label}</div>
                <div className="text-sm font-bold text-[var(--text-primary)] tabular-nums">{s.value}</div>
              </div>
            </div>
          ))}
        </motion.div>

        {/* ══════════════════════════════════════════════════════════
            UPCOMING — Lobby layout (info left + player list right)
        ══════════════════════════════════════════════════════════ */}
        {isUpcoming && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
            className="grid md:grid-cols-5 gap-5">

            {/* Left: tournament info */}
            <div className="md:col-span-2 space-y-4">

              {/* Countdown card */}
              <div className="card rounded-xl p-5 text-center border-amber-500/20">
                <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Dimulai Dalam</div>
                <div className="text-4xl font-black text-amber-400 tabular-nums font-mono mb-2">{countdown || '—'}</div>
                <div className="text-xs text-[var(--text-muted)]">Turnamen mulai otomatis pukul :05</div>
              </div>

              {/* Prize breakdown */}
              {tournament.prize_pool > 0 && (
                <div className="card rounded-xl p-4">
                  <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3">Distribusi Hadiah</div>
                  <div className="space-y-2">
                    {[
                      { place: '🥇 Juara 1', pct: tournament.prize_distribution?.['1'] ?? 0.5, color: 'text-yellow-400' },
                      { place: '🥈 Juara 2', pct: tournament.prize_distribution?.['2'] ?? 0.3, color: 'text-slate-300' },
                      { place: '🥉 Juara 3', pct: tournament.prize_distribution?.['3'] ?? 0.2, color: 'text-amber-600' },
                    ].map(p => (
                      <div key={p.place} className="flex items-center justify-between text-sm">
                        <span className="text-[var(--text-muted)]">{p.place}</span>
                        <span className={`font-black ${p.color}`}>
                          Rp {Math.floor(netPool * p.pct).toLocaleString('id-ID')}
                          <span className="text-[10px] font-normal text-[var(--text-muted)] ml-1">({Math.round(p.pct * 100)}%)</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)]">
                    4% platform fee dipotong dari total pool
                  </div>
                </div>
              )}

              {/* Slot progress */}
              {tournament.max_players && (
                <div className="card rounded-xl p-4">
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-[var(--text-muted)]">Slot terisi</span>
                    <span className="font-bold text-[var(--text-primary)]">
                      {players.length}/{tournament.max_players}
                    </span>
                  </div>
                  <div className="h-2 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${
                      fillPct >= 100 ? 'bg-red-500' : fillPct > 75 ? 'bg-amber-400' : 'bg-emerald-500'
                    }`} style={{ width: `${fillPct}%` }} />
                  </div>
                  <div className="mt-2 text-[10px] text-[var(--text-muted)]">
                    {tournament.max_players - players.length} slot tersisa
                  </div>
                </div>
              )}
            </div>

            {/* Right: player lobby */}
            <div className="md:col-span-3">
              <div className="card rounded-xl overflow-hidden h-full">
                <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-400" />
                    <span className="font-bold text-sm text-[var(--text-primary)]">Ruang Tunggu</span>
                    <span className="text-xs text-[var(--text-muted)]">— pemain yang sudah daftar</span>
                  </div>
                  <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                    {players.length} orang
                  </span>
                </div>

                {playersLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                  </div>
                ) : players.length === 0 ? (
                  <div className="py-12 text-center text-[var(--text-muted)]">
                    <Users className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">Belum ada peserta</p>
                    <p className="text-xs mt-1 opacity-60">Jadilah yang pertama!</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border)] max-h-80 overflow-y-auto">
                    {players.map((p, i) => {
                      const isMe = p.user_id === user?.id;
                      return (
                        <motion.div key={p.id}
                          initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                          className={`flex items-center gap-3 px-4 py-2.5 transition-colors
                            ${isMe ? 'bg-amber-500/5' : 'hover:bg-[var(--bg-hover)]'}`}>
                          <div className="text-xs text-[var(--text-muted)] font-mono w-5 text-center flex-shrink-0">
                            {i + 1}
                          </div>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                            ${isMe ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}>
                            {p.user?.username?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-semibold truncate flex items-center gap-1.5
                              ${isMe ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>
                              {p.user?.username || '—'}
                              {isMe && <span className="text-[10px] opacity-60">(kamu)</span>}
                              {p.user?.title && (
                                <span className="text-[10px] text-amber-400 font-bold">{p.user.title}</span>
                              )}
                            </div>
                            {p.user?.country && (
                              <div className="text-[10px] text-[var(--text-muted)]">{p.user.country}</div>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-xs font-mono font-bold text-[var(--text-secondary)]">
                              {p.user?.elo ?? '—'}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)]">ELO</div>
                          </div>
                          {p.paid && (
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" title="Tiket lunas" />
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* ══════════════════════════════════════════════════════════
            ACTIVE — My position + tabbed pairing/standings
        ══════════════════════════════════════════════════════════ */}
        {isActive && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
            className="space-y-4">

            {/* My position */}
            {myStanding && (
              <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/8 border border-amber-500/20 rounded-xl">
                <Crown className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span className="text-sm text-[var(--text-secondary)]">
                  Posisimu:
                  <span className="font-black text-amber-400 mx-1.5">#{myStanding.rank}</span>
                  skor <span className="font-black text-[var(--text-primary)]">{scoreDisplay(myStanding.score)}</span>
                  <span className="mx-1.5 text-[var(--text-muted)]">·</span>
                  <span className="text-emerald-400">{myStanding.wins || 0}W</span>
                  {' / '}
                  <span className="text-slate-400">{myStanding.draws || 0}D</span>
                  {' / '}
                  <span className="text-red-400">{myStanding.losses || 0}L</span>
                </span>
              </div>
            )}

            {/* Tabs */}
            <div className="flex p-1 bg-[var(--bg-hover)] rounded-xl gap-1 w-fit">
              {([['pairing', `Pairing Ronde ${currentRound}`], ['klasemen', 'Klasemen']] as const).map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all
                    ${activeTab === tab
                      ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Pairing tab */}
            {activeTab === 'pairing' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Swords className="w-4 h-4 text-amber-400" />
                  <span className="font-bold text-sm text-[var(--text-primary)]">Ronde {currentRound}</span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />LIVE
                  </span>
                </div>

                {pairings.length === 0 ? (
                  <div className="card rounded-xl p-10 text-center text-[var(--text-muted)]">
                    <Swords className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">Belum ada pairing ronde ini</p>
                  </div>
                ) : (
                  pairings.map((pairing, i) => {
                    const res = formatResult(pairing.result);
                    const isWhiteWin = pairing.result === '1-0';
                    const isBlackWin = pairing.result === '0-1';
                    const isDraw = pairing.result === '1/2-1/2';
                    const isMyGame = pairing.white?.id === user?.id || pairing.black?.id === user?.id;

                    return (
                      <motion.div key={pairing.id}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                        className={`card rounded-xl overflow-hidden border transition-all
                          ${isMyGame ? 'border-amber-500/30' : 'border-[var(--border)]'}`}>
                        <div className="p-4">
                          <div className="flex items-center justify-between mb-3 text-xs">
                            <span className="text-[var(--text-muted)] font-semibold">Papan {pairing.board_number}</span>
                            <div className="flex items-center gap-2">
                              {isMyGame && <span className="text-amber-400 font-bold">★ Kamu</span>}
                              <span className={`font-bold ${res.color}`}>{res.label}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            {/* White */}
                            <div className={`flex-1 flex items-center gap-2 ${isWhiteWin ? '' : isBlackWin ? 'opacity-40' : ''}`}>
                              <div className="w-8 h-8 rounded-full bg-slate-100/10 border border-white/20 flex items-center justify-center text-xs font-black text-white flex-shrink-0">
                                {pairing.white?.username?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-[var(--text-primary)] truncate flex items-center gap-1">
                                  {pairing.white?.username || '?'}
                                  {isWhiteWin && <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                                </div>
                                <div className="text-xs text-[var(--text-muted)]">{pairing.white?.elo || '—'} · Putih</div>
                              </div>
                            </div>

                            {/* Center */}
                            <div className="flex-shrink-0 text-center">
                              <div className={`text-xs font-black ${res.color}`}>
                                {pairing.result === null ? 'VS' : pairing.result}
                              </div>
                              {pairing.result === null && pairing.game_id && (
                                <div className="text-[10px] text-red-400 font-medium">Live</div>
                              )}
                              {isDraw && <div className="text-[10px] text-slate-400">Seri</div>}
                            </div>

                            {/* Black */}
                            <div className={`flex-1 flex items-center gap-2 flex-row-reverse text-right ${isBlackWin ? '' : isWhiteWin ? 'opacity-40' : ''}`}>
                              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-xs font-black text-slate-300 flex-shrink-0">
                                {pairing.black?.username?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-[var(--text-primary)] truncate flex items-center justify-end gap-1">
                                  {isBlackWin && <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                                  {pairing.black?.username || '?'}
                                </div>
                                <div className="text-xs text-[var(--text-muted)]">Hitam · {pairing.black?.elo || '—'}</div>
                              </div>
                            </div>
                          </div>

                          {pairing.game_id && (
                            <div className="mt-3 pt-3 border-t border-[var(--border)]">
                              <Link href={`/game?id=${pairing.game_id}`}
                                className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-semibold transition-colors">
                                {pairing.result === null
                                  ? <><Zap className="w-3.5 h-3.5" /> Tonton / Mainkan</>
                                  : <><ExternalLink className="w-3.5 h-3.5" /> Lihat Partai</>
                                }
                              </Link>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            )}

            {/* Klasemen tab */}
            {activeTab === 'klasemen' && <StandingsTable standings={standings} userId={user?.id} prizePool={tournament.prize_pool} />}
          </motion.div>
        )}

        {/* ══════════════════════════════════════════════════════════
            FINISHED — Winner banner + standings
        ══════════════════════════════════════════════════════════ */}
        {isFinished && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
            className="space-y-4">

            {/* Winner */}
            {standings.length > 0 && (
              <div className="rounded-xl border border-yellow-500/30 bg-gradient-to-r from-yellow-800/20 to-amber-900/10 p-5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center text-2xl flex-shrink-0">
                    🏆
                  </div>
                  <div>
                    <div className="text-xs text-yellow-500 font-bold uppercase tracking-wider mb-0.5">Juara Tournament</div>
                    <div className="font-black text-[var(--text-primary)] text-xl">{standings[0]?.user?.username || '—'}</div>
                    <div className="text-sm text-[var(--text-muted)] flex items-center gap-3 mt-0.5">
                      <span>Skor: <span className="font-bold text-yellow-400">{scoreDisplay(standings[0]?.score || 0)}</span></span>
                      {tournament.prize_pool > 0 && standings[0]?.projectedPrize && (
                        <span>Hadiah: <span className="font-bold text-yellow-400">Rp {standings[0].projectedPrize.toLocaleString('id-ID')}</span></span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <StandingsTable standings={standings} userId={user?.id} prizePool={tournament.prize_pool} />
          </motion.div>
        )}
      </div>
    </AppLayout>
  );
}

// ── Standings Table Component ─────────────────────────────────────────────────

function StandingsTable({ standings, userId, prizePool }: {
  standings: Standing[];
  userId?: string;
  prizePool: number;
}) {
  if (standings.length === 0) {
    return (
      <div className="card rounded-xl p-10 text-center text-[var(--text-muted)]">
        <Users className="w-8 h-8 mx-auto mb-3 opacity-20" />
        <p className="text-sm">Klasemen belum tersedia</p>
      </div>
    );
  }

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className="card rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="text-left px-4 py-3 text-xs text-[var(--text-muted)] font-semibold w-10">#</th>
            <th className="text-left px-4 py-3 text-xs text-[var(--text-muted)] font-semibold">Pemain</th>
            <th className="text-center px-3 py-3 text-xs text-[var(--text-muted)] font-semibold">Skor</th>
            <th className="text-center px-3 py-3 text-xs text-[var(--text-muted)] font-semibold hidden sm:table-cell">W/D/L</th>
            {prizePool > 0 && (
              <th className="text-right px-4 py-3 text-xs text-[var(--text-muted)] font-semibold hidden md:table-cell">Hadiah</th>
            )}
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => {
            const isMe = s.userId === userId;
            return (
              <tr key={s.userId}
                className={`border-b border-[var(--border)] last:border-0 transition-colors
                  ${isMe ? 'bg-amber-500/5' : 'hover:bg-[var(--bg-hover)]'}`}>
                <td className="px-4 py-3 text-center">
                  {i < 3
                    ? <span className="text-base">{medals[i]}</span>
                    : <span className="text-xs text-[var(--text-muted)] font-mono">{i + 1}</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                      ${isMe ? 'bg-amber-500/20 text-amber-400' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}>
                      {s.user?.username?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0">
                      <span className={`font-semibold truncate flex items-center gap-1.5 ${isMe ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>
                        {s.user?.username || '—'}
                        {isMe && <span className="text-[10px] opacity-60">(kamu)</span>}
                        {s.user?.title && <span className="text-[10px] text-amber-400 font-bold">{s.user.title}</span>}
                      </span>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">{s.user?.elo} ELO</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-center font-black text-[var(--text-primary)]">
                  {scoreDisplay(s.score)}
                </td>
                <td className="px-3 py-3 text-center text-xs hidden sm:table-cell">
                  <span className="text-emerald-400">{s.wins || 0}</span>
                  {' / '}
                  <span className="text-slate-400">{s.draws || 0}</span>
                  {' / '}
                  <span className="text-red-400">{s.losses || 0}</span>
                </td>
                {prizePool > 0 && (
                  <td className="px-4 py-3 text-right text-xs hidden md:table-cell">
                    {s.projectedPrize && s.projectedPrize > 0
                      ? <span className="text-yellow-400 font-bold">Rp {s.projectedPrize.toLocaleString('id-ID')}</span>
                      : <span className="text-[var(--text-muted)]">—</span>
                    }
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

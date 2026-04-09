'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Trophy, Crown, Users, Clock, ChevronLeft, Loader2,
  Swords, Medal, RefreshCw, Zap, CheckCircle, AlertCircle,
  ExternalLink
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TournamentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { user, token } = useAppStore();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [activeTab, setActiveTab] = useState<'standings' | 'bracket'>('bracket');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Real-time socket updates
  useEffect(() => {
    if (!id) return;
    const socket = token ? getSocket(token) : getSocketInstance();
    if (!socket) return;

    socket.emit('tournament:join', { tournamentId: id });

    const refresh = () => load();
    socket.on('tournament:round_start', refresh);
    socket.on('tournament:finished', refresh);
    socket.on('tournament:update', (data: { tournamentId: string }) => {
      if (data.tournamentId === id) load();
    });

    return () => {
      socket.emit('tournament:leave', { tournamentId: id });
      socket.off('tournament:round_start', refresh);
      socket.off('tournament:finished', refresh);
      socket.off('tournament:update', refresh);
    };
  }, [id, load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

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

  const isMyTournament = standings.some(s => s.userId === user?.id);
  const myStanding = standings.find(s => s.userId === user?.id);

  const statusConfig = {
    upcoming: { label: 'Mendatang', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
    active:   { label: '● Live', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
    finished: { label: 'Selesai', color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/20' },
  };
  const sc = statusConfig[tournament.status];

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-5">

        {/* ── Back + Header ──────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Link href="/tournament" className="inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm mb-4 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Kembali
          </Link>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${sc.bg} ${sc.color}`}>
                  {sc.label}
                </span>
                <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-hover)] px-2 py-0.5 rounded-full capitalize">
                  {tournament.format}
                </span>
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  {tournament.time_control?.label}
                </span>
              </div>
              <h1 className="text-xl font-black text-[var(--text-primary)]">{tournament.name}</h1>
            </div>

            <button onClick={handleRefresh} disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </motion.div>

        {/* ── Stats bar ─────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Reward Pool', value: tournament.prize_pool > 0 ? `Rp ${tournament.prize_pool.toLocaleString('id-ID')}` : '—', icon: <Trophy className="w-4 h-4 text-yellow-400" /> },
            { label: 'Tiket Masuk', value: tournament.entry_fee > 0 ? `Rp ${tournament.entry_fee.toLocaleString('id-ID')}` : 'GRATIS', icon: <Medal className="w-4 h-4 text-amber-400" /> },
            { label: 'Pemain', value: standings.length, icon: <Users className="w-4 h-4 text-slate-400" /> },
            { label: 'Ronde', value: tournament.status === 'upcoming' ? '—' : `${currentRound}`, icon: <Swords className="w-4 h-4 text-amber-400" /> },
          ].map(stat => (
            <div key={stat.label} className="card rounded-xl p-3 flex items-center gap-3">
              {stat.icon}
              <div>
                <div className="text-xs text-[var(--text-muted)]">{stat.label}</div>
                <div className="text-sm font-bold text-[var(--text-primary)]">{stat.value}</div>
              </div>
            </div>
          ))}
        </motion.div>

        {/* ── My position banner ────────────────────────────────── */}
        {isMyTournament && myStanding && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="flex items-center gap-3 px-4 py-3 bg-amber-500/8 border border-amber-500/20 rounded-xl">
            <Crown className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-[var(--text-secondary)]">
              Posisi kamu saat ini:
              <span className="font-bold text-amber-400 mx-1">#{myStanding.rank}</span>
              dengan skor
              <span className="font-bold text-[var(--text-primary)] mx-1">{scoreDisplay(myStanding.score)}</span>
            </span>
          </motion.div>
        )}

        {/* ── Tabs ─────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
          <div className="flex p-1 bg-[var(--bg-hover)] rounded-xl gap-1 w-fit mb-4">
            {([['bracket', 'Bracket / Pairing'], ['standings', 'Klasemen']] as const).map(([tab, label]) => (
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

          {/* ── Bracket tab ──────────────────────────────────── */}
          {activeTab === 'bracket' && (
            <div className="space-y-3">
              {tournament.status === 'upcoming' ? (
                <div className="card rounded-2xl p-12 text-center text-[var(--text-muted)]">
                  <Clock className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">Tournament belum dimulai</p>
                  <p className="text-xs mt-1 opacity-60">Pairing akan muncul saat tournament aktif</p>
                </div>
              ) : pairings.length === 0 ? (
                <div className="card rounded-2xl p-12 text-center text-[var(--text-muted)]">
                  <Swords className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">Belum ada pairing untuk ronde ini</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <Swords className="w-4 h-4 text-amber-400" />
                    <h3 className="font-bold text-sm text-[var(--text-primary)]">Ronde {currentRound}</h3>
                    {tournament.status === 'active' && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />LIVE
                      </span>
                    )}
                  </div>

                  {pairings.map((pairing, i) => {
                    const res = formatResult(pairing.result);
                    const isWhiteWin = pairing.result === '1-0';
                    const isBlackWin = pairing.result === '0-1';
                    const isDraw = pairing.result === '1/2-1/2';
                    const isMyGame = pairing.white?.id === user?.id || pairing.black?.id === user?.id;

                    return (
                      <motion.div key={pairing.id}
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                        className={`card rounded-xl overflow-hidden transition-all
                          ${isMyGame ? 'border-amber-500/30 bg-amber-500/3' : ''}`}>
                        <div className="p-4">
                          <div className="flex items-center gap-2 mb-3 text-xs text-[var(--text-muted)]">
                            <span className="font-bold">Papan {pairing.board_number}</span>
                            <span className={`ml-auto font-bold ${res.color}`}>{res.label}</span>
                            {isMyGame && <span className="text-amber-400 font-bold">★ Kamu</span>}
                          </div>

                          <div className="flex items-center gap-3">
                            {/* White player */}
                            <div className={`flex-1 flex items-center gap-2 ${isWhiteWin ? 'opacity-100' : isBlackWin ? 'opacity-50' : ''}`}>
                              <div className="w-7 h-7 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                                {pairing.white?.username?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-[var(--text-primary)] truncate flex items-center gap-1">
                                  {pairing.white?.username || '?'}
                                  {isWhiteWin && <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                                </div>
                                <div className="text-xs text-[var(--text-muted)]">{pairing.white?.elo || '—'} ELO · Putih</div>
                              </div>
                            </div>

                            {/* VS / result center */}
                            <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                              <span className={`text-xs font-black ${res.color}`}>VS</span>
                              {pairing.result === null && pairing.game_id && (
                                <span className="text-[10px] text-amber-400 font-medium">Live</span>
                              )}
                              {isDraw && <span className="text-[10px] text-slate-400">Seri</span>}
                            </div>

                            {/* Black player */}
                            <div className={`flex-1 flex items-center gap-2 flex-row-reverse text-right ${isBlackWin ? 'opacity-100' : isWhiteWin ? 'opacity-50' : ''}`}>
                              <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0">
                                {pairing.black?.username?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-[var(--text-primary)] truncate flex items-center justify-end gap-1">
                                  {isBlackWin && <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                                  {pairing.black?.username || '?'}
                                </div>
                                <div className="text-xs text-[var(--text-muted)]">Hitam · {pairing.black?.elo || '—'} ELO</div>
                              </div>
                            </div>
                          </div>

                          {/* Game link */}
                          {pairing.game_id && (
                            <div className="mt-3 pt-3 border-t border-[var(--border)]">
                              <Link href={`/game?id=${pairing.game_id}`}
                                className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:underline font-medium">
                                {pairing.result === null ? (
                                  <><Zap className="w-3.5 h-3.5" /> Tonton / Mainkan</>
                                ) : (
                                  <><ExternalLink className="w-3.5 h-3.5" /> Lihat Partai</>
                                )}
                              </Link>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ── Standings tab ──────────────────────────────────── */}
          {activeTab === 'standings' && (
            <div className="card rounded-2xl overflow-hidden">
              {standings.length === 0 ? (
                <div className="p-12 text-center text-[var(--text-muted)]">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Belum ada pemain terdaftar</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="text-left px-4 py-3 text-xs text-[var(--text-muted)] font-semibold w-10">#</th>
                      <th className="text-left px-4 py-3 text-xs text-[var(--text-muted)] font-semibold">Pemain</th>
                      <th className="text-right px-4 py-3 text-xs text-[var(--text-muted)] font-semibold">Skor</th>
                      {standings[0]?.wins !== undefined && (
                        <th className="text-right px-4 py-3 text-xs text-[var(--text-muted)] font-semibold hidden sm:table-cell">W/D/L</th>
                      )}
                      {tournament.prize_pool > 0 && (
                        <th className="text-right px-4 py-3 text-xs text-[var(--text-muted)] font-semibold hidden md:table-cell">Hadiah</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((s, i) => {
                      const isMe = s.userId === user?.id;
                      const medals = ['🥇', '🥈', '🥉'];
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
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                                ${isMe ? 'bg-amber-500/20 text-amber-400' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}>
                                {s.user?.username?.[0]?.toUpperCase() || '?'}
                              </div>
                              <span className={`font-semibold truncate ${isMe ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>
                                {s.user?.username || '—'}
                                {isMe && <span className="ml-1 text-xs opacity-60">(kamu)</span>}
                              </span>
                              {s.user?.title && (
                                <span className="text-xs text-amber-400 font-bold hidden sm:inline">{s.user.title}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-black text-[var(--text-primary)]">
                            {scoreDisplay(s.score)}
                          </td>
                          {standings[0]?.wins !== undefined && (
                            <td className="px-4 py-3 text-right text-xs text-[var(--text-muted)] hidden sm:table-cell">
                              <span className="text-emerald-400">{s.wins || 0}</span>
                              {' / '}
                              <span className="text-slate-400">{s.draws || 0}</span>
                              {' / '}
                              <span className="text-red-400">{s.losses || 0}</span>
                            </td>
                          )}
                          {tournament.prize_pool > 0 && (
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
              )}
            </div>
          )}
        </motion.div>

        {/* ── Winner banner (finished) ───────────────────────────── */}
        {tournament.status === 'finished' && standings.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="rounded-2xl border border-yellow-500/30 bg-gradient-to-r from-yellow-800/20 to-amber-900/10 p-5">
            <div className="flex items-center gap-3">
              <Crown className="w-6 h-6 text-yellow-400 flex-shrink-0" />
              <div>
                <div className="text-xs text-yellow-500 font-bold uppercase tracking-wider mb-0.5">Juara Tournament</div>
                <div className="font-black text-[var(--text-primary)] text-lg">
                  {standings[0]?.user?.username || '—'}
                </div>
                <div className="text-sm text-[var(--text-muted)]">
                  Skor akhir: <span className="font-bold text-yellow-400">{scoreDisplay(standings[0]?.score || 0)}</span>
                  {tournament.prize_pool > 0 && standings[0]?.projectedPrize && (
                    <span> · Hadiah: <span className="font-bold text-yellow-400">Rp {standings[0].projectedPrize.toLocaleString('id-ID')}</span></span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

      </div>
    </AppLayout>
  );
}

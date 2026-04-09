'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  Trophy, ChevronRight, Zap, CheckCircle, Loader2,
  AlertCircle, Clock, Users, Ticket, Crown, TrendingUp,
  ArrowRight, Shield, Star
} from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface HourlyTier {
  id: string | null;
  name: string;
  entry_fee: number;
  max_players: number;
  time_control: { type: string; initial: number; increment: number; label: string };
  status: 'upcoming' | 'active' | 'finished';
  starts_at: string | null;
  ends_at: string | null;
  prize_pool: number;
  tier: 'bronze' | 'silver' | 'gold';
  registrations_count: number;
}

interface TierPlayer {
  id: string;
  user_id: string;
  paid: boolean;
  score: number;
  user: { id: string; username: string; elo: number; title?: string; country?: string };
}

// ── Hourly Countdown ──────────────────────────────────────────────────────────

type PhaseType = 'registering' | 'active' | 'idle';

function useHourlyPhase() {
  const [phase, setPhase] = useState<PhaseType>('idle');
  const [countdown, setCountdown] = useState('');
  const [phaseLabel, setPhaseLabel] = useState('');

  useEffect(() => {
    function update() {
      const now = new Date();
      const min = now.getMinutes();
      const sec = now.getSeconds();
      const totalSec = min * 60 + sec;

      let targetMs: number;
      let newPhase: PhaseType;
      let label: string;

      if (totalSec < 5 * 60) {
        const next = new Date(now);
        next.setMinutes(5, 0, 0);
        targetMs = next.getTime() - now.getTime();
        newPhase = 'registering';
        label = 'Registrasi Dibuka';
      } else if (totalSec < 55 * 60) {
        const next = new Date(now);
        next.setHours(next.getHours() + 1, 0, 0, 0);
        targetMs = next.getTime() - now.getTime();
        newPhase = 'active';
        label = 'Turnamen Sedang Berlangsung';
      } else {
        const next = new Date(now);
        next.setHours(next.getHours() + 1, 5, 0, 0);
        targetMs = next.getTime() - now.getTime();
        newPhase = 'registering';
        label = 'Registrasi Jam Berikutnya';
      }

      const totalMs = Math.max(0, targetMs);
      const m = Math.floor(totalMs / 60000);
      const s = Math.floor((totalMs % 60000) / 1000);
      setCountdown(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      setPhase(newPhase);
      setPhaseLabel(label);
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return { phase, countdown, phaseLabel };
}

// ── Tier config ───────────────────────────────────────────────────────────────

const TIER_META = {
  bronze: {
    label: 'Bronze',
    icon: '🥉',
    prizeColor: 'text-amber-600',
    accentColor: 'text-amber-500',
    borderActive: 'border-amber-600/50',
    borderIdle: 'border-[var(--border)]',
    badgeBg: 'bg-amber-900/40',
    badgeText: 'text-amber-500',
  },
  silver: {
    label: 'Silver',
    icon: '🥈',
    prizeColor: 'text-slate-300',
    accentColor: 'text-slate-300',
    borderActive: 'border-slate-400/50',
    borderIdle: 'border-[var(--border)]',
    badgeBg: 'bg-slate-700/40',
    badgeText: 'text-slate-300',
    featured: true,
  },
  gold: {
    label: 'Gold',
    icon: '🥇',
    prizeColor: 'text-yellow-400',
    accentColor: 'text-yellow-400',
    borderActive: 'border-yellow-500/50',
    borderIdle: 'border-[var(--border)]',
    badgeBg: 'bg-yellow-900/40',
    badgeText: 'text-yellow-400',
  },
} as const;

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TournamentPage() {
  const { user, token } = useAppStore();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'live' | 'finished'>('live');
  const [tournaments, setTournaments] = useState<ApiTournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [hourlyTiers, setHourlyTiers] = useState<HourlyTier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [tierPlayers, setTierPlayers] = useState<Record<string, TierPlayer[]>>({});
  const [joining, setJoining] = useState<string | null>(null);
  const [joined, setJoined] = useState<string[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [tiersError, setTiersError] = useState<string | null>(null);
  const [expandedTier, setExpandedTier] = useState<string | null>(null);

  const { phase, countdown, phaseLabel } = useHourlyPhase();

  useEffect(() => {
    setLoading(true);
    setListError(null);
    const statusParam = activeTab === 'live' ? 'active' : activeTab;
    api.tournament.list(statusParam)
      .then(data => setTournaments(data.tournaments || []))
      .catch(() => setListError('Daftar turnamen gagal dimuat.'))
      .finally(() => setLoading(false));
  }, [activeTab]);

  useEffect(() => {
    if (!token) return;
    api.tournament.myRegistrations(token)
      .then((data: { tournamentIds: string[] }) => setJoined(data.tournamentIds || []))
      .catch(() => {});
  }, [token]);

  const fetchHourlyTiers = useCallback(() => {
    setTiersLoading(true);
    setTiersError(null);
    api.tournament.upcomingHourly()
      .then(async (data: { tiers: HourlyTier[] }) => {
        const tiers = data.tiers || [];
        setHourlyTiers(tiers);

        // Fetch player list for each tier that has an ID
        const playerMap: Record<string, TierPlayer[]> = {};
        await Promise.all(
          tiers
            .filter(t => t.id)
            .map(t =>
              api.tournament.players(t.id!)
                .then((d: { players: TierPlayer[] }) => {
                  playerMap[t.id!] = d.players || [];
                })
                .catch(() => {})
            )
        );
        setTierPlayers(playerMap);
      })
      .catch(() => setTiersError('Tier turnamen jam ini gagal dimuat.'))
      .finally(() => setTiersLoading(false));
  }, []);

  useEffect(() => {
    fetchHourlyTiers();
    const interval = setInterval(fetchHourlyTiers, 60_000);
    return () => clearInterval(interval);
  }, [fetchHourlyTiers]);

  const handleJoin = async (t: ApiTournament | HourlyTier) => {
    if (!t.id) return;
    if (!token) { setJoinError('Harap login untuk bergabung'); return; }
    setJoining(t.id);
    setJoinError(null);
    try {
      await api.tournament.register(t.id, token);
      setJoined(prev => [...prev, t.id!]);
      setTournaments(prev => prev.map(x =>
        x.id === t.id ? { ...x, registrations_count: (x.registrations_count || 0) + 1 } : x
      ));
      setHourlyTiers(prev => prev.map(x =>
        x.id === t.id ? { ...x, registrations_count: x.registrations_count + 1 } : x
      ));
    } catch (err: unknown) {
      setJoinError(err instanceof Error ? err.message : 'Gagal bergabung');
    } finally {
      setJoining(null);
    }
  };

  const currentCount = (t: ApiTournament) => t.registrations_count ?? 0;
  const isFull = (t: ApiTournament) => t.max_players !== null && currentCount(t) >= t.max_players;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5">

        {/* ── Header ───────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-black text-[var(--text-primary)] flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-400" />
            Arena Turnamen
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">
            Turnamen catur kompetitif setiap jam — daftar, bertanding, raih hadiah
          </p>
        </motion.div>

        {/* ── How it works strip ────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}
          className="grid grid-cols-3 gap-3 text-center">
          {[
            { icon: <Ticket className="w-4 h-4" />, label: 'Beli Tiket', desc: 'Pilih tier sesuai kemampuan' },
            { icon: <Zap className="w-4 h-4" />, label: 'Bertanding', desc: 'Dimulai tiap jam tepat :05' },
            { icon: <Trophy className="w-4 h-4" />, label: 'Raih Hadiah', desc: 'Top 3 split 50/30/20' },
          ].map((s, i) => (
            <div key={i} className="card rounded-xl p-3 flex flex-col items-center gap-1.5">
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center">
                {s.icon}
              </div>
              <div className="text-xs font-bold text-[var(--text-primary)]">{s.label}</div>
              <div className="text-[10px] text-[var(--text-muted)] leading-tight">{s.desc}</div>
            </div>
          ))}
        </motion.div>

        {/* ── Live Countdown ────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
          className={`flex items-center justify-between px-5 py-4 rounded-xl border
            ${phase === 'active'
              ? 'bg-red-500/8 border-red-500/20'
              : 'bg-amber-500/8 border-amber-500/20'
            }`}>
          <div>
            <div className={`text-xs font-bold uppercase tracking-wider mb-0.5 flex items-center gap-1.5
              ${phase === 'active' ? 'text-red-400' : 'text-amber-400'}`}>
              <span className={`w-2 h-2 rounded-full animate-pulse ${phase === 'active' ? 'bg-red-400' : 'bg-amber-400'}`} />
              {phaseLabel}
            </div>
            <div className="text-sm text-[var(--text-secondary)]">
              {phase === 'active'
                ? 'Turnamen sedang berjalan — bergabung di ronde berikutnya'
                : 'Daftar sekarang sebelum slot habis!'}
            </div>
          </div>
          <div className={`text-4xl font-black font-mono tabular-nums flex-shrink-0
            ${phase === 'active' ? 'text-red-400' : 'text-amber-400'}`}>
            {countdown}
          </div>
        </motion.div>

        {/* ── Hourly Tier Lobbies ───────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <div className="flex items-center gap-2 mb-3">
            <Crown className="w-4 h-4 text-yellow-400" />
            <h2 className="font-bold text-[var(--text-primary)]">Turnamen Jam Ini</h2>
          </div>

          {tiersLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-28 rounded-xl bg-[var(--bg-hover)] animate-pulse" />
              ))}
            </div>
          ) : tiersError ? (
            <div className="card rounded-xl p-6 text-center text-[var(--text-muted)] text-sm">{tiersError}</div>
          ) : (
            <div className="space-y-3">
              {hourlyTiers.map((tier, i) => {
                const meta = TIER_META[tier.tier];
                const isJoined = tier.id ? joined.includes(tier.id) : false;
                const isTierFull = tier.max_players > 0 && tier.registrations_count >= tier.max_players;
                const fillPct = Math.min((tier.registrations_count / tier.max_players) * 100, 100);
                const players = tier.id ? (tierPlayers[tier.id] || []) : [];
                const isExpanded = expandedTier === tier.tier;
                const grossPrize = tier.id && tier.prize_pool > 0
                  ? tier.prize_pool
                  : tier.entry_fee * tier.max_players;
                const firstPrize = Math.floor(grossPrize * 0.96 * 0.5);

                return (
                  <motion.div key={tier.tier}
                    initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    className={`card rounded-xl overflow-hidden border transition-all
                      ${isJoined ? 'border-emerald-500/30' : tier.status === 'active' ? meta.borderActive : meta.borderIdle}`}>

                    {/* Main row */}
                    <div className="flex items-center gap-4 p-4">
                      {/* Tier badge */}
                      <div className="flex-shrink-0 text-center w-14">
                        <div className="text-2xl mb-0.5">{meta.icon}</div>
                        <div className={`text-[10px] font-black uppercase tracking-wider ${meta.accentColor}`}>
                          {meta.label}
                        </div>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-bold text-sm text-[var(--text-primary)]">
                            {tier.time_control?.label || '–'}
                          </span>
                          <span className="text-xs text-[var(--text-muted)] capitalize">{tier.time_control?.type}</span>
                          {tier.status === 'active' && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />LIVE
                            </span>
                          )}
                          {isJoined && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                              <CheckCircle className="w-2.5 h-2.5" />Terdaftar
                            </span>
                          )}
                        </div>

                        {/* Slot progress */}
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="flex-1 h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${
                              isTierFull ? 'bg-red-500' : fillPct > 75 ? 'bg-amber-400' : 'bg-emerald-500'
                            }`} style={{ width: `${fillPct}%` }} />
                          </div>
                          <span className="text-[10px] text-[var(--text-muted)] font-mono flex-shrink-0">
                            {tier.registrations_count}/{tier.max_players}
                          </span>
                        </div>

                        {/* Player avatars preview */}
                        {players.length > 0 && (
                          <button
                            onClick={() => setExpandedTier(isExpanded ? null : tier.tier)}
                            className="flex items-center gap-1.5 group">
                            <div className="flex -space-x-1.5">
                              {players.slice(0, 5).map(p => (
                                <div key={p.id}
                                  className="w-5 h-5 rounded-full bg-[var(--bg-hover)] border border-[var(--border)] flex items-center justify-center text-[9px] font-bold text-[var(--text-muted)]"
                                  title={p.user?.username}>
                                  {p.user?.username?.[0]?.toUpperCase() || '?'}
                                </div>
                              ))}
                              {players.length > 5 && (
                                <div className="w-5 h-5 rounded-full bg-[var(--bg-hover)] border border-[var(--border)] flex items-center justify-center text-[9px] font-bold text-[var(--text-muted)]">
                                  +{players.length - 5}
                                </div>
                              )}
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)] group-hover:text-amber-400 transition-colors">
                              {isExpanded ? 'Sembunyikan' : 'Lihat peserta'}
                            </span>
                          </button>
                        )}
                        {players.length === 0 && tier.id && (
                          <span className="text-[10px] text-[var(--text-muted)] italic">Belum ada peserta</span>
                        )}
                      </div>

                      {/* Prize + CTA */}
                      <div className="flex-shrink-0 text-right flex flex-col items-end gap-2">
                        <div>
                          <div className="text-[10px] text-[var(--text-muted)]">Tiket</div>
                          <div className="text-sm font-black text-[var(--text-primary)]">
                            {tier.entry_fee > 0 ? `Rp ${tier.entry_fee.toLocaleString('id-ID')}` : 'GRATIS'}
                          </div>
                        </div>
                        {firstPrize > 0 && (
                          <div>
                            <div className="text-[10px] text-[var(--text-muted)]">Juara 1</div>
                            <div className={`text-sm font-black ${meta.prizeColor}`}>
                              Rp {firstPrize.toLocaleString('id-ID')}
                            </div>
                          </div>
                        )}

                        {/* Action button */}
                        {!tier.id ? (
                          <div className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-hover)] px-3 py-1.5 rounded-lg border border-[var(--border)]">
                            Dibuka :55
                          </div>
                        ) : isJoined ? (
                          <Link href={`/tournament/${tier.id}`}
                            className="flex items-center gap-1 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg hover:bg-emerald-500/20 transition-colors">
                            Masuk Lobby <ArrowRight className="w-3 h-3" />
                          </Link>
                        ) : tier.status === 'active' ? (
                          <div className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg">
                            Sedang Live
                          </div>
                        ) : isTierFull ? (
                          <div className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-hover)] px-3 py-1.5 rounded-lg border border-[var(--border)]">
                            Slot Penuh
                          </div>
                        ) : (
                          <button
                            onClick={() => handleJoin(tier)}
                            disabled={joining === tier.id || !token}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg btn-gold text-black hover:opacity-90 transition-opacity disabled:opacity-40">
                            {joining === tier.id
                              ? <span className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                              : <Ticket className="w-3 h-3" />
                            }
                            {!token ? 'Login' : tier.entry_fee > 0 ? 'Beli Tiket' : 'Daftar'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded player list */}
                    <AnimatePresence>
                      {isExpanded && players.length > 0 && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden border-t border-[var(--border)]">
                          <div className="px-4 py-3 bg-[var(--bg-secondary)]">
                            <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                              {players.length} Peserta Terdaftar
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                              {players.map(p => {
                                const isMe = p.user_id === user?.id;
                                return (
                                  <div key={p.id}
                                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs
                                      ${isMe ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-[var(--bg-hover)]'}`}>
                                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0
                                      ${isMe ? 'bg-amber-500/20 text-amber-400' : 'bg-[var(--bg-card)] text-[var(--text-muted)]'}`}>
                                      {p.user?.username?.[0]?.toUpperCase() || '?'}
                                    </div>
                                    <span className={`font-medium truncate ${isMe ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}>
                                      {p.user?.username}
                                    </span>
                                    <span className="text-[var(--text-muted)] font-mono ml-auto flex-shrink-0">
                                      {p.user?.elo}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* ── Prize info ─────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}
          className="grid grid-cols-3 gap-3 text-center">
          {[
            { place: '🥇 Juara 1', pct: '50%', color: 'text-yellow-400' },
            { place: '🥈 Juara 2', pct: '30%', color: 'text-slate-300' },
            { place: '🥉 Juara 3', pct: '20%', color: 'text-amber-600' },
          ].map(p => (
            <div key={p.place} className="card rounded-xl py-3 px-2">
              <div className="text-sm mb-0.5">{p.place}</div>
              <div className={`text-xl font-black ${p.color}`}>{p.pct}</div>
              <div className="text-[10px] text-[var(--text-muted)]">dari net pool</div>
            </div>
          ))}
        </motion.div>

        {/* ── Join error ────────────────────────────────────────── */}
        <AnimatePresence>
          {joinError && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {joinError}
              <button onClick={() => setJoinError(null)} className="ml-auto text-red-400/60 hover:text-red-400">✕</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── All Tournaments ───────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-[var(--text-primary)]">Semua Turnamen</h2>
            <div className="flex p-1 bg-[var(--bg-hover)] rounded-xl gap-1">
              {(['live', 'upcoming', 'finished'] as const).map(t => (
                <button key={t} onClick={() => setActiveTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5
                    ${activeTab === t
                      ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}>
                  {t === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                  {t === 'live' ? 'Live' : t === 'upcoming' ? 'Mendatang' : 'Selesai'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
            </div>
          ) : tournaments.length === 0 ? (
            <div className="card rounded-xl p-12 text-center text-[var(--text-muted)]">
              <Trophy className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="font-medium text-sm">
                Tidak ada turnamen {activeTab === 'live' ? 'live' : activeTab === 'upcoming' ? 'mendatang' : 'yang selesai'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {tournaments.map((tournament, i) => {
                  const isLive = tournament.status === 'active';
                  const isFinished = tournament.status === 'finished';
                  const amJoined = joined.includes(tournament.id);
                  const full = isFull(tournament);

                  return (
                    <motion.div key={tournament.id}
                      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }} transition={{ delay: i * 0.05 }}
                      className={`card rounded-xl overflow-hidden border transition-all hover:border-[var(--accent)]/40
                        ${isLive ? 'border-red-500/20' : 'border-[var(--border)]'}`}>

                      <div className="flex items-center gap-4 p-4">
                        {/* Status dot */}
                        <div className="flex-shrink-0">
                          {isLive ? (
                            <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                              <Zap className="w-5 h-5 text-red-400" />
                            </div>
                          ) : isFinished ? (
                            <div className="w-10 h-10 rounded-xl bg-slate-500/10 flex items-center justify-center">
                              <Trophy className="w-5 h-5 text-slate-500" />
                            </div>
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                              <Clock className="w-5 h-5 text-amber-400" />
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <span className="font-bold text-sm text-[var(--text-primary)] truncate">{tournament.name}</span>
                            {isLive && (
                              <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full flex-shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />LIVE
                              </span>
                            )}
                            {amJoined && (
                              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full flex-shrink-0">
                                <CheckCircle className="w-2.5 h-2.5" />Terdaftar
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                            <span className="capitalize">{tournament.format}</span>
                            <span className="font-mono font-bold">{tournament.time_control?.label}</span>
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {currentCount(tournament)}{tournament.max_players ? `/${tournament.max_players}` : ''}
                            </span>
                            {tournament.prize_pool > 0 && (
                              <span className="text-yellow-400 font-bold">
                                Rp {tournament.prize_pool.toLocaleString('id-ID')}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Entry fee + CTA */}
                        <div className="flex-shrink-0 flex flex-col items-end gap-2">
                          <div className="text-right">
                            <div className="text-[10px] text-[var(--text-muted)]">Tiket</div>
                            <div className="text-sm font-black text-[var(--text-primary)]">
                              {tournament.entry_fee > 0
                                ? `Rp ${tournament.entry_fee.toLocaleString('id-ID')}`
                                : 'GRATIS'}
                            </div>
                          </div>

                          {isFinished ? (
                            <Link href={`/tournament/${tournament.id}`}
                              className="flex items-center gap-1 text-xs text-[var(--text-secondary)] border border-[var(--border)] px-3 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
                              Hasil <ChevronRight className="w-3 h-3" />
                            </Link>
                          ) : isLive ? (
                            amJoined ? (
                              <Link href={`/tournament/${tournament.id}`}
                                className="flex items-center gap-1 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg hover:bg-emerald-500/20 transition-colors">
                                Lihat <ArrowRight className="w-3 h-3" />
                              </Link>
                            ) : (
                              <Link href={`/tournament/${tournament.id}`}
                                className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg">
                                Tonton <ArrowRight className="w-3 h-3" />
                              </Link>
                            )
                          ) : (
                            amJoined ? (
                              <Link href={`/tournament/${tournament.id}`}
                                className="flex items-center gap-1 text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg hover:bg-amber-500/20 transition-colors">
                                Detail <ChevronRight className="w-3 h-3" />
                              </Link>
                            ) : (
                              <button onClick={() => handleJoin(tournament)}
                                disabled={joining === tournament.id || full}
                                className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg btn-gold text-black hover:opacity-90 disabled:opacity-40 transition-opacity">
                                {joining === tournament.id
                                  ? <span className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                  : <Trophy className="w-3 h-3" />
                                }
                                {full ? 'Penuh' : tournament.entry_fee > 0 ? 'Beli Tiket' : 'Daftar'}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
          {listError && <p className="mt-3 text-xs text-red-300">{listError}</p>}
        </div>
      </div>
    </AppLayout>
  );
}

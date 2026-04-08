'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, ChevronRight, Zap, CheckCircle, Loader2,
  AlertCircle, Clock, Users, Ticket, Crown, TrendingUp
} from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';

// ── Formatters ────────────────────────────────────────────────────────────────

function toPoints(n: number) {
  return `${Math.max(100, Math.floor(n / 1000))} PTS`;
}

function getTimeUntil(date: string) {
  const now = new Date();
  const target = new Date(date);
  const diff = target.getTime() - now.getTime();
  if (diff < 0) return 'Sudah Mulai';
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}h ${hours % 24}j`;
  if (hours > 0) return `${hours}j ${mins}m`;
  return `${mins} menit`;
}

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
        // :00 – :05 → registration open for this hour's tournament
        const next = new Date(now);
        next.setMinutes(5, 0, 0);
        targetMs = next.getTime() - now.getTime();
        newPhase = 'registering';
        label = 'Registrasi Dibuka — Turnamen Mulai Dalam';
      } else if (totalSec < 55 * 60) {
        // :05 – :55 → tournament active
        const next = new Date(now);
        next.setHours(next.getHours() + 1, 0, 0, 0);
        targetMs = next.getTime() - now.getTime();
        newPhase = 'active';
        label = 'Turnamen Berlangsung — Berakhir Dalam';
      } else {
        // :55 – :60 → registration for next hour
        const next = new Date(now);
        next.setHours(next.getHours() + 1, 5, 0, 0);
        targetMs = next.getTime() - now.getTime();
        newPhase = 'registering';
        label = 'Registrasi Dibuka — Turnamen Mulai Dalam';
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
    gradient: 'from-amber-900/40 to-amber-950/20',
    border: 'border-amber-700/30',
    accent: 'text-amber-500',
    badgeBg: 'bg-amber-700/20',
    badgeText: 'text-amber-500',
    glow: 'shadow-amber-900/20',
  },
  silver: {
    label: 'Silver',
    icon: '🥈',
    gradient: 'from-slate-600/30 to-slate-800/20',
    border: 'border-slate-500/30',
    accent: 'text-slate-300',
    badgeBg: 'bg-slate-500/20',
    badgeText: 'text-slate-300',
    glow: 'shadow-slate-800/30',
    featured: true,
  },
  gold: {
    label: 'Gold',
    icon: '🥇',
    gradient: 'from-yellow-800/30 to-yellow-950/20',
    border: 'border-yellow-600/30',
    accent: 'text-yellow-400',
    badgeBg: 'bg-yellow-600/20',
    badgeText: 'text-yellow-400',
    glow: 'shadow-yellow-900/20',
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
  const [joining, setJoining] = useState<string | null>(null);
  const [joined, setJoined] = useState<string[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [tiersError, setTiersError] = useState<string | null>(null);

  const { phase, countdown, phaseLabel } = useHourlyPhase();

  // Fetch tournament list
  useEffect(() => {
    setLoading(true);
    setListError(null);
    const statusParam = activeTab === 'live' ? 'active' : activeTab;
    api.tournament.list(statusParam)
      .then(data => setTournaments(data.tournaments || []))
      .catch(() => setListError('Daftar turnamen gagal dimuat.'))
      .finally(() => setLoading(false));
  }, [activeTab]);

  // Fetch hourly tiers
  const fetchHourlyTiers = useCallback(() => {
    setTiersLoading(true);
    setTiersError(null);
    api.tournament.upcomingHourly()
      .then((data: { tiers: HourlyTier[] }) => setHourlyTiers(data.tiers || []))
      .catch(() => setTiersError('Tier turnamen jam ini gagal dimuat.'))
      .finally(() => setTiersLoading(false));
  }, []);

  useEffect(() => {
    fetchHourlyTiers();
    // Refresh setiap 60 detik
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
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── Header ───────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)] flex items-center gap-2">
              <Trophy className="w-6 h-6 text-yellow-400" />
              Turnamen
            </h1>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">Turnamen otomatis setiap jam — bertanding &amp; naikkan peringkat esports</p>
          </div>
        </motion.div>

        {/* ── Countdown Banner ─────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className={`relative overflow-hidden rounded-2xl border p-5
            ${phase === 'active'
              ? 'bg-gradient-to-r from-red-500/15 to-orange-500/10 border-red-500/20'
              : 'bg-gradient-to-r from-amber-500/15 to-yellow-500/10 border-amber-500/20'
            }`}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
                ${phase === 'active' ? 'bg-red-500/20' : 'bg-amber-500/20'}`}>
                {phase === 'active'
                  ? <Zap className="w-5 h-5 text-red-400" />
                  : <Ticket className="w-5 h-5 text-amber-400" />
                }
              </div>
              <div>
                <div className={`text-xs font-bold uppercase tracking-wider mb-0.5
                  ${phase === 'active' ? 'text-red-400' : 'text-amber-400'}`}>
                  {phase === 'active' ? '● Live Sekarang' : '● Registrasi Dibuka'}
                </div>
                <div className="text-sm text-[var(--text-secondary)]">{phaseLabel}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className={`w-5 h-5 ${phase === 'active' ? 'text-red-400' : 'text-amber-400'}`} />
              <span className={`text-3xl font-black font-mono tabular-nums
                ${phase === 'active' ? 'text-red-400' : 'text-amber-400'}`}>
                {countdown}
              </span>
            </div>
          </div>
        </motion.div>

        {/* ── Hourly Tier Cards ─────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="flex items-center gap-2 mb-3">
            <Crown className="w-4 h-4 text-yellow-400" />
            <h2 className="font-bold text-[var(--text-primary)] text-sm">Turnamen Jam Ini</h2>
            <span className="text-xs text-[var(--text-muted)]">— pilih tier &amp; daftar sekarang</span>
          </div>

          {tiersLoading ? (
            <div className="grid md:grid-cols-3 gap-4">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-52 rounded-2xl bg-[var(--bg-hover)] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-4">
              {hourlyTiers.map((tier, i) => {
                const meta = TIER_META[tier.tier];
                const estPrize = tier.id
                  ? toPoints(Math.floor(tier.prize_pool * 0.8))
                  : toPoints(Math.floor(tier.entry_fee * tier.max_players * 0.8 * 0.8));
                const isJoined = tier.id ? joined.includes(tier.id) : false;
                const isTierFull = tier.max_players > 0 && tier.registrations_count >= tier.max_players;
                const canJoin = tier.id && !isJoined && !isTierFull && tier.status !== 'finished';

                return (
                  <motion.div key={tier.tier}
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                    className={`relative rounded-2xl border bg-gradient-to-b ${meta.gradient} ${meta.border}
                      ${'featured' in meta && meta.featured ? 'ring-1 ring-slate-500/20' : ''}
                      hover:-translate-y-0.5 transition-all shadow-lg ${meta.glow}`}>

                    {'featured' in meta && meta.featured && (
                      <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-[var(--bg-card)] border border-slate-500/30 rounded-full text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Populer
                      </div>
                    )}

                    <div className="p-5">
                      {/* Header */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{meta.icon}</span>
                          <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${meta.badgeBg} ${meta.badgeText}`}>
                            {meta.label}
                          </span>
                        </div>
                        {tier.status === 'active' && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                            LIVE
                          </span>
                        )}
                      </div>

                      {/* Stats */}
                      <div className="space-y-2 mb-4">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[var(--text-muted)]">Akses</span>
                          <span className="font-black text-[var(--text-primary)]">Gratis</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[var(--text-muted)]">Kontrol Waktu</span>
                          <span className="font-bold text-[var(--text-primary)] font-mono">{tier.time_control?.label || '–'}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[var(--text-muted)]">Pemain</span>
                          <span className="font-bold text-[var(--text-primary)]">
                            {tier.registrations_count}/{tier.max_players}
                            {isTierFull && <span className="ml-1 text-red-400 text-xs">FULL</span>}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[var(--text-muted)]">Reward Utama</span>
                          <span className={`font-black ${meta.accent}`}>{estPrize}</span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      {tier.max_players > 0 && (
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden mb-4">
                          <div className={`h-full rounded-full transition-all ${
                            isTierFull ? 'bg-red-500' : 'bg-gradient-to-r from-amber-500 to-yellow-500'
                          }`}
                            style={{ width: `${Math.min((tier.registrations_count / tier.max_players) * 100, 100)}%` }} />
                        </div>
                      )}

                      {/* CTA */}
                      {!tier.id ? (
                        <div className="w-full py-2 rounded-xl text-center text-xs text-[var(--text-muted)] bg-[var(--bg-hover)] border border-[var(--border)]">
                          Dibuka pukul :55
                        </div>
                      ) : isJoined ? (
                        <button className="w-full py-2 rounded-xl text-sm font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center gap-1.5">
                          <CheckCircle className="w-4 h-4" /> Terdaftar
                        </button>
                      ) : (
                        <button
                          onClick={() => handleJoin(tier)}
                          disabled={joining === tier.id || !canJoin || !token}
                          className="w-full py-2 rounded-xl text-sm font-bold transition-all
                            btn-gold text-black hover:opacity-90
                            disabled:opacity-40 flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20">
                          {joining === tier.id
                            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            : <Ticket className="w-4 h-4" />
                          }
                          {!token ? 'Masuk untuk Daftar' : 'Gabung Bracket'}
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
          {tiersError && <p className="mt-3 text-xs text-red-300">{tiersError}</p>}
        </motion.div>

        {/* ── Info strip ─────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="flex items-center gap-4 px-5 py-3 bg-[var(--bg-hover)] rounded-xl border border-[var(--border)] text-sm">
          <TrendingUp className="w-4 h-4 text-yellow-400 flex-shrink-0" />
          <span className="text-[var(--text-muted)]">
            Sistem kompetitif skill-based: hasil pertandingan memengaruhi&nbsp;
            <span className="text-yellow-400 font-semibold">ranking</span>,&nbsp;
            <span className="text-slate-300 font-semibold">badge</span>, dan&nbsp;
            <span className="text-[var(--text-muted)] font-medium">ELO</span> pemain.
          </span>
        </motion.div>

        {/* ── Join error ────────────────────────────────────────── */}
        {joinError && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {joinError}
            <button onClick={() => setJoinError(null)} className="ml-auto text-red-400/60 hover:text-red-400">✕</button>
          </motion.div>
        )}

        {/* ── Tabs ─────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-[var(--text-primary)]">Semua Turnamen</h2>
            <div className="flex p-1 bg-[var(--bg-hover)] rounded-xl gap-1">
              {(['live', 'upcoming', 'finished'] as const).map(t => (
                <button key={t} onClick={() => setActiveTab(t)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5
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

          {/* Tournament cards */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
            </div>
          ) : tournaments.length === 0 ? (
            <div className="card rounded-2xl p-12 text-center text-[var(--text-muted)]">
              <Trophy className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="font-medium text-sm">Tidak ada turnamen {activeTab === 'live' ? 'live' : activeTab === 'upcoming' ? 'mendatang' : 'yang selesai'}</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <AnimatePresence>
                {tournaments.map((tournament, i) => (
                  <motion.div key={tournament.id}
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }} transition={{ delay: i * 0.07 }}
                    className="card rounded-2xl overflow-hidden hover:border-[var(--accent)]/50 transition-all">

                    {/* Card header */}
                    <div className={`relative overflow-hidden px-5 py-4
                      ${tournament.status === 'active'
                        ? 'bg-gradient-to-r from-red-500/10 to-orange-500/10'
                        : tournament.status === 'upcoming'
                        ? 'bg-gradient-to-r from-amber-500/10 to-yellow-500/10'
                        : 'bg-gradient-to-r from-slate-500/8 to-gray-500/8'
                      }`}>
                      {tournament.status === 'active' && (
                        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                          LIVE
                        </div>
                      )}
                      <div className="pr-16">
                        <h3 className="font-bold text-[var(--text-primary)] mb-1">{tournament.name}</h3>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)] capitalize font-medium">
                            {tournament.format}
                          </span>
                          {tournament.time_control?.label && (
                            <span className="text-xs font-mono font-bold text-[var(--text-secondary)]">
                              {tournament.time_control.label}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Card body */}
                    <div className="p-5">
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div>
                          <div className="text-xs text-[var(--text-muted)] mb-0.5">Reward Pool</div>
                          <div className="text-xl font-black text-yellow-400">{toPoints(tournament.prize_pool)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-muted)] mb-0.5">Akses</div>
                          <div className="text-xl font-black text-[var(--text-primary)]">
                            GRATIS
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-muted)] mb-1">Pemain</div>
                          <div className="flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                            <span className="text-sm font-bold text-[var(--text-primary)]">
                              {currentCount(tournament)}{tournament.max_players ? `/${tournament.max_players}` : ''}
                            </span>
                            {tournament.max_players && (
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${isFull(tournament) ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                {isFull(tournament) ? 'FULL' : `${tournament.max_players - currentCount(tournament)} slot`}
                              </span>
                            )}
                          </div>
                          {tournament.max_players && (
                            <div className="mt-1.5 h-1 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-600 rounded-full transition-all"
                                style={{ width: `${Math.min((currentCount(tournament) / tournament.max_players) * 100, 100)}%` }} />
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-xs text-[var(--text-muted)] mb-0.5">
                            {tournament.status === 'finished' ? 'Status' : tournament.status === 'active' ? 'Dimulai' : 'Mulai Dalam'}
                          </div>
                          <div className={`text-sm font-bold ${tournament.status === 'active' ? 'text-red-400' : tournament.status === 'finished' ? 'text-slate-400' : 'text-amber-400'}`}>
                            {tournament.status === 'finished' ? 'Selesai' :
                             tournament.status === 'active' ? '● Live Sekarang' :
                             getTimeUntil(tournament.starts_at)}
                          </div>
                        </div>
                      </div>

                      {/* Prize distribution */}
                      {tournament.prize_pool > 0 && (
                        <div className="mb-4 p-3 bg-[var(--bg-hover)] rounded-xl">
                          <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Distribusi Reward</div>
                          <div className="flex gap-3">
                            {[
                              { place: '1st', pct: tournament.prize_distribution?.['1'] ?? 0.80, color: 'text-yellow-400' },
                              { place: '2nd', pct: tournament.prize_distribution?.['2'] ?? 0.10, color: 'text-slate-300' },
                            ].map(p => (
                              <div key={p.place} className="flex-1 text-center">
                                <div className={`text-xs font-bold ${p.color}`}>{p.place}</div>
                                <div className="text-sm font-black text-[var(--text-primary)]">
                                  {toPoints(Math.floor(tournament.prize_pool * p.pct))}
                                </div>
                                <div className="text-xs text-[var(--text-muted)]">{Math.round(p.pct * 100)}%</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action */}
                      {tournament.status === 'finished' ? (
                        <button className="w-full py-2.5 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--bg-hover)] transition-colors flex items-center justify-center gap-2">
                          Lihat Hasil <ChevronRight className="w-4 h-4" />
                        </button>
                      ) : tournament.status === 'active' ? (
                        joined.includes(tournament.id) ? (
                          <button className="w-full py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-semibold flex items-center justify-center gap-2">
                            <CheckCircle className="w-4 h-4" /> Sudah Bergabung — Lihat Bracket
                          </button>
                        ) : (
                          <button onClick={() => handleJoin(tournament)}
                            disabled={joining === tournament.id}
                            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-orange-500 text-white text-sm font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-lg shadow-red-500/20 disabled:opacity-60">
                            {joining === tournament.id ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Zap className="w-4 h-4" />}
                            Gabung Turnamen Live
                          </button>
                        )
                      ) : (
                        joined.includes(tournament.id) ? (
                          <button className="w-full py-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 text-sm font-semibold flex items-center justify-center gap-2">
                            <CheckCircle className="w-4 h-4" /> Terdaftar
                          </button>
                        ) : (
                          <button onClick={() => handleJoin(tournament)}
                            disabled={joining === tournament.id || isFull(tournament)}
                            className="w-full py-2.5 rounded-xl btn-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
                            {joining === tournament.id ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Trophy className="w-4 h-4" />}
                            Daftar — GRATIS
                          </button>
                        )
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
          {listError && <p className="mt-3 text-xs text-red-300">{listError}</p>}
        </div>
      </div>
    </AppLayout>
  );
}

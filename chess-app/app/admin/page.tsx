'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Shield, Users, AlertTriangle, GitBranch,
  CheckCircle, XCircle, Clock, RefreshCw,
  ChevronDown, ChevronUp, Eye, Ban, UserCheck,
  Activity, Lock, Zap
} from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────
interface AdminStats {
  totalFlagged: number; pendingAppeals: number;
  unreviewedCollusion: number; unreviewedMultiAccount: number;
  recentSuspends7d: number; securityEventsToday: number;
}
interface FlaggedUser {
  id: string; username: string; email: string; elo: number;
  trust_score: number; flagged: boolean; flagged_reason: string;
  flagged_at: string; recentActions: Array<{ action: string; reason: string; score: number; created_at: string }>;
}
interface CollusionFlag {
  id: string; pair_flags: string; gift_flags: string; pair_score: number;
  pair_stats: string; detected_at: string;
  userA: { id: string; username: string; elo: number; trust_score: number };
  userB: { id: string; username: string; elo: number; trust_score: number };
  game: { id: string } | null;
}
interface MultiAccountFlag {
  id: string; fingerprint_hash: string; detected_at: string;
  userA: { id: string; username: string; email: string; elo: number };
  userB: { id: string; username: string; email: string; elo: number };
}
interface Appeal {
  id: string; reason: string; status: string; admin_note: string;
  created_at: string; reviewed_at: string; flag_reason_at: string; trust_at: number;
  users: { id: string; username: string; email: string; elo: number; trust_score: number; flagged: boolean };
}
interface SecurityEvent {
  id: string; event_type: string; user_id: string; details: string; created_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmtDate = (s: string) => s ? new Date(s).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function TrustBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-mono font-bold ${color}`}>{score}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    pending:  { label: 'Pending',  cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
    approved: { label: 'Approved', cls: 'bg-green-500/20 text-green-300 border-green-500/40' },
    rejected: { label: 'Rejected', cls: 'bg-red-500/20 text-red-300 border-red-500/40' },
  };
  const c = cfg[status] || { label: status, cls: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs border font-medium ${c.cls}`}>{c.label}</span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
type Tab = 'overview' | 'flagged' | 'collusion' | 'multiAccount' | 'appeals' | 'events';

export default function AdminPage() {
  const router                 = useRouter();
  const { user, token }        = useAppStore();
  const [tab, setTab]          = useState<Tab>('overview');
  const [loading, setLoading]  = useState(true);
  const [stats, setStats]      = useState<AdminStats | null>(null);
  const [flagged, setFlagged]  = useState<FlaggedUser[]>([]);
  const [collusion, setCollusion] = useState<CollusionFlag[]>([]);
  const [multiAcc, setMultiAcc]   = useState<MultiAccountFlag[]>([]);
  const [appeals, setAppeals]     = useState<Appeal[]>([]);
  const [events, setEvents]       = useState<SecurityEvent[]>([]);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const showMsg = (text: string, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3500);
  };

  const loadStats = useCallback(async () => {
    if (!token) return;
    try {
      const s = await api.admin.stats(token);
      setStats(s);
    } catch { /* not admin */ }
  }, [token]);

  const loadTab = useCallback(async (t: Tab) => {
    if (!token) return;
    setLoading(true);
    try {
      if (t === 'overview')     await loadStats();
      if (t === 'flagged')      { const d = await api.admin.flaggedUsers(token); setFlagged(d.users || []); }
      if (t === 'collusion')    { const d = await api.admin.collusionFlags(token); setCollusion(d.flags || []); }
      if (t === 'multiAccount') { const d = await api.admin.multiAccountFlags(token); setMultiAcc(d.flags || []); }
      if (t === 'appeals')      { const d = await api.admin.appeals(token, 'all'); setAppeals(d.appeals || []); }
      if (t === 'events')       { const d = await api.admin.securityEvents(token); setEvents(d.events || []); }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('Admin access')) {
        router.replace('/dashboard');
      }
    } finally {
      setLoading(false);
    }
  }, [token, loadStats, router]);

  useEffect(() => {
    if (!user || !token) { router.replace('/'); return; }
    loadStats();
    loadTab('overview');
  }, [user, token, router, loadStats, loadTab]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  // ── User Review Actions ────────────────────────────────────────────────
  async function handleUserAction(userId: string, action: string, newTrust?: number) {
    if (!token) return;
    setActionLoading(userId + action);
    try {
      await api.admin.reviewUser(token, userId, { action, note: reviewNote, newTrust });
      showMsg(`✅ Action "${action}" applied`);
      setReviewNote('');
      await loadTab('flagged');
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Failed'}`, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAppealReview(id: string, verdict: 'approved' | 'rejected', restoreTrust?: number) {
    if (!token) return;
    setActionLoading(id);
    try {
      await api.admin.reviewAppeal(token, id, { verdict, note: reviewNote, restoreTrust });
      showMsg(`✅ Appeal ${verdict}`);
      setReviewNote('');
      await loadTab('appeals');
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Failed'}`, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCollusionReview(id: string, verdict: 'confirmed' | 'dismissed') {
    if (!token) return;
    setActionLoading(id);
    try {
      await api.admin.reviewCollusion(token, id, { verdict, note: reviewNote });
      showMsg(`✅ Collusion flag ${verdict}`);
      setReviewNote('');
      await loadTab('collusion');
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Failed'}`, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMultiAccReview(id: string, verdict: 'confirmed' | 'dismissed') {
    if (!token) return;
    setActionLoading(id);
    try {
      await api.admin.reviewMultiAccount(token, id, { verdict, note: reviewNote });
      showMsg(`✅ Multi-account flag ${verdict}`);
      setReviewNote('');
      await loadTab('multiAccount');
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Failed'}`, false);
    } finally {
      setActionLoading(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const TABS: { key: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'overview',     label: 'Overview',       icon: <Shield size={15} /> },
    { key: 'flagged',      label: 'Flagged Users',  icon: <Users size={15} />,       badge: stats?.totalFlagged },
    { key: 'collusion',    label: 'Collusion',      icon: <GitBranch size={15} />,   badge: stats?.unreviewedCollusion },
    { key: 'multiAccount', label: 'Multi-Account',  icon: <Lock size={15} />,        badge: stats?.unreviewedMultiAccount },
    { key: 'appeals',      label: 'Appeals',        icon: <AlertTriangle size={15} />, badge: stats?.pendingAppeals },
    { key: 'events',       label: 'Security Log',   icon: <Activity size={15} /> },
  ];

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center">
            <Shield size={20} className="text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Anti-Cheat Admin Dashboard</h1>
            <p className="text-sm text-[var(--text-muted)]">Review flagged players, appeals, and security events</p>
          </div>
          <button onClick={() => loadTab(tab)}
            className="ml-auto p-2 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors">
            <RefreshCw size={16} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Toast */}
        {msg && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border ${
            msg.ok ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}>{msg.text}</div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-[var(--bg-secondary)] rounded-xl p-1 flex-wrap">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.key
                  ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]'
              }`}>
              {t.icon}{t.label}
              {(t.badge ?? 0) > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading && tab !== 'overview' ? (
          <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
            <RefreshCw size={20} className="animate-spin mr-2" /> Loading…
          </div>
        ) : (

          <>
            {/* ── Overview ─────────────────────────────────────────────── */}
            {tab === 'overview' && stats && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: 'Flagged Users',      value: stats.totalFlagged,          icon: <Users size={18} />,        color: 'red' },
                  { label: 'Pending Appeals',     value: stats.pendingAppeals,        icon: <AlertTriangle size={18} />, color: 'yellow' },
                  { label: 'Unrev. Collusion',    value: stats.unreviewedCollusion,   icon: <GitBranch size={18} />,    color: 'orange' },
                  { label: 'Unrev. Multi-Acc.',   value: stats.unreviewedMultiAccount,icon: <Lock size={18} />,         color: 'purple' },
                  { label: 'Suspends (7d)',        value: stats.recentSuspends7d,      icon: <Ban size={18} />,          color: 'red' },
                  { label: 'Sec. Events Today',   value: stats.securityEventsToday,   icon: <Zap size={18} />,          color: 'blue' },
                ].map(({ label, value, icon, color }) => (
                  <div key={label}
                    className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-2">
                    <div className={`text-${color}-400`}>{icon}</div>
                    <div className="text-2xl font-bold text-[var(--text-primary)]">{value}</div>
                    <div className="text-xs text-[var(--text-muted)]">{label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Flagged Users ────────────────────────────────────────── */}
            {tab === 'flagged' && (
              <div className="space-y-3">
                {flagged.length === 0 && (
                  <div className="text-center py-12 text-[var(--text-muted)]">No flagged users</div>
                )}
                {flagged.map(u => (
                  <div key={u.id} className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl overflow-hidden">
                    {/* Row */}
                    <div className="flex items-center gap-4 p-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[var(--text-primary)]">{u.username}</span>
                          <span className="text-xs text-[var(--text-muted)]">ELO {u.elo}</span>
                          <span className="text-xs text-[var(--text-muted)]">Trust: <TrustBadge score={u.trust_score} /></span>
                        </div>
                        <div className="text-xs text-red-400 mt-0.5 truncate">{u.flagged_reason}</div>
                        <div className="text-xs text-[var(--text-muted)]">Flagged: {fmtDate(u.flagged_at)}</div>
                      </div>
                      <button onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                        className="p-2 hover:bg-[var(--bg-primary)] rounded-lg transition-colors text-[var(--text-muted)]">
                        {expandedUser === u.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>

                    {/* Expanded */}
                    {expandedUser === u.id && (
                      <div className="border-t border-[var(--border)] p-4 bg-[var(--bg-primary)]">
                        {/* Recent actions */}
                        {u.recentActions.length > 0 && (
                          <div className="mb-4">
                            <div className="text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wide">
                              Recent Anticheat Actions
                            </div>
                            <div className="space-y-1">
                              {u.recentActions.map((a, i) => (
                                <div key={i} className="text-xs text-[var(--text-muted)] flex gap-2">
                                  <span className="font-semibold text-yellow-400">{a.action}</span>
                                  <span className="truncate">{a.reason}</span>
                                  <span className="text-[var(--text-muted)] ml-auto">{fmtDate(a.created_at)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Review note */}
                        <textarea
                          placeholder="Admin note (optional)…"
                          value={reviewNote}
                          onChange={e => setReviewNote(e.target.value)}
                          className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] resize-none h-16 mb-3"
                        />

                        {/* Actions */}
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleUserAction(u.id, 'dismiss', 80)}
                            disabled={actionLoading === u.id + 'dismiss'}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                            <UserCheck size={13} /> Dismiss Flag
                          </button>
                          <button
                            onClick={() => handleUserAction(u.id, 'confirm_suspend')}
                            disabled={actionLoading === u.id + 'confirm_suspend'}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                            <Ban size={13} /> Confirm Suspend
                          </button>
                          <button
                            onClick={() => handleUserAction(u.id, 'unsuspend', 65)}
                            disabled={actionLoading === u.id + 'unsuspend'}
                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                            <CheckCircle size={13} /> Unsuspend (Trust 65)
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Collusion Flags ───────────────────────────────────────── */}
            {tab === 'collusion' && (
              <div className="space-y-3">
                {collusion.length === 0 && (
                  <div className="text-center py-12 text-[var(--text-muted)]">No unreviewed collusion flags</div>
                )}
                {collusion.map(f => {
                  const pf = (() => { try { return JSON.parse(f.pair_flags || '[]'); } catch { return []; } })();
                  const gf = (() => { try { return JSON.parse(f.gift_flags || '[]'); } catch { return []; } })();
                  const ps = (() => { try { return JSON.parse(f.pair_stats || '{}'); } catch { return {}; } })();
                  return (
                    <div key={f.id} className="bg-[var(--bg-secondary)] border border-orange-500/20 rounded-xl p-4">
                      <div className="flex items-start gap-4">
                        <GitBranch size={18} className="text-orange-400 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex gap-3 items-center mb-1">
                            <span className="font-semibold text-[var(--text-primary)]">{f.userA?.username}</span>
                            <span className="text-[var(--text-muted)] text-xs">vs</span>
                            <span className="font-semibold text-[var(--text-primary)]">{f.userB?.username}</span>
                            <span className="ml-auto text-xs text-[var(--text-muted)]">{fmtDate(f.detected_at)}</span>
                          </div>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {[...pf, ...gf].map((fl: string, i: number) => (
                              <span key={i} className="px-2 py-0.5 bg-orange-500/20 text-orange-300 border border-orange-500/30 rounded text-xs">{fl}</span>
                            ))}
                          </div>
                          {ps.gameCount && (
                            <div className="text-xs text-[var(--text-muted)]">
                              {ps.gameCount} games together — A wins: {ps.aWins}, B wins: {ps.bWins}, Draws: {ps.draws}
                            </div>
                          )}
                          <div className="text-xs text-[var(--text-muted)] mt-1">Pair score: {f.pair_score}</div>

                          <textarea
                            placeholder="Admin note…"
                            value={actionLoading === f.id ? reviewNote : reviewNote}
                            onChange={e => setReviewNote(e.target.value)}
                            className="w-full mt-3 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] resize-none h-14"
                          />
                          <div className="flex gap-2 mt-2">
                            <button onClick={() => handleCollusionReview(f.id, 'confirmed')}
                              disabled={actionLoading === f.id}
                              className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium">
                              <Ban size={13} /> Confirm Collusion
                            </button>
                            <button onClick={() => handleCollusionReview(f.id, 'dismissed')}
                              disabled={actionLoading === f.id}
                              className="flex items-center gap-1 px-3 py-1.5 bg-zinc-500/20 hover:bg-zinc-500/30 text-zinc-300 border border-zinc-500/30 rounded-lg text-xs font-medium">
                              <XCircle size={13} /> Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Multi-Account Flags ───────────────────────────────────── */}
            {tab === 'multiAccount' && (
              <div className="space-y-3">
                {multiAcc.length === 0 && (
                  <div className="text-center py-12 text-[var(--text-muted)]">No unreviewed multi-account flags</div>
                )}
                {multiAcc.map(f => (
                  <div key={f.id} className="bg-[var(--bg-secondary)] border border-purple-500/20 rounded-xl p-4">
                    <div className="flex items-start gap-4">
                      <Lock size={18} className="text-purple-400 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="flex gap-3 items-center mb-1">
                          <span className="font-semibold">{f.userA?.username}</span>
                          <span className="text-xs text-[var(--text-muted)]">{f.userA?.email}</span>
                          <span className="text-[var(--text-muted)]">+</span>
                          <span className="font-semibold">{f.userB?.username}</span>
                          <span className="text-xs text-[var(--text-muted)]">{f.userB?.email}</span>
                          <span className="ml-auto text-xs text-[var(--text-muted)]">{fmtDate(f.detected_at)}</span>
                        </div>
                        <div className="text-xs text-[var(--text-muted)] mb-3">
                          Fingerprint: <code className="text-purple-400">{f.fingerprint_hash}</code>
                        </div>
                        <textarea
                          placeholder="Admin note…"
                          onChange={e => setReviewNote(e.target.value)}
                          className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] resize-none h-14"
                        />
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => handleMultiAccReview(f.id, 'confirmed')}
                            disabled={actionLoading === f.id}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/30">
                            <Ban size={13} /> Confirm Multi-Acc
                          </button>
                          <button onClick={() => handleMultiAccReview(f.id, 'dismissed')}
                            disabled={actionLoading === f.id}
                            className="flex items-center gap-1 px-3 py-1.5 bg-zinc-500/20 text-zinc-300 border border-zinc-500/30 rounded-lg text-xs font-medium hover:bg-zinc-500/30">
                            <XCircle size={13} /> Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Appeals ───────────────────────────────────────────────── */}
            {tab === 'appeals' && (
              <div className="space-y-3">
                {appeals.length === 0 && (
                  <div className="text-center py-12 text-[var(--text-muted)]">No appeals</div>
                )}
                {appeals.map(a => (
                  <div key={a.id} className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4">
                    <div className="flex items-start gap-4">
                      <AlertTriangle size={18} className="text-yellow-400 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{a.users?.username}</span>
                          <span className="text-xs text-[var(--text-muted)]">ELO {a.users?.elo}</span>
                          <StatusBadge status={a.status} />
                          <span className="ml-auto text-xs text-[var(--text-muted)]">{fmtDate(a.created_at)}</span>
                        </div>
                        <div className="text-xs text-red-400 mb-2">Flag reason: {a.flag_reason_at || '—'}</div>
                        <div className="bg-[var(--bg-primary)] rounded-lg p-3 text-sm text-[var(--text-primary)] mb-3 border border-[var(--border)]">
                          {a.reason}
                        </div>
                        {a.admin_note && (
                          <div className="text-xs text-[var(--text-muted)] mb-2">
                            Admin note: {a.admin_note}
                          </div>
                        )}
                        {a.status === 'pending' && (
                          <>
                            <textarea
                              placeholder="Admin response…"
                              onChange={e => setReviewNote(e.target.value)}
                              className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] resize-none h-16 mb-2"
                            />
                            <div className="flex flex-wrap gap-2">
                              <button onClick={() => handleAppealReview(a.id, 'approved', 75)}
                                disabled={actionLoading === a.id}
                                className="flex items-center gap-1 px-3 py-1.5 bg-green-500/20 text-green-300 border border-green-500/30 rounded-lg text-xs font-medium hover:bg-green-500/30">
                                <CheckCircle size={13} /> Approve (Trust 75)
                              </button>
                              <button onClick={() => handleAppealReview(a.id, 'approved', 60)}
                                disabled={actionLoading === a.id}
                                className="flex items-center gap-1 px-3 py-1.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-medium hover:bg-blue-500/30">
                                <CheckCircle size={13} /> Approve (Trust 60)
                              </button>
                              <button onClick={() => handleAppealReview(a.id, 'rejected')}
                                disabled={actionLoading === a.id}
                                className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/30">
                                <XCircle size={13} /> Reject Appeal
                              </button>
                            </div>
                          </>
                        )}
                        {a.reviewed_at && (
                          <div className="text-xs text-[var(--text-muted)] mt-2">
                            Reviewed: {fmtDate(a.reviewed_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Security Events ───────────────────────────────────────── */}
            {tab === 'events' && (
              <div className="space-y-2">
                {events.length === 0 && (
                  <div className="text-center py-12 text-[var(--text-muted)]">No security events</div>
                )}
                {events.map(e => {
                  const det = (() => { try { return JSON.parse(e.details || '{}'); } catch { return {}; } })();
                  const typeColor: Record<string, string> = {
                    RATE_LIMIT_HIT:          'text-yellow-400',
                    INVALID_MOVE_TOKEN:      'text-red-400',
                    NO_TOKEN_ISSUED:         'text-red-400',
                    MULTI_TAB_ATTEMPT:       'text-orange-400',
                    UNAUTHORIZED_MOVE_ATTEMPT:'text-red-400',
                    MULTI_ACCOUNT_DETECTED:  'text-purple-400',
                    REALTIME_SUSPICIOUS:     'text-orange-400',
                  };
                  return (
                    <div key={e.id} className="flex items-center gap-3 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-4 py-2.5">
                      <span className={`text-xs font-mono font-semibold w-52 shrink-0 ${typeColor[e.event_type] || 'text-[var(--text-muted)]'}`}>
                        {e.event_type}
                      </span>
                      <span className="text-xs text-[var(--text-muted)] truncate flex-1">
                        {det.userId || e.user_id || '—'} · {det.gameId ? `game:${det.gameId.slice(0, 8)}` : ''}
                      </span>
                      <span className="text-xs text-[var(--text-muted)] shrink-0">{fmtDate(e.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

      </div>
    </AppLayout>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Shield, Users, AlertTriangle, GitBranch,
  CheckCircle, XCircle, Clock, RefreshCw,
  ChevronDown, ChevronUp, Ban, UserCheck,
  Activity, Lock, Zap, Wallet, ArrowDownLeft, ArrowUpRight, Building2, ExternalLink
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
interface ManualDeposit {
  id: string; amount: number; unique_code: number; transfer_amount: number;
  proof_url: string | null; status: string; admin_note: string | null;
  created_at: string; reviewed_at: string | null;
  users: { id: string; username: string; email: string } | null;
}
interface ManualWithdrawal {
  id: string; amount: number; bank_name: string; account_number: string; account_name: string;
  status: string; admin_note: string | null; created_at: string; reviewed_at: string | null;
  users: { id: string; username: string; email: string } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmtDate = (s: string) => s ? new Date(s).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '—';

// ── Payment sub-components ─────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Pending',    cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
  approved:  { label: 'Disetujui', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  completed: { label: 'Selesai',   cls: 'bg-green-500/20 text-green-300 border-green-500/40' },
  rejected:  { label: 'Ditolak',   cls: 'bg-red-500/20 text-red-300 border-red-500/40' },
};

function PayStatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] || { label: status, cls: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40' };
  return <span className={`px-2 py-0.5 rounded-full text-xs border font-medium ${c.cls}`}>{c.label}</span>;
}

function fmtIDR(n: number) {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function DepositCard({
  deposit, actionLoading, onApprove, onReject,
}: {
  deposit: ManualDeposit;
  actionLoading: string | null;
  onApprove: () => void;
  onReject: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const busy = actionLoading === deposit.id + 'approve' || actionLoading === deposit.id + 'reject';
  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-500/10 flex items-center justify-center flex-shrink-0">
            <Building2 size={16} className="text-sky-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[var(--text-primary)] text-sm">{deposit.users?.username || '—'}</span>
              <span className="text-xs text-[var(--text-muted)]">{deposit.users?.email}</span>
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-0.5">
              Transfer: <span className="font-mono font-semibold text-sky-400">{fmtIDR(deposit.transfer_amount)}</span>
              <span className="mx-1">·</span>
              Nominal: {fmtIDR(deposit.amount)}
              <span className="mx-1">·</span>
              Kode: <span className="font-mono text-yellow-400">{String(deposit.unique_code).padStart(3, '0')}</span>
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {new Date(deposit.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
          </div>
        </div>
        <PayStatusBadge status={deposit.status} />
      </div>

      {deposit.proof_url ? (
        <a href={deposit.proof_url} target="_blank" rel="noreferrer"
          className="flex items-center gap-2 text-xs text-sky-400 hover:text-sky-300 transition-colors">
          <ExternalLink size={12} /> Lihat bukti transfer
        </a>
      ) : (
        <p className="text-xs text-yellow-500">Bukti transfer belum diupload</p>
      )}

      {deposit.status === 'pending' && (
        <div className="space-y-2 pt-1 border-t border-[var(--border)]">
          <textarea
            placeholder="Catatan admin (opsional)…"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] resize-none h-12"
          />
          <div className="flex gap-2">
            <button onClick={onApprove} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors">
              <CheckCircle size={13} /> Setujui & Kredit Saldo
            </button>
            <button onClick={() => onReject(note)} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors">
              <XCircle size={13} /> Tolak
            </button>
          </div>
        </div>
      )}

      {deposit.admin_note && (
        <p className="text-xs text-[var(--text-muted)]">Note: {deposit.admin_note}</p>
      )}
    </div>
  );
}

function WithdrawalCard({
  withdrawal, actionLoading, onApprove, onComplete, onReject,
}: {
  withdrawal: ManualWithdrawal;
  actionLoading: string | null;
  onApprove: (note: string) => void;
  onComplete: (note: string) => void;
  onReject: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const busy = actionLoading?.startsWith(withdrawal.id);
  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
            <ArrowUpRight size={16} className="text-orange-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[var(--text-primary)] text-sm">{withdrawal.users?.username || '—'}</span>
              <span className="text-xs text-[var(--text-muted)]">{withdrawal.users?.email}</span>
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-0.5">
              <span className="font-semibold text-orange-400">{fmtIDR(withdrawal.amount)}</span>
              <span className="mx-1">→</span>
              <span className="font-mono">{withdrawal.bank_name} {withdrawal.account_number}</span>
              <span className="mx-1">a.n.</span>
              <span className="font-semibold text-[var(--text-primary)]">{withdrawal.account_name}</span>
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {new Date(withdrawal.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
          </div>
        </div>
        <PayStatusBadge status={withdrawal.status} />
      </div>

      {(withdrawal.status === 'pending' || withdrawal.status === 'approved') && (
        <div className="space-y-2 pt-1 border-t border-[var(--border)]">
          <textarea
            placeholder="Catatan admin (opsional)…"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] resize-none h-12"
          />
          <div className="flex flex-wrap gap-2">
            {withdrawal.status === 'pending' && (
              <button onClick={() => onApprove(note)} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors">
                <CheckCircle size={13} /> Setujui
              </button>
            )}
            {withdrawal.status === 'approved' && (
              <button onClick={() => onComplete(note)} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors">
                <CheckCircle size={13} /> Tandai Selesai (Transfer Done)
              </button>
            )}
            <button onClick={() => onReject(note)} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors">
              <XCircle size={13} /> Tolak & Refund
            </button>
          </div>
        </div>
      )}

      {withdrawal.admin_note && (
        <p className="text-xs text-[var(--text-muted)]">Note: {withdrawal.admin_note}</p>
      )}
    </div>
  );
}

function TrustBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-mono font-bold ${color}`}>{score}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    pending:  { label: 'Pending',  cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
    approved: { label: 'Disetujui', cls: 'bg-green-500/20 text-green-300 border-green-500/40' },
    rejected: { label: 'Ditolak', cls: 'bg-red-500/20 text-red-300 border-red-500/40' },
  };
  const c = cfg[status] || { label: status, cls: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs border font-medium ${c.cls}`}>{c.label}</span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
type Tab = 'overview' | 'flagged' | 'collusion' | 'multiAccount' | 'appeals' | 'events' | 'payments';

export default function AdminPage() {
  const router                 = useRouter();
  const { user, token }        = useAppStore();
  const [mounted, setMounted]  = useState(false);
  const [tab, setTab]          = useState<Tab>('overview');
  const [loading, setLoading]  = useState(true);
  const [stats, setStats]      = useState<AdminStats | null>(null);
  const [flagged, setFlagged]  = useState<FlaggedUser[]>([]);
  const [collusion, setCollusion] = useState<CollusionFlag[]>([]);
  const [multiAcc, setMultiAcc]   = useState<MultiAccountFlag[]>([]);
  const [appeals, setAppeals]     = useState<Appeal[]>([]);
  const [events, setEvents]       = useState<SecurityEvent[]>([]);
  const [deposits, setDeposits]   = useState<ManualDeposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<ManualWithdrawal[]>([]);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [loadError, setLoadError] = useState('');

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
      if (t === 'payments')     {
        const [depData, wdData] = await Promise.all([
          api.admin.manualDeposits(token, paymentStatusFilter),
          api.admin.manualWithdrawals(token, paymentStatusFilter),
        ]);
        setDeposits(depData.deposits || []);
        setWithdrawals(wdData.withdrawals || []);
      }
    } catch (e: unknown) {
      setLoadError('Data admin gagal dimuat.');
      if (e instanceof Error && e.message.includes('Admin access')) {
        router.replace('/dashboard');
      }
    } finally {
      setLoading(false);
    }
  }, [token, loadStats, router]);

  // Wait for Zustand persist to hydrate before checking auth
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!user || !token) { router.replace('/'); return; }
    if (!user.is_admin) { router.replace('/dashboard'); return; }
    loadStats();
    loadTab('overview');
  }, [mounted, user, token, router, loadStats, loadTab]);

  useEffect(() => { if (mounted) loadTab(tab); }, [tab, loadTab, mounted]);
  useEffect(() => { if (tab === 'payments' && mounted) loadTab('payments'); }, [paymentStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function handleDepositApprove(id: string) {
    if (!token) return;
    setActionLoading(id + 'approve');
    try {
      await api.admin.approveDeposit(token, id);
      showMsg('✅ Deposit disetujui — saldo user ditambahkan');
      await loadTab('payments');
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Failed'}`, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDepositReject(id: string, note: string) {
    if (!token) return;
    setActionLoading(id + 'reject');
    try {
      await api.admin.rejectDeposit(token, id, note);
      showMsg('✅ Deposit ditolak');
      await loadTab('payments');
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Failed'}`, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleWithdrawalApprove(id: string, note: string) {
    if (!token) return;
    setActionLoading(id + 'approve');
    try {
      await api.admin.approveWithdrawal(token, id, note);
      showMsg('✅ Penarikan disetujui — proses transfer manual sekarang');
      await loadTab('payments');
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Failed'}`, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleWithdrawalComplete(id: string, note: string) {
    if (!token) return;
    setActionLoading(id + 'complete');
    try {
      await api.admin.completeWithdrawal(token, id, note);
      showMsg('✅ Penarikan selesai');
      await loadTab('payments');
    } catch (e: unknown) {
      showMsg(`❌ ${e instanceof Error ? e.message : 'Failed'}`, false);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleWithdrawalReject(id: string, note: string) {
    if (!token) return;
    setActionLoading(id + 'reject');
    try {
      await api.admin.rejectWithdrawal(token, id, note);
      showMsg('✅ Penarikan ditolak & saldo dikembalikan');
      await loadTab('payments');
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
    { key: 'overview',     label: 'Ringkasan',      icon: <Shield size={15} /> },
    { key: 'payments',     label: 'Pembayaran',     icon: <Wallet size={15} />,       badge: deposits.filter(d => d.status === 'pending').length + withdrawals.filter(w => w.status === 'pending').length || undefined },
    { key: 'flagged',      label: 'Akun Ditandai',  icon: <Users size={15} />,        badge: stats?.totalFlagged },
    { key: 'collusion',    label: 'Kolusi',         icon: <GitBranch size={15} />,    badge: stats?.unreviewedCollusion },
    { key: 'multiAccount', label: 'Multi-Akun',     icon: <Lock size={15} />,         badge: stats?.unreviewedMultiAccount },
    { key: 'appeals',      label: 'Banding',        icon: <AlertTriangle size={15} />, badge: stats?.pendingAppeals },
    { key: 'events',       label: 'Log Keamanan',   icon: <Activity size={15} /> },
  ];

  // Show nothing until Zustand has hydrated — prevents flash redirect
  if (!mounted) return null;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center">
            <Shield size={20} className="text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Dashboard Admin Anti-Cheat</h1>
            <p className="text-sm text-[var(--text-muted)]">Tinjau akun ditandai, banding, dan event keamanan</p>
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
        {loadError && <div className="mb-4 px-4 py-3 rounded-lg text-sm border bg-red-500/10 border-red-500/30 text-red-300">{loadError}</div>}

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
            <RefreshCw size={20} className="animate-spin mr-2" /> Memuat…
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
                  <div className="text-center py-12 text-[var(--text-muted)]">Tidak ada akun ditandai</div>
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
                  <div className="text-center py-12 text-[var(--text-muted)]">Tidak ada flag kolusi yang belum ditinjau</div>
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
                              {ps.gameCount} game bersama — A menang: {ps.aWins}, B menang: {ps.bWins}, Seri: {ps.draws}
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
                  <div className="text-center py-12 text-[var(--text-muted)]">Tidak ada flag multi-akun yang belum ditinjau</div>
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
                  <div className="text-center py-12 text-[var(--text-muted)]">Tidak ada banding</div>
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
                                <CheckCircle size={13} /> Setujui (Trust 75)
                              </button>
                              <button onClick={() => handleAppealReview(a.id, 'approved', 60)}
                                disabled={actionLoading === a.id}
                                className="flex items-center gap-1 px-3 py-1.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-medium hover:bg-blue-500/30">
                                <CheckCircle size={13} /> Setujui (Trust 60)
                              </button>
                              <button onClick={() => handleAppealReview(a.id, 'rejected')}
                                disabled={actionLoading === a.id}
                                className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/30">
                                <XCircle size={13} /> Tolak Banding
                              </button>
                            </div>
                          </>
                        )}
                        {a.reviewed_at && (
                          <div className="text-xs text-[var(--text-muted)] mt-2">
                            Ditinjau: {fmtDate(a.reviewed_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Payments ─────────────────────────────────────────────── */}
            {tab === 'payments' && (
              <div className="space-y-6">
                {/* Filter */}
                <div className="flex items-center gap-2">
                  {(['pending', 'approved', 'all'] as const).map(s => (
                    <button key={s} onClick={() => setPaymentStatusFilter(s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        paymentStatusFilter === s
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg-primary)] border border-transparent'
                      }`}>
                      {s === 'all' ? 'Semua' : s === 'pending' ? 'Pending' : 'Disetujui'}
                    </button>
                  ))}
                </div>

                {/* Deposits */}
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                    <ArrowDownLeft size={15} className="text-sky-400" /> Deposit Manual
                    <span className="text-xs bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full">{deposits.length}</span>
                  </h3>
                  <div className="space-y-3">
                    {deposits.length === 0 && (
                      <div className="text-center py-8 text-[var(--text-muted)] text-sm bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)]">
                        Tidak ada deposit {paymentStatusFilter !== 'all' ? paymentStatusFilter : ''}
                      </div>
                    )}
                    {deposits.map(d => (
                      <DepositCard
                        key={d.id}
                        deposit={d}
                        actionLoading={actionLoading}
                        onApprove={() => handleDepositApprove(d.id)}
                        onReject={(note) => handleDepositReject(d.id, note)}
                      />
                    ))}
                  </div>
                </div>

                {/* Withdrawals */}
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                    <ArrowUpRight size={15} className="text-orange-400" /> Penarikan
                    <span className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full">{withdrawals.length}</span>
                  </h3>
                  <div className="space-y-3">
                    {withdrawals.length === 0 && (
                      <div className="text-center py-8 text-[var(--text-muted)] text-sm bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)]">
                        Tidak ada penarikan {paymentStatusFilter !== 'all' ? paymentStatusFilter : ''}
                      </div>
                    )}
                    {withdrawals.map(w => (
                      <WithdrawalCard
                        key={w.id}
                        withdrawal={w}
                        actionLoading={actionLoading}
                        onApprove={(note) => handleWithdrawalApprove(w.id, note)}
                        onComplete={(note) => handleWithdrawalComplete(w.id, note)}
                        onReject={(note) => handleWithdrawalReject(w.id, note)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Security Events ───────────────────────────────────────── */}
            {tab === 'events' && (
              <div className="space-y-2">
                {events.length === 0 && (
                  <div className="text-center py-12 text-[var(--text-muted)]">Tidak ada event keamanan</div>
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

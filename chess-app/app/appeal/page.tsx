'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, AlertTriangle, CheckCircle, Clock, XCircle, Send, ChevronRight } from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import Link from 'next/link';

interface Appeal {
  id: string; reason: string; status: string;
  admin_note: string; created_at: string; reviewed_at: string;
}
interface AccountStatus {
  flagged: boolean; flaggedReason: string | null; trustScore: number;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'approved') return <CheckCircle size={16} className="text-green-400" />;
  if (status === 'rejected') return <XCircle size={16} className="text-red-400" />;
  return <Clock size={16} className="text-yellow-400" />;
}

const fmtDate = (s: string) => s ? new Date(s).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function AppealPage() {
  const router        = useRouter();
  const { user, token } = useAppStore();
  const [account, setAccount]   = useState<AccountStatus | null>(null);
  const [appeals, setAppeals]   = useState<Appeal[]>([]);
  const [loading, setLoading]   = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm]  = useState(false);
  const [reason, setReason]     = useState('');
  const [evidence, setEvidence] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [loadError, setLoadError] = useState('');

  const showMessage = (text: string, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  useEffect(() => {
    if (!user || !token) { router.replace('/'); return; }

    const load = async () => {
      try {
        const data = await api.appeal.mine(token);
        setAppeals(data.appeals || []);
        setAccount(data.account);
      } catch {
        setLoadError('Data banding tidak dapat dimuat saat ini.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, token, router]);

  const hasPending = appeals.some(a => a.status === 'pending');
  const canSubmit  = account?.flagged && !hasPending && appeals.length < 3;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !reason.trim() || reason.trim().length < 20) {
      showMessage('Tulis minimal 20 karakter untuk menjelaskan kasusmu.', false);
      return;
    }
    setSubmitting(true);
    try {
      await api.appeal.submit(token, { reason: reason.trim(), evidence: evidence.trim() || undefined });
      showMessage('Banding berhasil dikirim. Tim kami akan meninjau dalam 48 jam.');
      setReason('');
      setEvidence('');
      setShowForm(false);
      // Reload
      const data = await api.appeal.mine(token);
      setAppeals(data.appeals || []);
      setAccount(data.account);
    } catch (err: unknown) {
      showMessage(`${err instanceof Error ? err.message : 'Gagal mengirim banding'}`, false);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh] text-[var(--text-muted)]">
          Memuat…
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center">
            <Shield size={20} className="text-yellow-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Banding Akun</h1>
            <p className="text-sm text-[var(--text-muted)]">Ajukan peninjauan untuk flag atau suspensi akun</p>
          </div>
        </div>
        {loadError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{loadError}</div>
        )}

        {/* Toast */}
        {msg && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border ${
            msg.ok ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}>{msg.text}</div>
        )}

        {/* Account Status Card */}
        {account && (
          <div className={`rounded-xl border p-4 mb-6 ${
            account.flagged
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-green-500/10 border-green-500/30'
          }`}>
            <div className="flex items-center gap-3">
              {account.flagged
                ? <AlertTriangle size={20} className="text-red-400 shrink-0" />
                : <CheckCircle size={20} className="text-green-400 shrink-0" />
              }
              <div>
                <div className={`font-semibold ${account.flagged ? 'text-red-300' : 'text-green-300'}`}>
                  {account.flagged ? 'Akun Ditandai / Ditangguhkan' : 'Akun Dalam Kondisi Baik'}
                </div>
                {account.flagged && account.flaggedReason && (
                  <div className="text-sm text-red-400 mt-0.5">{account.flaggedReason}</div>
                )}
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  Trust Score: <span className={`font-bold ${
                    account.trustScore >= 80 ? 'text-green-400' : account.trustScore >= 50 ? 'text-yellow-400' : 'text-red-400'
                  }`}>{account.trustScore}/100</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Appeal Form Toggle */}
        {canSubmit && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-between px-5 py-4 bg-[var(--bg-secondary)] border border-yellow-500/30 rounded-xl text-[var(--text-primary)] hover:border-yellow-500/60 transition-colors mb-6">
            <div className="flex items-center gap-2">
              <Send size={16} className="text-yellow-400" />
              <span className="font-medium">Ajukan Banding</span>
            </div>
            <ChevronRight size={16} className="text-[var(--text-muted)]" />
          </button>
        )}

        {!account?.flagged && appeals.length === 0 && (
          <div className="text-center py-10 text-[var(--text-muted)]">
            <CheckCircle size={40} className="mx-auto mb-3 text-green-500/50" />
            <div className="font-medium">Akun kamu dalam kondisi baik</div>
            <div className="text-sm mt-1">Tidak perlu mengajukan banding saat ini.</div>
            <Link href="/dashboard" className="inline-flex items-center gap-1 mt-4 text-sm text-blue-400 hover:underline">
              Kembali ke Dashboard <ChevronRight size={14} />
            </Link>
          </div>
        )}

        {hasPending && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-6 text-sm text-yellow-300">
            <Clock size={15} className="inline mr-1" />
            Kamu punya banding yang masih diproses. Tim kami akan meninjau dalam 48 jam. Banding baru bisa diajukan setelah ini selesai.
          </div>
        )}

        {appeals.length >= 3 && !hasPending && (
          <div className="bg-zinc-500/10 border border-zinc-500/30 rounded-xl p-4 mb-6 text-sm text-zinc-400">
            Kamu sudah mencapai batas maksimal 3 kali banding. Hubungi support jika butuh bantuan lanjutan.
          </div>
        )}

        {/* Appeal Form */}
        {showForm && canSubmit && (
          <form onSubmit={handleSubmit} className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-5 mb-6">
            <h2 className="font-semibold text-[var(--text-primary)] mb-4">Ajukan Banding</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                Jelaskan kasus kamu <span className="text-red-400">*</span>
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Jelaskan kenapa flag/suspensi ini menurutmu tidak tepat. Tulis spesifik dan jujur."
                rows={5}
                required
                minLength={20}
                maxLength={2000}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] resize-none focus:outline-none focus:border-blue-500/50"
              />
              <div className="text-xs text-[var(--text-muted)] mt-1">{reason.length}/2000</div>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">
                Bukti tambahan <span className="text-[var(--text-muted)]">(opsional)</span>
              </label>
              <textarea
                value={evidence}
                onChange={e => setEvidence(e.target.value)}
                placeholder="Tambahkan link, ID game, atau konteks lain yang mendukung banding."
                rows={3}
                maxLength={1000}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] resize-none focus:outline-none focus:border-blue-500/50"
              />
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300 mb-4">
              <strong>Catatan:</strong> Banding ditinjau admin manusia dalam 48 jam.
              Informasi palsu dapat berujung ban permanen. Maksimal 3 banding per akun.
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={submitting || reason.trim().length < 20}
                className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-black font-semibold rounded-lg text-sm transition-colors disabled:opacity-50">
                <Send size={15} />
                {submitting ? 'Mengirim…' : 'Kirim Banding'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                Batal
              </button>
            </div>
          </form>
        )}

        {/* Past Appeals */}
        {appeals.length > 0 && (
          <div>
            <h2 className="font-semibold text-[var(--text-primary)] mb-3">Riwayat Banding</h2>
            <div className="space-y-3">
              {appeals.map(a => (
                <div key={a.id} className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusIcon status={a.status} />
                    <span className="text-sm font-medium text-[var(--text-primary)] capitalize">{a.status}</span>
                    <span className="ml-auto text-xs text-[var(--text-muted)]">{fmtDate(a.created_at)}</span>
                  </div>
                  <p className="text-sm text-[var(--text-muted)] line-clamp-3">{a.reason}</p>
                  {a.admin_note && (
                    <div className="mt-3 p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--border)]">
                      <div className="text-xs font-semibold text-[var(--text-muted)] mb-1">Respons Admin:</div>
                      <p className="text-sm text-[var(--text-primary)]">{a.admin_note}</p>
                    </div>
                  )}
                  {a.reviewed_at && (
                    <div className="text-xs text-[var(--text-muted)] mt-2">Ditinjau: {fmtDate(a.reviewed_at)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { CheckCircle, XCircle, Loader2, MailWarning } from 'lucide-react';

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'no-token'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState('');
  const [resendError, setResendError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('no-token');
      return;
    }
    api.auth.verifyEmail(token)
      .then(() => {
        setStatus('success');
        setTimeout(() => router.push('/'), 4000);
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : 'Verifikasi gagal. Token tidak valid atau sudah kadaluarsa.');
        setStatus('error');
      });
  }, [token, router]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendLoading(true);
    setResendError('');
    setResendSuccess('');
    try {
      await api.auth.resendVerification(resendEmail);
      setResendSuccess('Email verifikasi telah dikirim ulang. Cek inbox (dan folder spam) kamu.');
    } catch (err: unknown) {
      setResendError(err instanceof Error ? err.message : 'Gagal mengirim ulang email verifikasi.');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex items-center justify-center px-4">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <button onClick={() => router.push('/')} className="inline-flex items-center gap-2 mb-6 hover:opacity-80 transition-opacity">
            <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
              <span className="text-2xl">♔</span>
            </div>
            <span className="text-2xl font-bold">Chess<span className="text-amber-400">Arena</span></span>
          </button>
          <h1 className="text-2xl font-bold">Verifikasi Email</h1>
        </div>

        <div className="bg-[var(--bg-card)]/80 backdrop-blur-xl rounded-2xl p-8 border border-[var(--border)]">
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <Loader2 className="w-12 h-12 text-amber-400 animate-spin" />
              <p className="text-[var(--text-secondary)]">Sedang memverifikasi email kamu...</p>
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <p className="text-emerald-400 font-semibold text-lg">Email berhasil diverifikasi!</p>
              <p className="text-[var(--text-muted)] text-sm">Akunmu sudah aktif. Kamu akan diarahkan ke halaman masuk dalam 4 detik...</p>
              <button onClick={() => router.push('/')}
                className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-600 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-amber-500/25">
                Masuk Sekarang
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center">
                <XCircle className="w-8 h-8 text-red-400" />
              </div>
              <p className="text-red-400 font-semibold">Verifikasi Gagal</p>
              <p className="text-slate-400 text-sm">{errorMsg}</p>

              {/* Resend form */}
              <div className="w-full mt-4 pt-4 border-t border-white/10">
                <p className="text-[var(--text-muted)] text-sm mb-3">Kirim ulang email verifikasi:</p>
                {resendSuccess ? (
                  <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" /> {resendSuccess}
                  </div>
                ) : (
                  <form onSubmit={handleResend} className="space-y-3">
                    {resendError && (
                      <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                        <span>⚠</span> {resendError}
                      </div>
                    )}
                    <input type="email" value={resendEmail} required
                      onChange={e => setResendEmail(e.target.value)}
                      placeholder="Email yang terdaftar"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors text-sm" />
                    <button type="submit" disabled={resendLoading}
                      className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-yellow-600 rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-70 flex items-center justify-center gap-2">
                      {resendLoading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Kirim Ulang Email'}
                    </button>
                  </form>
                )}
              </div>

                <button onClick={() => router.push('/')} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                Kembali ke Masuk
              </button>
            </div>
          )}

          {status === 'no-token' && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="w-14 h-14 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <MailWarning className="w-8 h-8 text-yellow-400" />
              </div>
              <p className="text-yellow-400 font-semibold">Token Tidak Ditemukan</p>
              <p className="text-slate-400 text-sm">Link verifikasi tidak valid. Pastikan kamu mengklik link yang ada di email, bukan menyalin sebagian URL.</p>
              <button onClick={() => router.push('/')}
                className="text-sm text-amber-400 hover:text-amber-300 transition-colors">
                Kembali ke Masuk
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center text-[var(--text-primary)]">Memuat...</div>}>
      <VerifyEmailForm />
    </Suspense>
  );
}

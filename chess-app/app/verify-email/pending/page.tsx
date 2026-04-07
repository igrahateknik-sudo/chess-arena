'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Mail, RefreshCw, ArrowLeft, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';

function PendingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get('email') || '';

  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState('');

  const handleResend = async () => {
    if (!email) return;
    setResendLoading(true);
    setResendError('');
    try {
      await api.auth.resendVerification(email);
    } catch {
      // Always show success to avoid email enumeration
    } finally {
      setResendSent(true);
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex items-center justify-center px-4">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <button onClick={() => router.push('/')} className="inline-flex items-center gap-2 mb-6 hover:opacity-80 transition-opacity">
            <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <span className="text-2xl">♔</span>
            </div>
            <span className="text-2xl font-bold">Chess<span className="bg-gradient-to-r from-sky-400 to-blue-500 bg-clip-text text-transparent">Arena</span></span>
          </button>
        </div>

        <div className="bg-[var(--bg-card)]/80 border border-[var(--border)] rounded-2xl p-8 backdrop-blur-sm text-center">
          {/* Icon */}
          <div className="w-20 h-20 rounded-full bg-sky-500/20 border border-sky-500/30 flex items-center justify-center mx-auto mb-6">
            <Mail className="w-10 h-10 text-sky-400" />
          </div>

          <h1 className="text-2xl font-bold mb-2">Cek email kamu</h1>
          <p className="text-slate-400 mb-2 text-sm leading-relaxed">
            Link verifikasi telah dikirim ke:
          </p>
          {email && (
            <p className="text-sky-400 font-semibold mb-6 break-all">{email}</p>
          )}
          <p className="text-slate-400 text-sm mb-8 leading-relaxed">
            Klik link di email tersebut untuk mengaktifkan akun kamu dan mulai bermain.
            Cek juga folder <span className="text-slate-300 font-medium">spam</span> jika tidak ada di inbox.
          </p>

          {/* Resend section */}
          {resendSent ? (
            <div className="flex items-center justify-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm mb-6">
              <CheckCircle className="w-4 h-4 shrink-0" />
              Email verifikasi telah dikirim ulang. Cek inbox kamu.
            </div>
          ) : (
            <div className="mb-6">
              <p className="text-slate-500 text-xs mb-3">Tidak menerima email?</p>
              <button
                onClick={handleResend}
                disabled={resendLoading}
                className="flex items-center justify-center gap-2 w-full py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-medium hover:bg-white/10 transition-colors disabled:opacity-60"
              >
                {resendLoading
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <RefreshCw className="w-4 h-4" />
                }
                Kirim Ulang Email Verifikasi
              </button>
              {resendError && (
                <p className="text-red-400 text-xs mt-2">{resendError}</p>
              )}
            </div>
          )}

          <button
            onClick={() => router.push('/?mode=login')}
            className="flex items-center justify-center gap-2 w-full text-sm text-slate-400 hover:text-slate-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali ke halaman login
          </button>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Link verifikasi berlaku selama 24 jam.
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPendingPage() {
  return (
    <Suspense>
      <PendingContent />
    </Suspense>
  );
}

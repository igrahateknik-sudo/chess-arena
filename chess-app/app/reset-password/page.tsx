'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { Eye, EyeOff } from 'lucide-react';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) setError('Token tidak valid. Minta link reset baru.');
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('Password tidak cocok.'); return; }
    if (password.length < 8) { setError('Password minimal 8 karakter.'); return; }
    setLoading(true);
    setError('');
    try {
      await api.auth.resetPassword(token, password);
      setSuccess(true);
      setTimeout(() => router.push('/'), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex items-center justify-center px-4">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
      </div>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <button onClick={() => router.push('/')} className="inline-flex items-center gap-2 mb-6 hover:opacity-80 transition-opacity">
            <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <span className="text-2xl">♔</span>
            </div>
            <span className="text-2xl font-bold">Chess<span className="text-sky-400">Arena</span></span>
          </button>
          <h1 className="text-2xl font-bold">Buat Password Baru</h1>
          <p className="text-[var(--text-muted)] mt-2 text-sm">Masukkan password baru kamu di bawah.</p>
        </div>

        <div className="bg-[var(--bg-card)]/80 backdrop-blur-xl rounded-2xl p-8 border border-[var(--border)]">
          {success ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center text-3xl">✅</div>
              <p className="text-emerald-400 font-medium">Password berhasil diubah!</p>
              <p className="text-[var(--text-muted)] text-sm">Kamu akan diarahkan ke halaman masuk dalam 3 detik...</p>
              <button onClick={() => router.push('/')} className="text-sm text-sky-400 hover:text-sky-300 transition-colors">Masuk Sekarang</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                  <span>⚠</span> {error}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Password Baru</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={password} required minLength={8}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Minimal 8 karakter"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-colors" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Konfirmasi Password</label>
                <input type={showPassword ? 'text' : 'password'} value={confirm} required
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Ulangi password baru"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-colors" />
              </div>
              <button type="submit" disabled={loading || !token}
                className="w-full py-3.5 bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl font-semibold text-base hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 disabled:opacity-70">
                {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Simpan Password Baru'}
              </button>
              <button type="button" onClick={() => router.push('/')}
                className="w-full text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors mt-2">
                Kembali ke Masuk
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center text-[var(--text-primary)]">Memuat...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}

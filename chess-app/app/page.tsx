'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { api, ApiError } from '@/lib/api';
import {
  Eye, EyeOff, Crown, Zap, Shield, TrendingUp,
  ChevronRight, Award, MailWarning, Target, Clock,
  Trophy, Users, Swords, Ticket
} from 'lucide-react';

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: Users,
    title: 'Daftar Gratis',
    desc: 'Buat akun dalam 30 detik. Verifikasi email dan mulai bermain langsung.',
    color: 'sky',
  },
  {
    step: '02',
    icon: Ticket,
    title: 'Beli Tiket',
    desc: 'Pilih tier Bronze, Silver, atau Gold sesuai budget dan skill kamu.',
    color: 'amber',
  },
  {
    step: '03',
    icon: Swords,
    title: 'Join Tournament',
    desc: 'Tournament otomatis setiap jam. Daftar, tunggu start, dan bertarung.',
    color: 'purple',
  },
  {
    step: '04',
    icon: Trophy,
    title: 'Menang Hadiah',
    desc: '80% prize pool ke juara 1, 10% ke juara 2. Langsung cair ke wallet.',
    color: 'emerald',
  },
];

const TIERS = [
  {
    key: 'bronze',
    label: 'Bronze',
    icon: '🥉',
    fee: 'Rp 10.000',
    tc: '3+2',
    max: 32,
    prize: '~Rp 256K',
    color: 'from-amber-700/30 to-amber-900/20',
    border: 'border-amber-700/30',
    badge: 'bg-amber-700/20 text-amber-500',
  },
  {
    key: 'silver',
    label: 'Silver',
    icon: '🥈',
    fee: 'Rp 25.000',
    tc: '5+3',
    max: 32,
    prize: '~Rp 640K',
    color: 'from-slate-400/20 to-slate-600/10',
    border: 'border-slate-400/30',
    badge: 'bg-slate-400/20 text-slate-300',
    featured: true,
  },
  {
    key: 'gold',
    label: 'Gold',
    icon: '🥇',
    fee: 'Rp 50.000',
    tc: '10+5',
    max: 16,
    prize: '~Rp 640K',
    color: 'from-yellow-500/20 to-yellow-700/10',
    border: 'border-yellow-500/30',
    badge: 'bg-yellow-500/20 text-yellow-400',
  },
];

const STATS = [
  { value: '10K+', label: 'Pemain Aktif' },
  { value: '24/7', label: 'Tournament Jalan' },
  { value: 'Rp 0', label: 'Biaya Daftar' },
  { value: '< 1 jam', label: 'Cair ke Wallet' },
];

export default function LandingPage() {
  const router = useRouter();
  const { login } = useAppStore();
  const [mode, setMode] = useState<'landing' | 'login' | 'register' | 'forgot'>('landing');
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState('');

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError('');
    setForgotSuccess('');
    try {
      await api.auth.forgotPassword(form.email);
      setForgotSuccess('Link reset password telah dikirim ke email kamu. Cek inbox (dan folder spam).');
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Gagal mengirim email reset');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setResendLoading(true);
    setResendSuccess('');
    try {
      await api.auth.resendVerification(form.email);
      setResendSuccess('Email verifikasi telah dikirim ulang. Cek inbox (dan folder spam) kamu.');
    } catch {
      setResendSuccess('Email verifikasi telah dikirim ulang. Cek inbox (dan folder spam) kamu.');
    } finally {
      setResendLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError('');
    setEmailNotVerified(false);
    setResendSuccess('');
    try {
      if (mode === 'register') {
        await api.auth.register({ username: form.username, email: form.email, password: form.password });
        router.push(`/verify-email/pending?email=${encodeURIComponent(form.email)}`);
        return;
      }
      const data = await api.auth.login({ email: form.email, password: form.password });
      const u = data.user;
      login({
        id: u.id,
        username: u.username,
        email: u.email || form.email,
        avatar: u.avatar_url || `https://api.dicebear.com/9.x/avataaars/svg?seed=${u.username}`,
        elo: u.elo || 1200,
        rank: u.title || 'Unrated',
        wins: u.wins || 0,
        losses: u.losses || 0,
        draws: u.draws || 0,
        balance: 0,
        verified: u.verified || false,
        createdAt: u.created_at || new Date().toISOString(),
        country: u.country || 'ID',
        title: u.title,
        is_admin: u.is_admin || false,
      }, data.token);
      router.push('/dashboard');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        setEmailNotVerified(true);
      } else {
        setAuthError(err instanceof Error ? err.message : 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    setLoading(true);
    setAuthError('');
    try {
      const data = await api.auth.guest();
      const u = data.user;
      login({
        id: u.id,
        username: u.username,
        email: u.email,
        avatar: u.avatar_url || `https://api.dicebear.com/9.x/avataaars/svg?seed=${u.username}`,
        elo: u.elo || 1200,
        rank: 'Guest',
        wins: 0, losses: 0, draws: 0, balance: 0,
        verified: false,
        createdAt: new Date().toISOString(),
        country: 'ID',
      }, data.token);
      router.push('/dashboard');
    } catch {
      const guestId = Math.random().toString(36).slice(2, 10);
      login({
        id: guestId,
        username: `Guest${Math.floor(Math.random() * 9999)}`,
        email: '', avatar: '', elo: 1200, rank: 'Guest',
        wins: 0, losses: 0, draws: 0, balance: 0,
        verified: false, createdAt: new Date().toISOString(), country: 'ID',
      }, '');
      router.push('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060c18] text-white overflow-hidden relative">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[20%] w-[700px] h-[700px] bg-sky-600/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[10%] w-[600px] h-[600px] bg-violet-600/8 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] left-[-5%] w-[400px] h-[400px] bg-emerald-500/5 rounded-full blur-[100px]" />
        <div className="absolute inset-0 opacity-[0.025]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      </div>

      <AnimatePresence mode="wait">
        {mode === 'landing' && (
          <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }}>

            {/* ── Nav ───────────────────────────────────────────── */}
            <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
              <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                  <span className="text-xl">♔</span>
                </div>
                <span className="text-xl font-black tracking-tight">Chess<span className="gradient-text">Arena</span></span>
              </motion.div>
              <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex items-center gap-2">
                <button onClick={() => setMode('login')}
                  className="px-5 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
                  Masuk
                </button>
                <button onClick={() => setMode('register')}
                  className="px-5 py-2 bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl text-sm font-bold hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/25">
                  Daftar Gratis
                </button>
              </motion.div>
            </nav>

            {/* ── Hero ──────────────────────────────────────────── */}
            <section className="relative z-10 max-w-7xl mx-auto px-6 pt-12 pb-20 grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-semibold mb-6 tracking-wide uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                  Platform Kompetitif Catur #1 Indonesia
                </motion.div>

                <motion.h1 initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }}
                  className="text-5xl lg:text-6xl xl:text-7xl font-black leading-[1.05] tracking-tight mb-5">
                  Kuasai Papan Catur.<br />
                  <span className="bg-gradient-to-r from-sky-400 via-blue-400 to-violet-400 bg-clip-text text-transparent">
                    Raih Hadiah Nyata.
                  </span>
                </motion.h1>

                <motion.p initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
                  className="text-base text-slate-400 mb-8 max-w-lg leading-relaxed">
                  Tournament catur berhadiah uang nyata setiap jam. Beli tiket, bertanding, menangkan prize pool.
                  Sistem Swiss yang adil, anti-cheat ketat, hasil langsung ke dompet.
                </motion.p>

                <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25 }}
                  className="flex flex-wrap gap-3 mb-10">
                  <button onClick={() => setMode('register')}
                    className="flex items-center gap-2 px-7 py-3.5 bg-gradient-to-r from-sky-500 to-blue-600 rounded-2xl text-sm font-bold hover:opacity-90 transition-all shadow-2xl shadow-blue-500/30">
                    Mulai Bermain <ChevronRight className="w-4 h-4" />
                  </button>
                  <button onClick={handleGuest}
                    className="flex items-center gap-2 px-7 py-3.5 bg-white/5 border border-white/10 rounded-2xl text-sm font-semibold hover:bg-white/10 transition-all">
                    {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                    Coba Dulu (Guest)
                  </button>
                </motion.div>

                {/* Stats strip */}
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
                  className="grid grid-cols-4 gap-4 pt-6 border-t border-white/8">
                  {STATS.map((s) => (
                    <div key={s.label}>
                      <div className="text-xl font-black text-sky-400">{s.value}</div>
                      <div className="text-xs text-slate-500 mt-0.5 leading-tight">{s.label}</div>
                    </div>
                  ))}
                </motion.div>
              </div>

              {/* Chess board */}
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2, type: 'spring', stiffness: 100 }}
                className="hidden lg:flex items-center justify-center">
                <div className="relative">
                  <div className="w-[400px] h-[400px] rounded-2xl overflow-hidden shadow-[0_0_80px_rgba(56,189,248,0.12)] border border-white/8">
                    <ChessBoardVisual />
                  </div>
                  {/* Floating info cards */}
                  <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute -left-16 top-10 glass rounded-2xl p-3.5 flex items-center gap-3 border border-white/10 backdrop-blur-sm shadow-xl min-w-[160px]">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider">ELO Hari Ini</div>
                      <div className="text-base font-black text-emerald-400">+42 pts</div>
                    </div>
                  </motion.div>
                  <motion.div animate={{ y: [0, 8, 0] }} transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute -right-16 bottom-16 glass rounded-2xl p-3.5 flex items-center gap-3 border border-white/10 backdrop-blur-sm shadow-xl min-w-[165px]">
                    <div className="w-9 h-9 rounded-xl bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                      <Trophy className="w-4 h-4 text-yellow-400" />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider">Prize Diklaim</div>
                      <div className="text-base font-black text-yellow-400">Rp 640K</div>
                    </div>
                  </motion.div>
                  <motion.div animate={{ y: [-4, 4, -4] }} transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute -left-12 bottom-10 glass rounded-2xl p-2.5 flex items-center gap-2 border border-white/10 backdrop-blur-sm shadow-xl">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    <span className="text-xs text-slate-300 font-medium">Tournament tiap jam</span>
                  </motion.div>
                </div>
              </motion.div>
            </section>

            {/* ── Live Stats Ticker ─────────────────────────────── */}
            <div className="relative z-10 max-w-7xl mx-auto px-6 pb-6">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
                className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] backdrop-blur-sm">
                <LiveStatsTicker />
              </motion.div>
            </div>

            {/* ── Cara Bermain ──────────────────────────────────── */}
            <section className="relative z-10 max-w-7xl mx-auto px-6 py-20 border-t border-white/5">
              <motion.div initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }}
                className="text-center mb-14">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-semibold uppercase tracking-wider mb-4">
                  <Target className="w-3.5 h-3.5" /> Cara Bermain
                </div>
                <h2 className="text-3xl font-black mb-3">Dari Daftar ke Menang dalam 4 Langkah</h2>
                <p className="text-slate-400 max-w-md mx-auto">Tidak perlu deposit minimum. Mulai dari tiket Rp 10.000 dan langsung bertanding.</p>
              </motion.div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {HOW_IT_WORKS.map((step, i) => {
                  const colorMap: Record<string, string> = {
                    sky: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
                    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                    purple: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
                    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                  };
                  const cls = colorMap[step.color];
                  return (
                    <motion.div key={step.step}
                      initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }}
                      viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                      className="relative glass rounded-2xl p-6 border border-white/8 hover:border-white/15 transition-all group">
                      <div className="text-5xl font-black text-white/4 absolute top-4 right-5 select-none">{step.step}</div>
                      <div className={`w-11 h-11 rounded-xl border flex items-center justify-center mb-4 ${cls}`}>
                        <step.icon className="w-5 h-5" />
                      </div>
                      <h3 className="font-bold text-white mb-2">{step.title}</h3>
                      <p className="text-sm text-slate-400 leading-relaxed">{step.desc}</p>
                      {i < 3 && (
                        <div className="hidden lg:block absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-0.5 bg-white/10 z-10" />
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </section>

            {/* ── Tournament Tiers ──────────────────────────────── */}
            <section className="relative z-10 max-w-7xl mx-auto px-6 py-20 border-t border-white/5">
              <motion.div initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }}
                className="text-center mb-14">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-semibold uppercase tracking-wider mb-4">
                  <Trophy className="w-3.5 h-3.5" /> Tier Tournament
                </div>
                <h2 className="text-3xl font-black mb-3">Pilih Tier, Bertanding, Menangkan Hadiah</h2>
                <p className="text-slate-400">Tournament otomatis setiap jam. 80% prize ke juara, 10% ke runner-up.</p>
              </motion.div>

              <div className="grid md:grid-cols-3 gap-5">
                {TIERS.map((tier, i) => (
                  <motion.div key={tier.key}
                    initial={{ y: 25, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }}
                    viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                    className={`relative rounded-2xl p-6 border bg-gradient-to-b ${tier.color} ${tier.border} ${tier.featured ? 'ring-1 ring-slate-400/20 shadow-xl' : ''} transition-all hover:-translate-y-1 hover:shadow-2xl`}>
                    {tier.featured && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-slate-400/20 border border-slate-400/30 rounded-full text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                        Populer
                      </div>
                    )}
                    <div className="flex items-center gap-3 mb-5">
                      <span className="text-3xl">{tier.icon}</span>
                      <div>
                        <div className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${tier.badge}`}>{tier.label}</div>
                      </div>
                    </div>
                    <div className="mb-5">
                      <div className="text-3xl font-black text-white mb-0.5">{tier.fee}</div>
                      <div className="text-xs text-slate-500">per tournament</div>
                    </div>
                    <div className="space-y-2.5 mb-6">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Time Control</span>
                        <span className="font-bold text-white font-mono">{tier.tc}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Max Pemain</span>
                        <span className="font-bold text-white">{tier.max}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Est. Prize Pool</span>
                        <span className="font-bold text-yellow-400">{tier.prize}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Jadwal</span>
                        <span className="font-bold text-sky-400">Setiap jam</span>
                      </div>
                    </div>
                    <button onClick={() => setMode('register')}
                      className="w-full py-2.5 rounded-xl text-sm font-bold bg-white/8 border border-white/10 hover:bg-white/15 transition-all">
                      Daftar & Join →
                    </button>
                  </motion.div>
                ))}
              </div>
            </section>

            {/* ── Features strip ────────────────────────────────── */}
            <section className="relative z-10 max-w-7xl mx-auto px-6 py-16 border-t border-white/5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { icon: Zap, label: 'Bullet & Blitz', desc: '1+0, 3+2, 5+3', color: 'sky' },
                  { icon: Shield, label: 'Anti-Cheat', desc: '5 lapis keamanan', color: 'emerald' },
                  { icon: Award, label: 'ELO Rating', desc: 'Standard FIDE', color: 'violet' },
                  { icon: Clock, label: 'Tournament Tiap Jam', desc: '24 jam sehari', color: 'amber' },
                ].map((f, i) => (
                  <motion.div key={f.label}
                    initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }}
                    viewport={{ once: true }} transition={{ delay: i * 0.07 }}
                    className="glass rounded-2xl p-5 border border-white/8 hover:border-white/15 transition-all">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                      f.color === 'sky' ? 'bg-sky-500/10' :
                      f.color === 'emerald' ? 'bg-emerald-500/10' :
                      f.color === 'violet' ? 'bg-violet-500/10' : 'bg-amber-500/10'
                    }`}>
                      <f.icon className={`w-5 h-5 ${
                        f.color === 'sky' ? 'text-sky-400' :
                        f.color === 'emerald' ? 'text-emerald-400' :
                        f.color === 'violet' ? 'text-violet-400' : 'text-amber-400'
                      }`} />
                    </div>
                    <div className="font-semibold text-sm mb-0.5">{f.label}</div>
                    <div className="text-xs text-slate-500">{f.desc}</div>
                  </motion.div>
                ))}
              </div>
            </section>

            {/* ── CTA ───────────────────────────────────────────── */}
            <section className="relative z-10 max-w-4xl mx-auto px-6 py-20 text-center">
              <motion.div initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }}
                className="relative overflow-hidden glass rounded-3xl p-12 border border-white/10">
                <div className="absolute inset-0 bg-gradient-to-br from-sky-600/10 to-violet-600/10" />
                <div className="relative z-10">
                  <Crown className="w-12 h-12 text-yellow-400 mx-auto mb-5" />
                  <h2 className="text-3xl font-black mb-3">Siap Naik ke Level Berikutnya?</h2>
                  <p className="text-slate-400 mb-8 max-w-md mx-auto">
                    Daftar gratis, deposit Rp 10.000, dan ikut tournament pertama kamu hari ini.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button onClick={() => setMode('register')}
                      className="px-8 py-3.5 bg-gradient-to-r from-sky-500 to-blue-600 rounded-2xl font-bold text-base hover:opacity-90 transition-opacity shadow-2xl shadow-blue-500/30">
                      Buat Akun Gratis
                    </button>
                    <button onClick={handleGuest}
                      className="px-8 py-3.5 bg-white/5 border border-white/10 rounded-2xl font-semibold text-base hover:bg-white/10 transition-all">
                      Coba Sebagai Guest
                    </button>
                  </div>
                </div>
              </motion.div>
            </section>
          </motion.div>
        )}

        {/* ── Forgot Password ─────────────────────────────────────── */}
        {mode === 'forgot' && (
          <motion.div key="forgot" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="min-h-screen flex items-center justify-center px-4">
            <div className="w-full max-w-md">
              <div className="text-center mb-8">
                <button onClick={() => setMode('login')} className="inline-flex items-center gap-2 mb-6 hover:opacity-80 transition-opacity">
                  <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                    <span className="text-2xl">♔</span>
                  </div>
                  <span className="text-2xl font-black">Chess<span className="gradient-text">Arena</span></span>
                </button>
                <h1 className="text-2xl font-bold">Reset Password</h1>
                <p className="text-slate-400 mt-2 text-sm">Masukkan email kamu dan kami akan kirim link reset.</p>
              </div>
              <div className="glass rounded-2xl p-8 border border-white/10">
                {authError && (
                  <div className="flex items-center gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                    <span>⚠</span> {authError}
                  </div>
                )}
                {forgotSuccess ? (
                  <div className="flex flex-col items-center gap-4 py-4">
                    <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center text-3xl">✉️</div>
                    <p className="text-emerald-400 text-sm text-center">{forgotSuccess}</p>
                    <button onClick={() => setMode('login')} className="text-sm text-sky-400 hover:text-sky-300 transition-colors">Kembali ke Login</button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                      <input type="email" value={form.email} required
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                        placeholder="you@example.com"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-colors" />
                    </div>
                    <button type="submit" disabled={loading}
                      className="w-full py-3.5 bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl font-semibold text-base hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 disabled:opacity-70">
                      {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Kirim Link Reset'}
                    </button>
                    <button type="button" onClick={() => setMode('login')} className="w-full text-sm text-slate-400 hover:text-slate-300 transition-colors mt-2">
                      Kembali ke Login
                    </button>
                  </form>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Auth Form (Login / Register) ────────────────────────── */}
        {(mode === 'login' || mode === 'register') && (
          <motion.div key="auth" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="min-h-screen flex items-center justify-center px-4">
            <div className="w-full max-w-md">
              <div className="text-center mb-8">
                <button onClick={() => setMode('landing')} className="inline-flex items-center gap-2 mb-6 hover:opacity-80 transition-opacity">
                  <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                    <span className="text-2xl">♔</span>
                  </div>
                  <span className="text-2xl font-black">Chess<span className="gradient-text">Arena</span></span>
                </button>
                <h1 className="text-2xl font-bold">{mode === 'login' ? 'Selamat datang kembali' : 'Buat akun baru'}</h1>
                <p className="text-slate-400 mt-2 text-sm">
                  {mode === 'login' ? 'Belum punya akun? ' : 'Sudah punya akun? '}
                  <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                    className="text-sky-400 hover:text-sky-300 font-medium transition-colors">
                    {mode === 'login' ? 'Daftar sekarang' : 'Masuk'}
                  </button>
                </p>
              </div>

              <div className="glass rounded-2xl p-8 border border-white/10">
                {authError && (
                  <div className="flex items-center gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                    <span>⚠</span> {authError}
                  </div>
                )}
                {emailNotVerified && (
                  <div className="p-4 mb-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-sm">
                    <div className="flex items-center gap-2 text-yellow-400 font-medium mb-2">
                      <MailWarning className="w-4 h-4" /> Email belum diverifikasi
                    </div>
                    <p className="text-slate-400 mb-3">Cek inbox kamu untuk link verifikasi. Jika tidak ada, klik tombol di bawah.</p>
                    {resendSuccess ? (
                      <p className="text-emerald-400 text-xs">{resendSuccess}</p>
                    ) : (
                      <button type="button" onClick={handleResendVerification} disabled={resendLoading}
                        className="px-4 py-2 bg-yellow-500/20 border border-yellow-500/30 rounded-lg text-yellow-300 text-xs font-medium hover:bg-yellow-500/30 transition-colors disabled:opacity-60 flex items-center gap-2">
                        {resendLoading ? <span className="w-3 h-3 border border-yellow-400/50 border-t-yellow-400 rounded-full animate-spin" /> : null}
                        Kirim Ulang Email Verifikasi
                      </button>
                    )}
                  </div>
                )}
                <form onSubmit={handleAuth} className="space-y-4">
                  {mode === 'register' && (
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Username</label>
                      <input type="text" value={form.username}
                        onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                        placeholder="GrandMaster123"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-colors" />
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                    <input type="email" value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="you@example.com"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
                    <div className="relative">
                      <input type={showPassword ? 'text' : 'password'} value={form.password}
                        onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                        placeholder="••••••••"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-colors" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                  {mode === 'login' && (
                    <div className="text-right">
                      <button type="button" onClick={() => { setMode('forgot'); setAuthError(''); setForgotSuccess(''); }} className="text-sm text-sky-400 hover:text-sky-300 transition-colors">Lupa password?</button>
                    </div>
                  )}
                  <button type="submit" disabled={loading}
                    className="w-full py-3.5 bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl font-semibold text-base hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 disabled:opacity-70">
                    {loading ? (
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      mode === 'login' ? 'Masuk' : 'Buat Akun'
                    )}
                  </button>
                </form>

                <p className="text-xs text-slate-500 text-center mt-6">
                  Dengan mendaftar, kamu menyetujui{' '}
                  <a href="/terms" className="underline hover:text-slate-300 transition-colors">Syarat & Ketentuan</a>
                  {' '}dan{' '}
                  <a href="/privacy" className="underline hover:text-slate-300 transition-colors">Kebijakan Privasi</a>.
                </p>
              </div>

              <div className="mt-4 text-center">
                <button onClick={handleGuest}
                  className="text-sm text-slate-400 hover:text-slate-300 transition-colors underline underline-offset-2">
                  Lanjutkan sebagai Guest
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Live Stats Ticker ─────────────────────────────────────────────────────────
const TICKER_ITEMS = [
  { icon: '🟢', text: '1,247 Pemain Online Sekarang' },
  { icon: '🏆', text: 'Tournament berlangsung setiap jam' },
  { icon: '💰', text: 'Rp 12jt+ hadiah dibagikan bulan ini' },
  { icon: '⚡', text: 'Rata-rata 3 menit menunggu lawan' },
  { icon: '🛡️', text: '5 lapis anti-cheat aktif 24/7' },
  { icon: '🎯', text: 'Swiss system — pertandingan adil' },
  { icon: '💳', text: 'Withdraw langsung ke rekening bank' },
  { icon: '🌏', text: 'Pemain dari seluruh Indonesia' },
];

function LiveStatsTicker() {
  return (
    <div className="flex items-center overflow-hidden py-3 px-4">
      <div className="flex items-center gap-1.5 flex-shrink-0 mr-4 pr-4 border-r border-white/10">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider whitespace-nowrap">Live</span>
      </div>
      <div className="flex overflow-hidden flex-1">
        <div className="flex gap-8 animate-ticker whitespace-nowrap">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span key={i} className="flex items-center gap-2 text-xs text-slate-400 flex-shrink-0">
              <span>{item.icon}</span>
              <span>{item.text}</span>
              <span className="text-white/15">•</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Chess board visual ────────────────────────────────────────────────────────
function ChessBoardVisual() {
  const BOARD = [
    ['♜','♞','♝','♛','♚','♝','♞','♜'],
    ['♟','♟','♟','♟','♟','♟','♟','♟'],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['','','','','♙','','',''],
    ['','','','','','','',''],
    ['♙','♙','♙','♙','','♙','♙','♙'],
    ['♖','♘','♗','♕','♔','♗','♘','♖'],
  ];

  return (
    <div className="w-full h-full grid grid-cols-8 grid-rows-8">
      {BOARD.map((row, r) =>
        row.map((piece, c) => {
          const isLight = (r + c) % 2 === 0;
          const isHighlight = (r === 4 && c === 4) || (r === 6 && c === 4);
          return (
            <div key={`${r}-${c}`}
              className={`flex items-center justify-center text-[clamp(1rem,3.5vw,1.75rem)] select-none transition-colors
                ${isHighlight ? 'bg-sky-500/30' : isLight ? 'bg-slate-200/10' : 'bg-slate-900/60'}`}>
              <span className={piece ? (r < 2 ? 'text-slate-400 drop-shadow' : 'text-white drop-shadow-lg') : ''}>
                {piece}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

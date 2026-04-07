'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAppStore } from '@/lib/store';
import { api, ApiError } from '@/lib/api';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import {
  Eye, EyeOff, Crown, Zap, Shield, TrendingUp,
  ChevronRight, Award, MailWarning, Target, Clock,
  Trophy, Users, Swords, Ticket
} from 'lucide-react';

declare global {
  interface GoogleCredentialResponse {
    credential?: string;
  }
  interface GoogleIdAccounts {
    initialize: (options: {
      client_id: string;
      callback: (response: GoogleCredentialResponse) => void;
    }) => void;
    renderButton: (
      element: HTMLElement,
      options: {
        theme: 'filled_black' | 'outline' | 'filled_blue';
        size: 'large' | 'medium' | 'small';
        width?: number;
        shape?: 'pill' | 'rectangular' | 'circle' | 'square';
        text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
      }
    ) => void;
  }
  interface Window {
    google?: { accounts?: { id?: GoogleIdAccounts } };
  }
}

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: Users,
    art: '/illustrations/photo/register-real.jpg',
    title: 'Daftar Gratis',
    desc: 'Buat akun dalam 30 detik. Verifikasi email dan mulai bermain langsung.',
    color: 'sky',
  },
  {
    step: '02',
    icon: Ticket,
    art: '/illustrations/photo/division-real.jpg',
    title: 'Pilih Divisi',
    desc: 'Pilih divisi Bronze, Silver, atau Gold sesuai target performa kamu.',
    color: 'amber',
  },
  {
    step: '03',
    icon: Swords,
    art: '/illustrations/photo/battle-real.jpg',
    title: 'Gabung Turnamen',
    desc: 'Turnamen otomatis setiap jam. Daftar, tunggu mulai, lalu bertanding.',
    color: 'purple',
  },
  {
    step: '04',
    icon: Trophy,
    art: '/illustrations/photo/rank-real.jpg',
    title: 'Naik Peringkat',
    desc: 'Kumpulkan poin ranking, naik leaderboard, dan raih badge kompetitif.',
    color: 'emerald',
  },
];

const TIERS = [
  {
    key: 'bronze',
    label: 'Bronze',
    icon: '🥉',
    fee: 'Divisi Pemula',
    tc: '3+2',
    max: 32,
    prize: 'Reward: +120 PTS',
    color: 'from-amber-700/30 to-amber-900/20',
    border: 'border-amber-700/30',
    badge: 'bg-amber-700/20 text-amber-500',
    art: '/illustrations/photo/register-real.jpg',
  },
  {
    key: 'silver',
    label: 'Silver',
    icon: '🥈',
    fee: 'Divisi Menengah',
    tc: '5+3',
    max: 32,
    prize: 'Reward: +240 PTS',
    color: 'from-slate-400/20 to-slate-600/10',
    border: 'border-slate-400/30',
    badge: 'bg-slate-400/20 text-slate-300',
    art: '/illustrations/photo/division-real.jpg',
    featured: true,
  },
  {
    key: 'gold',
    label: 'Gold',
    icon: '🥇',
    fee: 'Divisi Pro',
    tc: '10+5',
    max: 16,
    prize: 'Reward: +360 PTS',
    color: 'from-yellow-500/20 to-yellow-700/10',
    border: 'border-yellow-500/30',
    badge: 'bg-yellow-500/20 text-yellow-400',
    art: '/illustrations/photo/battle-real.jpg',
  },
];

const STATS = [
  { value: '10K+', label: 'Pemain Aktif' },
  { value: '24/7', label: 'Turnamen Berjalan' },
  { value: '100%', label: 'Berbasis Skill' },
  { value: '< 1 jam', label: 'Siklus Event' },
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
  const googleBtnRef = useRef<HTMLDivElement | null>(null);
  const [googleReady, setGoogleReady] = useState(false);

  useEffect(() => {
    const scriptId = 'google-identity-services';
    if (document.getElementById(scriptId)) {
      setGoogleReady(true);
      return;
    }
    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleReady(true);
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (!googleReady || mode !== 'login' || !googleBtnRef.current || !window.google?.accounts?.id) return;
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response: GoogleCredentialResponse) => {
        if (!response?.credential) return;
        setLoading(true);
        setAuthError('');
        try {
          const data = await api.auth.google(response.credential);
          const u = data.user;
          login({
            id: u.id,
            username: u.username,
            email: u.email,
            avatar: u.avatar_url || `https://api.dicebear.com/9.x/avataaars/svg?seed=${u.username}`,
            elo: u.elo || 1200,
            rank: u.title || 'Unrated',
            wins: u.wins || 0,
            losses: u.losses || 0,
            draws: u.draws || 0,
            balance: u.balance || 0,
            verified: !!u.verified,
            createdAt: u.created_at || new Date().toISOString(),
            country: u.country || 'ID',
            title: u.title,
            is_admin: !!u.is_admin,
          }, data.token);
          router.push('/dashboard');
        } catch (err: unknown) {
          setAuthError(err instanceof Error ? err.message : 'Gagal masuk dengan Google');
        } finally {
          setLoading(false);
        }
      },
    });
    window.google.accounts.id.renderButton(googleBtnRef.current, {
      theme: 'filled_black',
      size: 'large',
      width: 360,
      shape: 'pill',
      text: 'signin_with',
    });
  }, [googleReady, mode, login, router]);

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

  return (
    <div className="min-h-screen bg-[#060c18] text-white overflow-x-hidden relative">
      {/* Background — absolute (not fixed) to avoid GPU compositor issues */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[20%] w-[700px] h-[700px] bg-sky-600/10 rounded-full blur-[80px]" />
        <div className="absolute bottom-[-10%] right-[10%] w-[600px] h-[600px] bg-violet-600/10 rounded-full blur-[80px]" />
        <div className="absolute top-[40%] left-[-5%] w-[400px] h-[400px] bg-emerald-500/6 rounded-full blur-[60px]" />
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
            <section className="relative z-10 max-w-7xl mx-auto px-6 pt-12 pb-20 grid lg:grid-cols-2 gap-10 lg:gap-12 items-center">
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
                    Jadi Juara Esports.
                  </span>
                </motion.h1>

                <motion.p initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
                  className="text-base text-slate-400 mb-8 max-w-lg leading-relaxed">
                  Arena catur kompetitif berbasis skill dengan event setiap jam.
                  Sistem Swiss yang adil, anti-cheat ketat, dan leaderboard real-time.
                </motion.p>

                <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25 }}
                  className="flex flex-wrap gap-3 mb-10">
                  <button onClick={() => setMode('register')}
                    className="flex items-center gap-2 px-7 py-3.5 bg-gradient-to-r from-sky-500 to-blue-600 rounded-2xl text-sm font-bold hover:opacity-90 transition-all shadow-2xl shadow-blue-500/30">
                    Mulai Bermain <ChevronRight className="w-4 h-4" />
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
              <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2, type: 'spring', stiffness: 100 }}
                className="flex items-center justify-center lg:justify-end lg:order-none order-first">
                <div className="relative w-full max-w-[420px]">
                  <div className="aspect-square w-full rounded-2xl overflow-hidden shadow-[0_0_80px_rgba(56,189,248,0.12)] border border-white/8 bg-[#0b1221]">
                    <ChessBoardVisual />
                  </div>
                  <div className="mt-3 sm:mt-4 grid grid-cols-3 gap-2">
                    {[
                      { label: 'Mode', value: 'Ranked Live' },
                      { label: 'Format', value: 'Blitz 3+2' },
                      { label: 'Sistem', value: 'Swiss Fair' },
                    ].map((item) => (
                      <div key={item.label} className="glass rounded-xl border border-white/10 px-2.5 sm:px-3 py-2 text-center">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider leading-none">{item.label}</div>
                        <div className="text-[11px] sm:text-xs font-semibold text-slate-200 mt-1 leading-tight">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </section>

            {/* ── Live Stats Ticker ─────────────────────────────── */}
            <div className="relative z-10 max-w-7xl mx-auto px-6 pb-6">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
                className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.04]">
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
                <p className="text-slate-400 max-w-md mx-auto">Mulai gratis, pilih divisi, dan fokus ke performa permainanmu.</p>
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
                      className="relative glass rounded-2xl p-6 border border-white/8 hover:border-white/15 transition-all group overflow-hidden">
                      <div className="relative h-28 rounded-xl border border-white/10 overflow-hidden mb-5 bg-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                        <Image
                          src={step.art}
                          alt={step.title}
                          fill
                          className="object-cover scale-[1.02] contrast-110 brightness-[0.85] saturate-[1.1]"
                        />
                        <div className="absolute inset-0 bg-gradient-to-tr from-sky-500/15 via-transparent to-amber-400/10" />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#060c18]/70 via-[#060c18]/25 to-transparent" />
                      </div>
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
                  <Trophy className="w-3.5 h-3.5" /> Tier Turnamen
                </div>
                <h2 className="text-3xl font-black mb-3">Pilih Tier, Bertanding, Naikkan Peringkat</h2>
                <p className="text-slate-400">Event otomatis setiap jam dengan sistem poin dan leaderboard kompetitif.</p>
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
                    <div className="relative h-24 rounded-xl border border-white/10 overflow-hidden mb-5 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                      <Image
                        src={tier.art}
                        alt={`Ilustrasi ${tier.label}`}
                        fill
                        className="object-cover contrast-110 brightness-[0.82] saturate-[1.08]"
                      />
                      <div className="absolute inset-0 bg-gradient-to-tr from-sky-500/10 via-transparent to-yellow-400/10" />
                      <div className="absolute inset-0 bg-gradient-to-r from-[#060c18]/60 via-[#060c18]/20 to-transparent" />
                    </div>
                    <div className="mb-5">
                      <div className="text-3xl font-black text-white mb-0.5">{tier.fee}</div>
                      <div className="text-xs text-slate-500">level kompetisi</div>
                    </div>
                    <div className="space-y-2.5 mb-6">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Kontrol Waktu</span>
                        <span className="font-bold text-white font-mono">{tier.tc}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Max Pemain</span>
                        <span className="font-bold text-white">{tier.max}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Reward</span>
                        <span className="font-bold text-yellow-400">{tier.prize}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">Jadwal</span>
                        <span className="font-bold text-sky-400">Setiap jam</span>
                      </div>
                    </div>
                    <button onClick={() => setMode('register')}
                      className="w-full py-2.5 rounded-xl text-sm font-bold bg-white/8 border border-white/10 hover:bg-white/15 transition-all">
                    Gabung Divisi →
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
                  { icon: Clock, label: 'Turnamen Tiap Jam', desc: '24 jam sehari', color: 'amber' },
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
              <div className="mt-6 grid md:grid-cols-3 gap-4">
                {[
                  { title: 'Kebijakan Fair Play', desc: 'Deteksi anti-cheat berlapis dan audit pertandingan otomatis.' },
                  { title: 'Ranking Transparan', desc: 'Perubahan ELO dan leaderboard diperbarui real-time.' },
                  { title: 'Aturan Kompetisi Jelas', desc: 'Syarat turnamen, status akun, dan proses banding terbuka.' },
                ].map((item) => (
                  <div key={item.title} className="glass rounded-2xl p-4 border border-white/8">
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="text-xs text-slate-400 mt-1.5">{item.desc}</p>
                  </div>
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
                    Daftar gratis, mainkan match pertama, dan naikkan ranking kamu hari ini.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button onClick={() => setMode('register')}
                    className="px-8 py-3.5 bg-gradient-to-r from-sky-500 to-blue-600 rounded-2xl font-bold text-base hover:opacity-90 transition-opacity shadow-2xl shadow-blue-500/30">
                      Daftar Gratis
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
                    <button onClick={() => setMode('login')} className="text-sm text-sky-400 hover:text-sky-300 transition-colors">Kembali ke Masuk</button>
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
                      Kembali ke Masuk
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
                  {mode === 'login' && (
                    <>
                      <div className="flex items-center gap-3 my-1">
                        <span className="h-px bg-white/10 flex-1" />
                        <span className="text-xs text-slate-500">atau</span>
                        <span className="h-px bg-white/10 flex-1" />
                      </div>
                      <div className="w-full flex justify-center">
                        {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
                          <div ref={googleBtnRef} />
                        ) : (
                          <p className="text-xs text-slate-500">Google Sign-In belum dikonfigurasi</p>
                        )}
                      </div>
                    </>
                  )}
                </form>

                <p className="text-xs text-slate-500 text-center mt-6">
                  Dengan mendaftar, kamu menyetujui{' '}
                  <a href="/terms" className="underline hover:text-slate-300 transition-colors">Syarat & Ketentuan</a>
                  {' '}dan{' '}
                  <a href="/privacy" className="underline hover:text-slate-300 transition-colors">Kebijakan Privasi</a>.
                </p>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Site-wide footer */}
      <footer className="border-t border-white/10 mt-4 px-6 py-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-slate-500">
        <span>© 2026 Chess Arena</span>
        <span className="text-white/10">·</span>
        <span>Platform kompetisi catur skill-based</span>
        <span className="text-white/10">·</span>
        <a href="/terms" className="hover:text-slate-300 transition-colors">Syarat & Ketentuan</a>
        <a href="/privacy" className="hover:text-slate-300 transition-colors">Kebijakan Privasi</a>
        <a href="/appeal" className="hover:text-slate-300 transition-colors">Banding</a>
        <a href="mailto:igrahateknik@gmail.com" className="hover:text-slate-300 transition-colors">Kontak</a>
      </footer>
    </div>
  );
}

// ── Live Stats Ticker ─────────────────────────────────────────────────────────
const TICKER_ITEMS = [
  { icon: '🟢', text: '1,247 Pemain Online Sekarang' },
  { icon: '🏆', text: 'Turnamen berlangsung setiap jam' },
  { icon: '🏅', text: 'Leaderboard diperbarui real-time setiap match' },
  { icon: '⚡', text: 'Rata-rata 3 menit menunggu lawan' },
  { icon: '🛡️', text: '5 lapis anti-cheat aktif 24/7' },
  { icon: '🎯', text: 'Swiss system — pertandingan adil' },
  { icon: '🎮', text: 'Kompetisi full skill-based tanpa unsur keberuntungan' },
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
  const [chess] = useState(() => new Chess());
  const [position, setPosition] = useState('start');
  const [moveIndex, setMoveIndex] = useState(0);
  const sequence = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];

  useEffect(() => {
    const timer = setInterval(() => {
      if (moveIndex >= sequence.length) {
        chess.reset();
        setPosition(chess.fen());
        setMoveIndex(0);
        return;
      }
      chess.move(sequence[moveIndex]);
      setPosition(chess.fen());
      setMoveIndex((v) => v + 1);
    }, 1300);
    return () => clearInterval(timer);
  }, [moveIndex, chess]);

  return (
    <div className="w-full h-full">
      <Chessboard
        position={position}
        arePiecesDraggable={false}
        areArrowsAllowed={false}
        boardOrientation="white"
        customDarkSquareStyle={{ backgroundColor: '#7b5a3e' }}
        customLightSquareStyle={{ backgroundColor: '#f0d9b5' }}
        customBoardStyle={{ borderRadius: '14px' }}
      />
    </div>
  );
}

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
    art: '/illustrations/register-card.svg',
    title: 'Daftar Gratis',
    desc: 'Buat akun dalam 30 detik. Verifikasi email dan mulai bermain langsung.',
    color: 'sky',
  },
  {
    step: '02',
    icon: Ticket,
    art: '/illustrations/ticket-card.svg',
    title: 'Pilih Divisi',
    desc: 'Pilih divisi Bronze, Silver, atau Gold sesuai target performa kamu.',
    color: 'amber',
  },
  {
    step: '03',
    icon: Swords,
    art: '/illustrations/battle-card.svg',
    title: 'Gabung Turnamen',
    desc: 'Turnamen otomatis setiap jam. Daftar, tunggu mulai, lalu bertanding.',
    color: 'purple',
  },
  {
    step: '04',
    icon: Trophy,
    art: '/illustrations/rank-card.svg',
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
    art: '/illustrations/register-card.svg',
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
    art: '/illustrations/ticket-card.svg',
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
    art: '/illustrations/battle-card.svg',
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
    <div className="min-h-screen bg-[#06070f] text-white overflow-x-hidden relative">
      {/* ── Premium Background ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {/* Gold primary orb */}
        <div className="absolute top-[-15%] right-[5%] w-[800px] h-[800px] bg-amber-500/10 rounded-full blur-[130px] animate-pulse-slow" />
        {/* Deep gold secondary */}
        <div className="absolute top-[30%] left-[-10%] w-[600px] h-[600px] bg-yellow-600/8 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '2s' }} />
        {/* Subtle blue accent */}
        <div className="absolute bottom-[-10%] right-[20%] w-[500px] h-[500px] bg-sky-600/6 rounded-full blur-[100px]" />
        {/* Chess pattern grid */}
        <div className="absolute inset-0 opacity-[0.018]"
          style={{ backgroundImage: 'linear-gradient(rgba(245,158,11,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.8) 1px, transparent 1px)', backgroundSize: '80px 80px' }} />
        {/* Diagonal light ray */}
        <div className="absolute top-0 left-1/2 w-px h-[60vh] bg-gradient-to-b from-amber-400/20 to-transparent" />
      </div>

      <AnimatePresence mode="wait">
        {mode === 'landing' && (
          <motion.div key="landing" className="relative z-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }}>

            {/* ── Nav ── */}
            <nav className="relative z-20 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
              <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/40">
                  <span className="text-xl">♔</span>
                </div>
                <span className="text-xl font-black tracking-tight">Chess<span className="gradient-text">Arena</span></span>
              </motion.div>
              <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex items-center gap-2">
                <button onClick={() => setMode('login')}
                  className="px-5 py-2 text-sm font-semibold text-amber-400/80 hover:text-amber-300 border border-amber-500/20 hover:border-amber-500/40 rounded-xl transition-all">
                  Masuk
                </button>
                <button onClick={() => setMode('register')}
                  className="btn-gold px-5 py-2 rounded-xl text-sm font-bold text-black">
                  Daftar Gratis
                </button>
              </motion.div>
            </nav>

            {/* ── HERO ── */}
            <section className="relative z-10 max-w-7xl mx-auto px-6 pt-10 pb-24 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              <div>
                {/* Badge */}
                <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold mb-7 tracking-widest uppercase">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-lg shadow-amber-400/50" />
                  Platform Esports Catur #1 Indonesia
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-lg shadow-amber-400/50" />
                </motion.div>

                {/* Headline */}
                <motion.h1 initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }}
                  className="text-5xl lg:text-6xl xl:text-[4.5rem] font-black leading-[1.04] tracking-tight mb-6">
                  <span className="text-white">Kuasai Papan.</span><br />
                  <span className="text-white">Jadi </span>
                  <span className="gradient-text">Grandmaster.</span>
                </motion.h1>

                <motion.p initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
                  className="text-lg text-slate-400 mb-9 max-w-lg leading-relaxed">
                  Platform esports catur paling kompetitif di Indonesia. Turnamen setiap jam,
                  anti-cheat 5 lapis, dan sistem ELO berstandar FIDE.
                </motion.p>

                {/* CTA Buttons */}
                <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25 }}
                  className="flex flex-wrap gap-4 mb-12">
                  <button onClick={() => setMode('register')}
                    className="btn-gold flex items-center gap-2.5 px-8 py-4 rounded-2xl text-base font-black text-black">
                    <Crown className="w-5 h-5" /> Mulai Bertanding
                  </button>
                  <button onClick={() => setMode('login')}
                    className="flex items-center gap-2 px-8 py-4 rounded-2xl text-base font-bold text-white border border-white/15 hover:border-amber-500/40 hover:bg-amber-500/5 transition-all">
                    Sudah Punya Akun <ChevronRight className="w-4 h-4" />
                  </button>
                </motion.div>

                {/* Stats strip */}
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.32 }}
                  className="grid grid-cols-4 gap-5 pt-7 border-t border-amber-500/10">
                  {STATS.map((s) => (
                    <div key={s.label}>
                      <div className="text-2xl font-black gradient-text">{s.value}</div>
                      <div className="text-xs text-slate-500 mt-1 leading-tight">{s.label}</div>
                    </div>
                  ))}
                </motion.div>
              </div>

              {/* Chess board — with premium gold glow */}
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2, type: 'spring', stiffness: 80 }}
                className="flex items-center justify-center lg:justify-end order-first lg:order-none">
                <div className="relative w-full max-w-[440px]">
                  {/* Outer glow ring */}
                  <div className="absolute -inset-4 bg-gradient-to-br from-amber-500/15 via-yellow-400/5 to-transparent rounded-3xl blur-xl" />
                  <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-amber-500/20 to-transparent" />

                  <div className="relative aspect-square w-full rounded-2xl overflow-hidden board-glow border border-amber-500/20 bg-[#0a0c15]">
                    {/* Gold corner accents */}
                    <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-amber-400/60 rounded-tl-2xl z-10" />
                    <div className="absolute top-0 right-0 w-12 h-12 border-t-2 border-r-2 border-amber-400/60 rounded-tr-2xl z-10" />
                    <div className="absolute bottom-0 left-0 w-12 h-12 border-b-2 border-l-2 border-amber-400/60 rounded-bl-2xl z-10" />
                    <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-amber-400/60 rounded-br-2xl z-10" />
                    <ChessBoardVisual />
                  </div>

                  {/* Board info strip */}
                  <div className="mt-4 grid grid-cols-3 gap-2.5">
                    {[
                      { label: 'Mode', value: 'Ranked Live' },
                      { label: 'Format', value: 'Blitz 3+2' },
                      { label: 'Sistem', value: 'Swiss Fair' },
                    ].map((item) => (
                      <div key={item.label} className="glass-gold rounded-xl px-3 py-2.5 text-center">
                        <div className="text-[10px] text-amber-500/60 uppercase tracking-widest leading-none">{item.label}</div>
                        <div className="text-xs font-bold text-amber-200 mt-1">{item.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Live indicator */}
                  <div className="mt-3 flex items-center justify-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-lg shadow-emerald-400/50" />
                    <span className="text-xs text-emerald-400 font-semibold tracking-wider uppercase">Demo Langsung</span>
                  </div>
                </div>
              </motion.div>
            </section>

            {/* ── Live Ticker ── */}
            <div className="relative z-10 max-w-7xl mx-auto px-6 pb-8">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
                className="overflow-hidden rounded-2xl border border-amber-500/15 bg-amber-500/[0.03]">
                <LiveStatsTicker />
              </motion.div>
            </div>

            {/* ── Cara Bermain ── */}
            <section className="relative z-10 max-w-7xl mx-auto px-6 py-24 border-t border-amber-500/8">
              <motion.div initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }}
                className="text-center mb-16">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-bold uppercase tracking-widest mb-5">
                  <Target className="w-3.5 h-3.5" /> Cara Bermain
                </div>
                <h2 className="text-4xl font-black mb-4">Dari Daftar ke <span className="gradient-text">Menang</span> dalam 4 Langkah</h2>
                <p className="text-slate-400 max-w-md mx-auto text-lg">Mulai gratis, pilih divisi, dan fokus ke performa permainanmu.</p>
              </motion.div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {HOW_IT_WORKS.map((step, i) => (
                  <motion.div key={step.step}
                    initial={{ y: 30, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }}
                    viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                    className="glass-gold rounded-2xl p-6 transition-all group relative overflow-hidden cursor-default">
                    {/* Big step number watermark */}
                    <div className="text-[5rem] font-black text-amber-400/5 absolute -top-2 -right-2 select-none leading-none">{step.step}</div>
                    {/* Step number pill */}
                    <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-sm font-black mb-5">
                      {step.step}
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 group-hover:border-amber-500/40 group-hover:bg-amber-500/5 transition-all">
                      <step.icon className="w-6 h-6 text-amber-400" />
                    </div>
                    <h3 className="font-black text-white text-lg mb-2">{step.title}</h3>
                    <p className="text-sm text-slate-400 leading-relaxed">{step.desc}</p>
                    {i < 3 && (
                      <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-px bg-gradient-to-r from-amber-500/30 to-transparent z-10" />
                    )}
                  </motion.div>
                ))}
              </div>
            </section>

            {/* ── Tournament Tiers ── */}
            <section className="relative z-10 max-w-7xl mx-auto px-6 py-24 border-t border-amber-500/8">
              <motion.div initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }}
                className="text-center mb-16">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-bold uppercase tracking-widest mb-5">
                  <Trophy className="w-3.5 h-3.5" /> Divisi Kompetisi
                </div>
                <h2 className="text-4xl font-black mb-4">Pilih <span className="gradient-text">Divisi</span>, Bertanding, Naik Peringkat</h2>
                <p className="text-slate-400 text-lg">Event otomatis setiap jam — siap kapanpun kamu mau bertanding.</p>
              </motion.div>

              <div className="grid md:grid-cols-3 gap-6">
                {[
                  {
                    key: 'bronze', label: 'Bronze', icon: '🥉',
                    subtitle: 'Divisi Pemula', tc: '3+2', max: 32, prize: '+120 PTS',
                    bg: 'bg-gradient-to-b from-amber-900/30 to-amber-950/20',
                    border: 'border-amber-700/30 hover:border-amber-600/50',
                    badge: 'bg-amber-700/20 text-amber-500 border-amber-700/30',
                    glow: '',
                  },
                  {
                    key: 'silver', label: 'Silver', icon: '🥈',
                    subtitle: 'Divisi Menengah', tc: '5+3', max: 32, prize: '+240 PTS',
                    bg: 'bg-gradient-to-b from-slate-700/30 to-slate-800/20',
                    border: 'border-slate-400/40 hover:border-slate-300/60',
                    badge: 'bg-slate-500/20 text-slate-300 border-slate-400/30',
                    glow: 'shadow-xl shadow-white/5',
                    featured: true,
                  },
                  {
                    key: 'gold', label: 'Gold', icon: '🥇',
                    subtitle: 'Divisi Pro', tc: '10+5', max: 16, prize: '+360 PTS',
                    bg: 'bg-gradient-to-b from-amber-500/20 to-yellow-900/15',
                    border: 'border-amber-400/50 hover:border-amber-300/70',
                    badge: 'bg-amber-400/20 text-amber-300 border-amber-400/30',
                    glow: 'shadow-2xl shadow-amber-500/15 neon-gold',
                  },
                ].map((tier, i) => (
                  <motion.div key={tier.key}
                    initial={{ y: 30, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }}
                    viewport={{ once: true }} transition={{ delay: i * 0.12 }}
                    className={`relative rounded-2xl p-7 border ${tier.bg} ${tier.border} ${tier.glow} transition-all duration-300 hover:-translate-y-2`}>
                    {(tier as { featured?: boolean }).featured && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-slate-400 text-slate-900 rounded-full text-[11px] font-black uppercase tracking-widest">
                        Populer
                      </div>
                    )}
                    {tier.key === 'gold' && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 btn-gold text-black rounded-full text-[11px] font-black uppercase tracking-widest">
                        ★ Pro Tier
                      </div>
                    )}

                    <div className="flex items-center gap-3 mb-6">
                      <span className="text-4xl">{tier.icon}</span>
                      <div>
                        <div className={`text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${tier.badge}`}>{tier.label}</div>
                        <div className="text-slate-500 text-xs mt-1">{tier.subtitle}</div>
                      </div>
                    </div>

                    <div className="space-y-3 mb-7">
                      {[
                        { label: 'Kontrol Waktu', value: tier.tc, mono: true },
                        { label: 'Max Pemain', value: String(tier.max), mono: false },
                        { label: 'Reward', value: tier.prize, gold: true },
                        { label: 'Jadwal', value: 'Setiap jam', sky: true },
                      ].map((row) => (
                        <div key={row.label} className="flex items-center justify-between text-sm py-2 border-b border-white/5">
                          <span className="text-slate-500">{row.label}</span>
                          <span className={`font-bold ${(row as { mono?: boolean }).mono ? 'font-mono text-white' : (row as { gold?: boolean }).gold ? 'text-amber-400' : (row as { sky?: boolean }).sky ? 'text-sky-400' : 'text-white'}`}>
                            {row.value}
                          </span>
                        </div>
                      ))}
                    </div>

                    <button onClick={() => setMode('register')}
                      className={`w-full py-3 rounded-xl text-sm font-black transition-all ${
                        tier.key === 'gold'
                          ? 'btn-gold text-black'
                          : 'bg-white/6 border border-white/10 hover:bg-white/12 text-white'
                      }`}>
                      Gabung {tier.label} →
                    </button>
                  </motion.div>
                ))}
              </div>
            </section>

            {/* ── Features ── */}
            <section className="relative z-10 max-w-7xl mx-auto px-6 py-20 border-t border-amber-500/8">
              <motion.div initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }}
                className="text-center mb-12">
                <h2 className="text-3xl font-black mb-3">Platform <span className="gradient-text">Kelas Dunia</span></h2>
                <p className="text-slate-400">Dibangun dengan teknologi terdepan untuk pengalaman esports terbaik.</p>
              </motion.div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { icon: Zap, label: 'Bullet & Blitz', desc: '1+0, 3+2, 5+3', color: 'from-sky-500/10 to-blue-600/5', border: 'border-sky-500/20 hover:border-sky-400/40', icon_color: 'text-sky-400' },
                  { icon: Shield, label: 'Anti-Cheat AI', desc: '5 lapis keamanan', color: 'from-emerald-500/10 to-green-600/5', border: 'border-emerald-500/20 hover:border-emerald-400/40', icon_color: 'text-emerald-400' },
                  { icon: Award, label: 'ELO Rating', desc: 'Standard FIDE', color: 'from-violet-500/10 to-purple-600/5', border: 'border-violet-500/20 hover:border-violet-400/40', icon_color: 'text-violet-400' },
                  { icon: Clock, label: 'Turnamen 24/7', desc: 'Setiap jam', color: 'from-amber-500/10 to-yellow-600/5', border: 'border-amber-500/20 hover:border-amber-400/40', icon_color: 'text-amber-400' },
                ].map((f, i) => (
                  <motion.div key={f.label}
                    initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }}
                    viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                    className={`rounded-2xl p-6 border bg-gradient-to-br ${f.color} ${f.border} transition-all group`}>
                    <div className={`w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                      <f.icon className={`w-6 h-6 ${f.icon_color}`} />
                    </div>
                    <div className="font-bold text-white mb-1">{f.label}</div>
                    <div className="text-sm text-slate-500">{f.desc}</div>
                  </motion.div>
                ))}
              </div>

              <div className="mt-5 grid md:grid-cols-3 gap-4">
                {[
                  { title: '⚖️ Kebijakan Fair Play', desc: 'Deteksi anti-cheat berlapis dan audit pertandingan otomatis setiap game.' },
                  { title: '📊 Ranking Transparan', desc: 'Perubahan ELO dan leaderboard diperbarui real-time setiap match selesai.' },
                  { title: '📋 Aturan Kompetisi Jelas', desc: 'Syarat turnamen, status akun, dan proses banding terbuka dan tertulis.' },
                ].map((item) => (
                  <div key={item.title} className="glass-gold rounded-2xl p-5">
                    <p className="text-sm font-bold text-white mb-2">{item.title}</p>
                    <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* ── CTA ── */}
            <section className="relative z-10 max-w-4xl mx-auto px-6 py-24 text-center">
              <motion.div initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }}
                className="relative overflow-hidden rounded-3xl p-14 border border-amber-500/20"
                style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(6,7,15,0.95) 50%, rgba(245,158,11,0.05) 100%)' }}>
                {/* Glow */}
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/8 to-yellow-600/5 rounded-3xl" />
                {/* Corner ornaments */}
                <div className="absolute top-0 left-0 w-20 h-20 border-t-2 border-l-2 border-amber-400/40 rounded-tl-3xl" />
                <div className="absolute top-0 right-0 w-20 h-20 border-t-2 border-r-2 border-amber-400/40 rounded-tr-3xl" />
                <div className="absolute bottom-0 left-0 w-20 h-20 border-b-2 border-l-2 border-amber-400/40 rounded-bl-3xl" />
                <div className="absolute bottom-0 right-0 w-20 h-20 border-b-2 border-r-2 border-amber-400/40 rounded-br-3xl" />

                <div className="relative z-10">
                  <div className="w-20 h-20 btn-gold rounded-2xl flex items-center justify-center mx-auto mb-6 text-3xl text-black animate-float">
                    ♔
                  </div>
                  <h2 className="text-4xl lg:text-5xl font-black mb-4">
                    Siap Jadi <span className="gradient-text">Grandmaster</span>?
                  </h2>
                  <p className="text-slate-400 mb-10 max-w-md mx-auto text-lg">
                    Daftar gratis sekarang, mainkan match pertama, dan mulai perjalanan esports caturmu.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-4">
                    <button onClick={() => setMode('register')}
                      className="btn-gold flex items-center gap-2.5 px-10 py-4 rounded-2xl font-black text-lg text-black">
                      <Crown className="w-5 h-5" /> Daftar Gratis Sekarang
                    </button>
                    <button onClick={() => setMode('login')}
                      className="px-10 py-4 rounded-2xl font-bold text-lg border border-white/15 hover:border-amber-500/30 text-slate-300 hover:text-white transition-all">
                      Sudah Punya Akun
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

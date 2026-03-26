'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import {
  Eye, EyeOff, Crown, Zap, Shield, Globe, TrendingUp,
  ChevronRight, DollarSign, Award
} from 'lucide-react';

const FEATURES = [
  { icon: Zap, label: 'Bullet & Blitz', desc: 'Fast-paced competitive chess' },
  { icon: DollarSign, label: 'Real Money', desc: 'Play & earn real rewards' },
  { icon: Shield, label: 'Anti-Cheat', desc: 'Fair play guaranteed' },
  { icon: Globe, label: 'Global', desc: 'Players from 150+ countries' },
  { icon: Award, label: 'Tournaments', desc: 'Weekly prize pools' },
  { icon: TrendingUp, label: 'ELO Rating', desc: 'FIDE-standard ranking' },
];

const STATS = [
  { value: '2.4M+', label: 'Active Players' },
  { value: '$12M+', label: 'Prize Paid Out' },
  { value: '50M+', label: 'Games Played' },
  { value: '150+', label: 'Countries' },
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

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError('');
    try {
      let data;
      if (mode === 'register') {
        data = await api.auth.register({ username: form.username, email: form.email, password: form.password });
      } else {
        data = await api.auth.login({ email: form.email, password: form.password });
      }
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
      }, data.token);
      router.push('/dashboard');
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
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
      // Fallback to local guest if backend unreachable
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
    <div className="min-h-screen bg-[#050a14] text-white overflow-hidden relative">
      {/* Animated background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[100px] animate-pulse-slow" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-[80px]" />
        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '50px 50px' }} />
      </div>

      <AnimatePresence mode="wait">
        {mode === 'landing' && (
          <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }}>
            {/* Nav */}
            <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
              <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex items-center gap-2">
                <div className="w-9 h-9 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                  <span className="text-xl">♔</span>
                </div>
                <span className="text-xl font-bold tracking-tight">Chess<span className="gradient-text">Arena</span></span>
              </motion.div>
              <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex items-center gap-3">
                <button onClick={() => setMode('login')}
                  className="px-5 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
                  Sign In
                </button>
                <button onClick={() => setMode('register')}
                  className="px-5 py-2 bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/25">
                  Get Started
                </button>
              </motion.div>
            </nav>

            {/* Hero */}
            <section className="relative z-10 max-w-7xl mx-auto px-6 pt-16 pb-24 grid lg:grid-cols-2 gap-16 items-center">
              <div>
                <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-sm font-medium mb-6">
                  <Zap className="w-4 h-4" />
                  <span>World-Class Chess Platform</span>
                </motion.div>
                <motion.h1 initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
                  className="text-5xl lg:text-6xl xl:text-7xl font-black leading-[1.05] mb-6">
                  Play Chess.<br />
                  <span className="gradient-text">Earn Real</span><br />
                  Rewards.
                </motion.h1>
                <motion.p initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
                  className="text-lg text-slate-400 mb-10 max-w-lg leading-relaxed">
                  The most advanced chess platform with real money stakes, professional tournaments, and AI powered by Stockfish. Join 2.4M+ players worldwide.
                </motion.p>
                <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}
                  className="flex flex-wrap gap-4">
                  <button onClick={() => setMode('register')}
                    className="flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-sky-500 to-blue-600 rounded-2xl text-base font-bold hover:opacity-90 transition-all shadow-2xl shadow-blue-500/30 neon-blue">
                    Start Playing Free <ChevronRight className="w-5 h-5" />
                  </button>
                  <button onClick={handleGuest}
                    className="flex items-center gap-2 px-8 py-4 bg-white/5 border border-white/10 rounded-2xl text-base font-semibold hover:bg-white/10 transition-all">
                    {loading ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                    Play as Guest
                  </button>
                </motion.div>
                {/* Mini stats */}
                <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }}
                  className="flex flex-wrap gap-8 mt-12">
                  {STATS.map((s) => (
                    <div key={s.label}>
                      <div className="text-2xl font-black gradient-gold">{s.value}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </motion.div>
              </div>

              {/* Chess board visual */}
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.3, type: 'spring' }}
                className="hidden lg:flex items-center justify-center">
                <div className="relative">
                  <div className="w-[420px] h-[420px] rounded-2xl overflow-hidden shadow-[0_0_80px_rgba(56,189,248,0.15)] border border-white/10">
                    <ChessBoardVisual />
                  </div>
                  {/* Floating cards */}
                  <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity }}
                    className="absolute -left-14 top-8 glass rounded-2xl p-4 flex items-center gap-3 border border-white/10">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">ELO Rating</div>
                      <div className="text-lg font-bold text-emerald-400">+42 today</div>
                    </div>
                  </motion.div>
                  <motion.div animate={{ y: [0, 8, 0] }} transition={{ duration: 3.5, repeat: Infinity }}
                    className="absolute -right-14 bottom-12 glass rounded-2xl p-4 flex items-center gap-3 border border-white/10">
                    <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-yellow-400" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Tournament Prize</div>
                      <div className="text-lg font-bold text-yellow-400">Rp 5.000.000</div>
                    </div>
                  </motion.div>
                  <motion.div animate={{ y: [-4, 4, -4] }} transition={{ duration: 4, repeat: Infinity }}
                    className="absolute -left-10 bottom-8 glass rounded-2xl p-3 flex items-center gap-2 border border-white/10">
                    <div className="flex -space-x-2">
                      {['🇮🇩', '🇺🇸', '🇷🇺', '🇳🇴'].map((f, i) => (
                        <div key={i} className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-sm border border-white/20">{f}</div>
                      ))}
                    </div>
                    <span className="text-sm text-slate-300 font-medium">+2.4M players</span>
                  </motion.div>
                </div>
              </motion.div>
            </section>

            {/* Features */}
            <section className="relative z-10 max-w-7xl mx-auto px-6 py-20 border-t border-white/5">
              <motion.div initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }}
                className="text-center mb-14">
                <h2 className="text-3xl font-bold mb-3">Everything You Need to Compete</h2>
                <p className="text-slate-400">Professional-grade tools for serious players</p>
              </motion.div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {FEATURES.map((f, i) => (
                  <motion.div key={f.label} initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }}
                    viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                    className="glass rounded-2xl p-6 hover:bg-white/10 transition-all group cursor-default">
                    <div className="w-12 h-12 rounded-xl bg-sky-500/10 flex items-center justify-center mb-4 group-hover:bg-sky-500/20 transition-colors">
                      <f.icon className="w-6 h-6 text-sky-400" />
                    </div>
                    <div className="font-semibold mb-1">{f.label}</div>
                    <div className="text-sm text-slate-400">{f.desc}</div>
                  </motion.div>
                ))}
              </div>
            </section>

            {/* CTA */}
            <section className="relative z-10 max-w-4xl mx-auto px-6 py-20 text-center">
              <motion.div initial={{ y: 20, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }}
                className="glass rounded-3xl p-12 border border-white/10">
                <Crown className="w-12 h-12 text-yellow-400 mx-auto mb-6" />
                <h2 className="text-3xl font-black mb-4">Ready to Dominate the Board?</h2>
                <p className="text-slate-400 mb-8">Join the world&apos;s most competitive chess platform today.</p>
                <button onClick={() => setMode('register')}
                  className="px-10 py-4 bg-gradient-to-r from-sky-500 to-blue-600 rounded-2xl font-bold text-lg hover:opacity-90 transition-opacity shadow-2xl shadow-blue-500/30">
                  Create Free Account
                </button>
              </motion.div>
            </section>
          </motion.div>
        )}

        {mode === 'forgot' && (
          <motion.div key="forgot" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="min-h-screen flex items-center justify-center px-4">
            <div className="w-full max-w-md">
              <div className="text-center mb-8">
                <button onClick={() => setMode('login')} className="inline-flex items-center gap-2 mb-6 hover:opacity-80 transition-opacity">
                  <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                    <span className="text-2xl">♔</span>
                  </div>
                  <span className="text-2xl font-bold">Chess<span className="gradient-text">Arena</span></span>
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

        {(mode === 'login' || mode === 'register') && (
          <motion.div key="auth" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="min-h-screen flex items-center justify-center px-4">
            <div className="w-full max-w-md">
              {/* Logo */}
              <div className="text-center mb-8">
                <button onClick={() => setMode('landing')} className="inline-flex items-center gap-2 mb-6 hover:opacity-80 transition-opacity">
                  <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                    <span className="text-2xl">♔</span>
                  </div>
                  <span className="text-2xl font-bold">Chess<span className="gradient-text">Arena</span></span>
                </button>
                <h1 className="text-2xl font-bold">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
                <p className="text-slate-400 mt-2 text-sm">
                  {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
                  <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                    className="text-sky-400 hover:text-sky-300 font-medium transition-colors">
                    {mode === 'login' ? 'Sign up' : 'Sign in'}
                  </button>
                </p>
              </div>

              <div className="glass rounded-2xl p-8 border border-white/10">
                {authError && (
                  <div className="flex items-center gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                    <span>⚠</span> {authError}
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
                      <button type="button" onClick={() => { setMode('forgot'); setAuthError(''); setForgotSuccess(''); }} className="text-sm text-sky-400 hover:text-sky-300 transition-colors">Forgot password?</button>
                    </div>
                  )}
                  <button type="submit" disabled={loading}
                    className="w-full py-3.5 bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl font-semibold text-base hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 disabled:opacity-70">
                    {loading ? (
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      mode === 'login' ? 'Sign In' : 'Create Account'
                    )}
                  </button>
                </form>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-4 bg-transparent text-slate-500">or continue with</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {['Google', 'Discord'].map((provider) => (
                    <button key={provider} onClick={handleAuth}
                      className="flex items-center justify-center gap-2 py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-medium hover:bg-white/10 transition-colors">
                      <span>{provider === 'Google' ? '🔵' : '🟣'}</span>
                      {provider}
                    </button>
                  ))}
                </div>

                <p className="text-xs text-slate-500 text-center mt-6">
                  By continuing, you agree to our{' '}
                  <a href="/terms" className="underline hover:text-slate-300 transition-colors">Terms of Service</a>
                  {' '}and{' '}
                  <a href="/privacy" className="underline hover:text-slate-300 transition-colors">Privacy Policy</a>.
                </p>
              </div>

              <div className="mt-4 text-center">
                <button onClick={handleGuest}
                  className="text-sm text-slate-400 hover:text-slate-300 transition-colors underline underline-offset-2">
                  Continue as Guest
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Static chess board visual for hero section
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
              className={`flex items-center justify-center text-3xl select-none
                ${isHighlight ? 'bg-yellow-500/40' : isLight ? 'bg-slate-200/15' : 'bg-slate-800/50'}`}>
              <span className={piece ? (r < 2 ? 'text-slate-300' : 'text-white drop-shadow-lg') : ''}>
                {piece}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

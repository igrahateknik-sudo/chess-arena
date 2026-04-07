'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Brain, Users, Clock, ChevronRight, X, Search, Shield, Wifi, Star } from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import ChessGame from '@/components/chess/ChessGame';
import OnlineGame from '@/components/chess/OnlineGame';
import { useAppStore } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { TIME_CONTROLS } from '@/lib/mock-data';
import { getSocket, disconnectSocket } from '@/lib/socket';
import type { GameMode, TimeControl, Player } from '@/types';

type Step = 'lobby' | 'mode' | 'matchmaking' | 'playing-ai' | 'playing-online';

const AI_LEVELS = [
  { id: 'ai-easy' as GameMode, name: 'Easy', elo: 800, desc: 'Makes occasional mistakes. Great for beginners.', icon: '😊', color: 'emerald' },
  { id: 'ai-medium' as GameMode, name: 'Medium', elo: 1400, desc: 'Solid tactical play. Good challenge for intermediates.', icon: '🤔', color: 'yellow' },
  { id: 'ai-hard' as GameMode, name: 'Hard', elo: 2200, desc: 'Deep calculation. Very difficult to beat.', icon: '😤', color: 'red' },
];

interface FoundGame {
  gameId: string;
  white: Player & { title?: string };
  black: Player & { title?: string };
  timeControl: TimeControl;
  stakes: number;
  playerColor: 'white' | 'black';
}

export default function GamePage() {
  const { user, token } = useAppStore();
  const router = useRouter();
  const [step, setStep] = useState<Step>('lobby');
  const [gameMode, setGameMode] = useState<GameMode>('pvp-online');
  const [selectedTC, setSelectedTC] = useState(TIME_CONTROLS[3]);
  const [playerColor, setPlayerColor] = useState<'white' | 'black' | 'random'>('random');
  const [aiLevel, setAiLevel] = useState<GameMode>('ai-medium');

  // Matchmaking
  const [matchmakingTime, setMatchmakingTime] = useState(0);
  const matchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [onlineUsers, setOnlineUsers] = useState(0);
  const [matchmakingError, setMatchmakingError] = useState('');

  // Active online game
  const [foundGame, setFoundGame] = useState<FoundGame | null>(null);

  // Connect socket when token is available, track online users
  useEffect(() => {
    if (!token) return;
    try {
      const socket = getSocket(token);
      socket.on('lobby:online', ({ count }: { count: number }) => setOnlineUsers(count));
      socket.on('lobby:state', ({ onlinePlayers }: { onlinePlayers: any[] }) => setOnlineUsers(onlinePlayers.length));
      return () => {
        socket.off('lobby:online');
        socket.off('lobby:state');
      };
    } catch {}
  }, [token]);

  const startMatchmaking = () => {
    if (!token) {
      router.push('/');
      return;
    }

    setStep('matchmaking');
    setMatchmakingTime(0);
    setMatchmakingError('');

    // Start matchmaking timer display
    matchTimerRef.current = setInterval(() => setMatchmakingTime(t => t + 1), 1000);

    const socket = getSocket(token);

    // Listen for match found
    socket.once('game:found', (data: any) => {
      clearInterval(matchTimerRef.current!);
      const myId = user?.id;
      const isWhite = data.white.id === myId;
      setFoundGame({
        gameId: data.gameId,
        white: data.white,
        black: data.black,
        timeControl: data.timeControl,
        stakes: data.stakes,
        playerColor: isWhite ? 'white' : 'black',
      });
      setStep('playing-online');
    });

    socket.emit('queue:join', {
      timeControl: selectedTC,
      stakes: 0,
      color: playerColor === 'random' ? null : playerColor,
    });

    socket.on('queue:joined', (data: any) => console.log('[Queue]', data));
    socket.once('queue:error', (data: { message?: string }) => {
      setMatchmakingError(data?.message || 'Gagal masuk antrean. Coba lagi dalam beberapa detik.');
    });
  };

  const cancelMatchmaking = () => {
    clearInterval(matchTimerRef.current!);
    if (token) {
      try {
        const socket = getSocket(token);
        socket.emit('queue:leave');
        socket.off('game:found');
      } catch {}
    }
    setStep('mode');
  };

  useEffect(() => {
    if (step !== 'matchmaking') return;
    if (matchmakingTime >= 45) {
      setMatchmakingError('Belum ada lawan yang cocok. Kamu bisa lanjut menunggu atau ubah kontrol waktu.');
    }
  }, [matchmakingTime, step]);

  // Compute once per playerColor selection — NOT on every render.
  // Without useMemo, re-renders from socket events would re-randomize mid-game.
  const actualColor = useMemo<'white' | 'black'>(
    () => playerColor === 'random' ? (Math.random() > 0.5 ? 'white' : 'black') : playerColor,
    [playerColor]
  );

  const aiOpponent: Player = {
    id: 'ai',
    username: `Stockfish (${AI_LEVELS.find(a => a.id === aiLevel)?.name || 'AI'})`,
    avatar: 'https://api.dicebear.com/9.x/bottts/svg?seed=stockfish',
    elo: aiLevel === 'ai-easy' ? 800 : aiLevel === 'ai-medium' ? 1400 : 2200,
    timeLeft: selectedTC.initial,
  };

  if (step === 'playing-ai') {
    return (
      <AppLayout>
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl font-bold text-[var(--text-primary)]">vs {aiOpponent.username}</h1>
              <p className="text-sm text-[var(--text-muted)]">{selectedTC.label} • Free game</p>
            </div>
            <button onClick={() => setStep('lobby')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--bg-hover)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--border)] transition-colors">
              <X className="w-4 h-4" /> Exit
            </button>
          </div>
          <ChessGame mode={aiLevel} timeControl={selectedTC} stakes={0} opponent={aiOpponent} playerColor={actualColor} />
        </div>
      </AppLayout>
    );
  }

  if (!token) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto py-16 text-center">
          <h1 className="text-3xl font-black text-[var(--text-primary)] mb-3">Login Diperlukan</h1>
          <p className="text-[var(--text-muted)] mb-6">Mode tamu sudah dinonaktifkan. Silakan masuk atau daftar untuk bermain.</p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-semibold hover:opacity-90 transition-opacity"
          >
            Ke Halaman Masuk
          </button>
        </div>
      </AppLayout>
    );
  }

  if (step === 'playing-online' && foundGame) {
    return (
      <AppLayout>
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live Match
              </h1>
              <p className="text-sm text-[var(--text-muted)]">
                {foundGame.white.username} vs {foundGame.black.username} • {foundGame.timeControl.label}
              </p>
            </div>
            <button onClick={() => { setStep('lobby'); setFoundGame(null); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--bg-hover)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--border)] transition-colors">
              <X className="w-4 h-4" /> Exit
            </button>
          </div>
          <OnlineGame
            gameId={foundGame.gameId}
            playerColor={foundGame.playerColor}
            white={foundGame.white}
            black={foundGame.black}
            timeControl={foundGame.timeControl}
            stakes={foundGame.stakes}
            token={token}
            onGameEnd={(result, eloChange) => console.log('Game ended:', result, eloChange)}
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto">
        <AnimatePresence mode="wait">

          {/* Lobby */}
          {step === 'lobby' && (
            <motion.div key="lobby" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <div className="mb-7">
              <h1 className="text-3xl font-black text-[var(--text-primary)]">Main Catur</h1>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-[var(--text-muted)]">Pilih mode bermain</p>
                  {onlineUsers > 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {onlineUsers.toLocaleString()} online
                    </span>
                  )}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-5 mb-8">
                {/* PvP */}
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={() => { setGameMode('pvp-online'); setStep('mode'); }}
                  className="card-hover card p-6 rounded-2xl text-left relative overflow-hidden group">
                  <div className="absolute -right-4 -top-4 w-28 h-28 rounded-full bg-sky-500/10 group-hover:bg-sky-500/15 transition-colors" />
                  <div className="relative">
                    <div className="w-12 h-12 rounded-2xl bg-sky-500/10 flex items-center justify-center text-2xl mb-4">⚔️</div>
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-xl font-black text-[var(--text-primary)]">Player vs Player</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">LIVE</span>
                    </div>
                    <p className="text-sm text-[var(--text-muted)] mb-4">Real-time matchmaking with ELO-based pairing. Free to play, no entry fee.</p>
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs px-2 py-1 rounded-lg bg-sky-500/10 text-sky-400 font-medium">WebSocket</span>
                      <span className="text-xs px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 font-medium">Free</span>
                      <span className="text-xs px-2 py-1 rounded-lg bg-purple-500/10 text-purple-400 font-medium">ELO Rated</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-4 text-sky-400 font-semibold text-sm">
                      Cari Lawan <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </motion.button>

                {/* AI */}
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={() => { setGameMode('ai-medium'); setStep('mode'); }}
                  className="card-hover card p-6 rounded-2xl text-left relative overflow-hidden group">
                  <div className="absolute -right-4 -top-4 w-28 h-28 rounded-full bg-purple-500/10 group-hover:bg-purple-500/15 transition-colors" />
                  <div className="relative">
                    <div className="w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center text-2xl mb-4">🤖</div>
                    <h3 className="text-xl font-black text-[var(--text-primary)] mb-2">Main vs AI</h3>
                    <p className="text-sm text-[var(--text-muted)] mb-4">Practice against our chess engine. 3 difficulty levels, instant start.</p>
                    <div className="flex flex-wrap gap-2">
                      {['Easy', 'Medium', 'Hard'].map((l, i) => (
                        <span key={l} className={`text-xs px-2 py-1 rounded-lg font-medium ${i === 0 ? 'bg-emerald-500/10 text-emerald-400' : i === 1 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}`}>{l}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 mt-4 text-purple-400 font-semibold text-sm">
                      Main AI <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </motion.button>
              </div>

              {/* Live stats */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { icon: Users, label: 'Online Now', value: onlineUsers > 0 ? onlineUsers.toLocaleString() : '12,481', color: 'sky' },
                  { icon: Zap, label: 'Games Today', value: '89,234', color: 'yellow' },
                  { icon: Star, label: 'ELO Matches', value: '100% Free', color: 'emerald' },
                ].map(s => (
                  <div key={s.label} className="card p-4 rounded-xl text-center">
                    <s.icon className={`w-5 h-5 mx-auto mb-2 ${s.color === 'sky' ? 'text-sky-400' : s.color === 'yellow' ? 'text-yellow-400' : 'text-emerald-400'}`} />
                    <div className="text-lg font-black text-[var(--text-primary)]">{s.value}</div>
                    <div className="text-xs text-[var(--text-muted)]">{s.label}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Mode config */}
          {step === 'mode' && (
            <motion.div key="mode" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <button onClick={() => setStep('lobby')} className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-6 transition-colors">
                <ChevronRight className="w-4 h-4 rotate-180" /> Kembali
              </button>

              {gameMode === 'pvp-online' ? (
                <>
                  <h2 className="text-2xl font-black text-[var(--text-primary)] mb-6">Pengaturan Match Online</h2>
                  <div className="mb-5 flex items-center gap-2 p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-sm text-emerald-400">
                    <Shield className="w-4 h-4 flex-shrink-0" />
                    Main Cepat selalu gratis — untuk kompetisi berhadiah, buka halaman <a href="/tournament" className="underline font-semibold">Turnamen</a>.
                  </div>
                  <TimeControlSelector selected={selectedTC} onSelect={setSelectedTC} />
                  <ColorSelector color={playerColor} onSelect={setPlayerColor} />
                  <button onClick={startMatchmaking}
                    className="w-full mt-6 py-3.5 bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl font-bold text-white shadow-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
                    <Search className="w-5 h-5" /> Cari Lawan
                  </button>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-black text-[var(--text-primary)] mb-6">Pilih Tingkat AI</h2>
                  <div className="grid gap-3 mb-6">
                    {AI_LEVELS.map(level => (
                      <motion.button key={level.id} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                        onClick={() => setAiLevel(level.id)}
                        className={`card p-5 rounded-2xl text-left flex items-center gap-4 transition-all ${aiLevel === level.id ? 'border-sky-500 ring-1 ring-sky-500 bg-sky-500/5' : 'hover:border-[var(--accent)]'}`}>
                        <div className="text-4xl">{level.icon}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-[var(--text-primary)]">{level.name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${level.color === 'emerald' ? 'bg-emerald-500/10 text-emerald-400' : level.color === 'yellow' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}`}>
                              ~ELO {level.elo}
                            </span>
                          </div>
                          <p className="text-sm text-[var(--text-muted)]">{level.desc}</p>
                        </div>
                        {aiLevel === level.id && <div className="w-5 h-5 rounded-full bg-sky-500 flex items-center justify-center text-white text-xs">✓</div>}
                      </motion.button>
                    ))}
                  </div>
                  <TimeControlSelector selected={selectedTC} onSelect={setSelectedTC} />
                  <ColorSelector color={playerColor} onSelect={setPlayerColor} />
                  <button onClick={() => setStep('playing-ai')}
                    className="w-full mt-6 py-3.5 bg-gradient-to-r from-purple-500 to-pink-600 rounded-xl font-bold text-white shadow-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
                    <Brain className="w-5 h-5" /> Mulai vs AI
                  </button>
                </>
              )}
            </motion.div>
          )}

          {/* Matchmaking */}
          {step === 'matchmaking' && (
            <motion.div key="mm" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <div className="relative mb-8">
                <div className="w-24 h-24 rounded-full border-4 border-sky-500/20 animate-ping absolute inset-0" />
                <div className="w-24 h-24 rounded-full border-4 border-sky-500/10 animate-ping absolute inset-0" style={{ animationDelay: '0.4s' }} />
                <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-sky-500/20 to-blue-500/20 flex items-center justify-center border border-sky-500/30">
                  <Search className="w-10 h-10 text-sky-400" />
                </div>
              </div>

              <h2 className="text-2xl font-black text-[var(--text-primary)] mb-2">Mencari Lawan...</h2>
              <p className="text-[var(--text-muted)] mb-1">Mencari match <strong>{selectedTC.label}</strong></p>

              <p className="text-sm text-[var(--text-muted)] mt-4">
                <span className="font-mono text-sky-400 text-lg">
                  {String(Math.floor(matchmakingTime / 60)).padStart(2, '0')}:{String(matchmakingTime % 60).padStart(2, '0')}
                </span>
              </p>

              <div className="flex flex-wrap gap-2 justify-center mt-6 mb-8">
                <span className="text-xs px-3 py-1 rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)]">
                  ELO {user?.elo} ±{Math.min(100 + matchmakingTime * 5, 500)}
                </span>
                {onlineUsers > 0 && (
                  <span className="text-xs px-3 py-1 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    {onlineUsers.toLocaleString()} online
                  </span>
                )}
                <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400">
                  <Wifi className="w-3 h-3 inline mr-1" />Terhubung
                </span>
              </div>
              {matchmakingError && (
                <div className="mb-5 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-2.5 text-sm text-yellow-300">
                  {matchmakingError}
                </div>
              )}

              <button onClick={cancelMatchmaking}
                className="px-6 py-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 font-medium hover:bg-red-500/20 transition-colors">
                Batal
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
}

function TimeControlSelector({ selected, onSelect }: { selected: typeof TIME_CONTROLS[0]; onSelect: (tc: typeof TIME_CONTROLS[0]) => void }) {
  const grouped = {
    bullet: TIME_CONTROLS.filter(tc => tc.type === 'bullet'),
    blitz: TIME_CONTROLS.filter(tc => tc.type === 'blitz'),
    rapid: TIME_CONTROLS.filter(tc => tc.type === 'rapid'),
  };
  return (
    <div className="mb-6">
      <h3 className="font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-[var(--text-muted)]" /> Time Control</h3>
      <div className="space-y-3">
        {Object.entries(grouped).map(([type, tcs]) => (
          <div key={type}>
            <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
              {type === 'bullet' ? '⚡ Bullet' : type === 'blitz' ? '🔥 Blitz' : '⏱ Rapid'}
            </div>
            <div className="flex flex-wrap gap-2">
              {tcs.map(tc => (
                <button key={tc.label} onClick={() => onSelect(tc)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${selected.label === tc.label ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25' : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border)]'}`}>
                  {tc.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ColorSelector({ color, onSelect }: { color: string; onSelect: (c: 'white' | 'black' | 'random') => void }) {
  return (
    <div>
      <h3 className="font-semibold text-[var(--text-primary)] mb-3">Main sebagai</h3>
      <div className="flex gap-3">
        {[{ value: 'white', label: 'White', icon: '⬜' }, { value: 'black', label: 'Black', icon: '⬛' }, { value: 'random', label: 'Random', icon: '🎲' }].map(opt => (
          <button key={opt.value} onClick={() => onSelect(opt.value as any)}
            className={`flex-1 py-3 rounded-xl flex flex-col items-center gap-1.5 transition-all font-medium text-sm ${color === opt.value ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25' : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border)]'}`}>
            <span className="text-2xl">{opt.icon}</span>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

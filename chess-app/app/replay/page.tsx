'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import {
  SkipBack, SkipForward, ChevronLeft, ChevronRight,
  Play, Pause, Download, Copy, Loader2, AlertCircle
} from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';

interface MoveRecord {
  san: string; from: string; to: string;
  timestamp: number; whiteTimeLeft: number; blackTimeLeft: number;
}

interface ReplayData {
  gameId: string;
  white: string; black: string;
  moves: MoveRecord[];
  pgn: string;
  result: string; endReason: string;
  timeControl: { initial: number; increment: number };
  startedAt: string; endedAt: string;
  whiteEloBefore: number; blackEloBefore: number;
  whiteEloAfter: number; blackEloAfter: number;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ReplayContent() {
  const searchParams = useSearchParams();
  const gameId = searchParams.get('id');
  const { token } = useAppStore();

  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [chess] = useState(() => new Chess());
  const [position, setPosition] = useState('start');
  const [moveIndex, setMoveIndex] = useState(-1); // -1 = starting position
  const [playing, setPlaying] = useState(false);
  const [pgnCopied, setPgnCopied] = useState(false);

  useEffect(() => {
    if (!gameId) { setError('ID game tidak ditemukan'); setLoading(false); return; }
    const endpoint = token
      ? api.game.get(gameId, token)
      : fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000'}/api/game/${gameId}/replay`).then(r => r.json());

    endpoint
      .then(async (res: any) => {
        // Try replay endpoint for public data
        const replayRes = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000'}/api/game/${gameId}/replay`
        );
        if (!replayRes.ok) throw new Error('Game tidak ditemukan');
        const replayData = await replayRes.json();
        setData(replayData);
      })
      .catch(err => setError(err.message || 'Gagal memuat game'))
      .finally(() => setLoading(false));
  }, [gameId, token]);

  // Rebuild board position at moveIndex
  const goToMove = useCallback((idx: number) => {
    if (!data) return;
    chess.reset();
    const moves = data.moves.slice(0, idx + 1);
    for (const m of moves) {
      try { chess.move({ from: m.from, to: m.to, promotion: 'q' }); } catch {}
    }
    setPosition(chess.fen());
    setMoveIndex(idx);
  }, [data, chess]);

  // Auto-play
  useEffect(() => {
    if (!playing || !data) return;
    if (moveIndex >= data.moves.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => goToMove(moveIndex + 1), 800);
    return () => clearTimeout(t);
  }, [playing, moveIndex, data, goToMove]);

  const handlePrev = () => { setPlaying(false); goToMove(Math.max(-1, moveIndex - 1)); };
  const handleNext = () => { goToMove(Math.min((data?.moves.length ?? 0) - 1, moveIndex + 1)); };
  const handleStart = () => { setPlaying(false); chess.reset(); setPosition(chess.fen()); setMoveIndex(-1); };
  const handleEnd = () => { setPlaying(false); goToMove((data?.moves.length ?? 1) - 1); };

  const downloadPGN = () => {
    if (!data) return;
    const blob = new Blob([data.pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chess-arena-${gameId?.slice(0, 8) || 'game'}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyPGN = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.pgn).then(() => {
      setPgnCopied(true);
      setTimeout(() => setPgnCopied(false), 2000);
    });
  };

  if (loading) return (
    <AppLayout>
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
      </div>
    </AppLayout>
  );

  if (error || !data) return (
    <AppLayout>
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <p className="text-[var(--text-muted)]">{error || 'Game tidak ditemukan'}</p>
      </div>
    </AppLayout>
  );

  const totalMoves = data.moves.length;
  const currentMove = moveIndex >= 0 ? data.moves[moveIndex] : null;
  const resultLabel = data.result === 'white' ? 'Putih menang' : data.result === 'black' ? 'Hitam menang' : 'Seri';

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-[var(--text-primary)]">Replay Pertandingan</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {resultLabel} · {data.endReason} · {data.timeControl?.initial ? `${Math.floor(data.timeControl.initial / 60)}+${data.timeControl.increment || 0}` : '—'}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={copyPGN}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-hover)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border)]">
              <Copy className="w-4 h-4" />
              {pgnCopied ? 'Tersalin!' : 'Salin PGN'}
            </button>
            <button onClick={downloadPGN}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 text-sm font-medium text-amber-400 hover:bg-amber-500/20 transition-colors border border-amber-500/20">
              <Download className="w-4 h-4" />
              PGN
            </button>
          </div>
        </motion.div>

        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          {/* Board */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            <div className="card rounded-2xl p-4 space-y-4">
              {/* Black player */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold text-white">B</div>
                  <span className="font-semibold text-[var(--text-primary)]">{data.black}</span>
                  <span className="text-xs text-[var(--text-muted)]">({data.blackEloBefore})</span>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${data.blackEloAfter > data.blackEloBefore ? 'text-emerald-400 bg-emerald-500/10' : data.blackEloAfter < data.blackEloBefore ? 'text-red-400 bg-red-500/10' : 'text-slate-400 bg-slate-500/10'}`}>
                  {data.blackEloAfter > data.blackEloBefore ? '+' : ''}{data.blackEloAfter - data.blackEloBefore}
                </span>
              </div>

              {/* Chessboard */}
              <div className="w-full aspect-square max-w-lg mx-auto">
                <Chessboard
                  position={position}
                  areArrowsAllowed={false}
                  arePiecesDraggable={false}
                  boardOrientation="white"
                  customBoardStyle={{ borderRadius: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}
                />
              </div>

              {/* White player */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-800">W</div>
                  <span className="font-semibold text-[var(--text-primary)]">{data.white}</span>
                  <span className="text-xs text-[var(--text-muted)]">({data.whiteEloBefore})</span>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${data.whiteEloAfter > data.whiteEloBefore ? 'text-emerald-400 bg-emerald-500/10' : data.whiteEloAfter < data.whiteEloBefore ? 'text-red-400 bg-red-500/10' : 'text-slate-400 bg-slate-500/10'}`}>
                  {data.whiteEloAfter > data.whiteEloBefore ? '+' : ''}{data.whiteEloAfter - data.whiteEloBefore}
                </span>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-3 pt-2">
                <button onClick={handleStart} className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                  <SkipBack className="w-5 h-5" />
                </button>
                <button onClick={handlePrev} disabled={moveIndex < 0} className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button onClick={() => setPlaying(p => !p)}
                  className="w-10 h-10 rounded-xl bg-amber-500 hover:bg-amber-400 text-white flex items-center justify-center transition-colors shadow-lg shadow-amber-500/25">
                  {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                </button>
                <button onClick={handleNext} disabled={moveIndex >= totalMoves - 1} className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40">
                  <ChevronRight className="w-5 h-5" />
                </button>
                <button onClick={handleEnd} className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                  <SkipForward className="w-5 h-5" />
                </button>
              </div>

              {/* Progress bar */}
              <div className="h-1 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 transition-all duration-300"
                  style={{ width: totalMoves > 0 ? `${((moveIndex + 1) / totalMoves) * 100}%` : '0%' }}
                />
              </div>
              <div className="text-center text-xs text-[var(--text-muted)]">
                Langkah {moveIndex + 1} dari {totalMoves}
              </div>
            </div>
          </motion.div>

          {/* Move list */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
            <div className="card rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <h3 className="font-bold text-[var(--text-primary)] text-sm">Daftar Langkah</h3>
              </div>
              <div className="overflow-y-auto max-h-[480px]">
                <div className="p-2 space-y-0.5">
                  {Array.from({ length: Math.ceil(totalMoves / 2) }).map((_, pairIdx) => {
                    const whiteIdx = pairIdx * 2;
                    const blackIdx = pairIdx * 2 + 1;
                    const whiteMove = data.moves[whiteIdx];
                    const blackMove = data.moves[blackIdx];
                    return (
                      <div key={pairIdx} className="grid grid-cols-[28px_1fr_1fr] gap-1 text-sm">
                        <span className="text-[var(--text-muted)] text-xs py-1 text-right pr-1">{pairIdx + 1}.</span>
                        <button
                          onClick={() => { setPlaying(false); goToMove(whiteIdx); }}
                          className={`px-2 py-1 rounded-lg text-left font-mono font-medium transition-colors
                            ${moveIndex === whiteIdx ? 'bg-amber-500 text-white' : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)]'}`}>
                          {whiteMove?.san}
                        </button>
                        {blackMove && (
                          <button
                            onClick={() => { setPlaying(false); goToMove(blackIdx); }}
                            className={`px-2 py-1 rounded-lg text-left font-mono font-medium transition-colors
                              ${moveIndex === blackIdx ? 'bg-amber-500 text-white' : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)]'}`}>
                            {blackMove.san}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Result */}
              <div className="px-4 py-3 border-t border-[var(--border)] text-center">
                <span className={`text-sm font-bold px-3 py-1 rounded-lg ${data.result === 'white' ? 'bg-emerald-500/10 text-emerald-400' : data.result === 'black' ? 'bg-red-500/10 text-red-400' : 'bg-slate-500/10 text-slate-400'}`}>
                  {resultLabel}
                </span>
                <p className="text-xs text-[var(--text-muted)] mt-1 capitalize">{data.endReason?.replace(/-/g, ' ')}</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
}

export default function ReplayPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 animate-spin rounded-full border-4 border-amber-400 border-t-transparent" />
      </div>
    }>
      <ReplayContent />
    </Suspense>
  );
}

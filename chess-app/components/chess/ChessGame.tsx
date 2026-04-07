'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, Square } from 'chess.js';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flag, RotateCcw, MessageSquare, Clock, ChevronLeft, ChevronRight,
  SkipBack, SkipForward, Maximize2, Share2, Download, Zap, Brain
} from 'lucide-react';
import { getBestMove, formatTime } from '@/lib/chess-ai';
import { useAppStore } from '@/lib/store';
import { playChessSound, soundForMove, setChessSoundsEnabled } from '@/lib/chess-sounds';
import type { GameMode, TimeControl, Player, MoveRecord } from '@/types';

interface ChessGameProps {
  mode: GameMode;
  timeControl: TimeControl;
  stakes: number;
  opponent: Player;
  playerColor?: 'white' | 'black';
  onGameEnd?: (result: 'win' | 'loss' | 'draw') => void;
}

const BOARD_THEMES = {
  classic: { light: '#f0d9b5', dark: '#b58863' },
  ocean: { light: '#dee3e6', dark: '#8ca2ad' },
  forest: { light: '#ffffdd', dark: '#6db26b' },
  neon: { light: '#1a1a2e', dark: '#16213e' },
  marble: { light: '#ffffff', dark: '#aaaaaa' },
};

export default function ChessGame({
  mode, timeControl, stakes, opponent, playerColor = 'white', onGameEnd
}: ChessGameProps) {
  const { boardTheme, showLegalMoves, soundEnabled, animationsEnabled, user } = useAppStore();

  // Keep chess-sounds module in sync with store preference
  useEffect(() => { setChessSoundsEnabled(soundEnabled !== false); }, [soundEnabled]);

  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState(new Chess().fen()); // live game FEN (always current position)
  const [moveFrom, setMoveFrom] = useState<Square | null>(null);
  const [optionSquares, setOptionSquares] = useState<Record<string, object>>({});
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [moveHistory, setMoveHistory] = useState<MoveRecord[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [gameStatus, setGameStatus] = useState<'active' | 'finished' | 'draw' | 'resigned'>('active');
  const [winner, setWinner] = useState<string | null>(null);
  const [gameEndReason, setGameEndReason] = useState<'checkmate' | 'timeout' | 'resignation' | null>(null);
  const [whiteTime, setWhiteTime] = useState(timeControl.initial);
  const [blackTime, setBlackTime] = useState(timeControl.initial);
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [boardFlipped, setBoardFlipped] = useState(playerColor === 'black');
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages] = useState([
    { from: 'opponent', text: 'Good luck!', time: '0:00' },
    { from: 'opponent', text: 'Nice move!', time: '1:23' },
  ]);

  // --- History navigation state ---
  // reviewFen: null = watching live game; string = reviewing a historical position
  const [reviewFen, setReviewFen] = useState<string | null>(null);
  // fenHistoryRef tracks all FENs in order (starting position + one per move)
  const fenHistoryRef = useRef<string[]>([new Chess().fen()]);
  // viewIndexRef tracks which index of fenHistoryRef we're currently viewing
  const viewIndexRef = useRef<number>(0);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const moveHistoryRef = useRef<HTMLDivElement>(null);
  const aiWorkerRef = useRef<Worker | null>(null);
  const aiRequestSeqRef = useRef(0);
  const aiPendingRef = useRef<Map<number, (move: string | null) => void>>(new Map());

  // Refs so the single persistent timer always reads the latest values
  // without needing to be re-created on every move (which caused multiple
  // overlapping intervals draining the clock too fast).
  const fenRef = useRef(fen);
  const gameStatusRef = useRef(gameStatus);
  const isAIThinkingRef = useRef(false);
  const aiThinkingMetaRef = useRef<{ color: 'w' | 'b'; startedAt: number } | null>(null);
  const handleTimeoutRef = useRef<(loser: 'white' | 'black') => void>(() => {});

  // Keep refs in sync on every render so timer callback always sees latest state
  fenRef.current = fen;
  gameStatusRef.current = gameStatus;
  isAIThinkingRef.current = isAIThinking;

  const theme = BOARD_THEMES[boardTheme as keyof typeof BOARD_THEMES] || BOARD_THEMES.classic;
  const isAI = mode.startsWith('ai-');
  const aiLevel = mode === 'ai-easy' ? 'easy' : mode === 'ai-medium' ? 'medium' : 'hard';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const worker = new Worker(new URL('../../lib/chess-ai.worker.ts', import.meta.url));
    aiWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ id: number; move: string | null }>) => {
      const resolver = aiPendingRef.current.get(event.data.id);
      if (resolver) {
        aiPendingRef.current.delete(event.data.id);
        resolver(event.data.move);
      }
    };
    return () => {
      for (const [, resolver] of aiPendingRef.current) resolver(null);
      aiPendingRef.current.clear();
      worker.terminate();
      aiWorkerRef.current = null;
    };
  }, []);

  const requestAIMove = useCallback((currentFen: string, difficulty: 'easy' | 'medium' | 'hard') => {
    const worker = aiWorkerRef.current;
    if (!worker) {
      const fallbackChess = new Chess(currentFen);
      const legal = fallbackChess.moves({ verbose: true });
      const capture = legal.find(m => !!m.captured);
      return Promise.resolve(capture?.san || legal[0]?.san || null);
    }
    const id = ++aiRequestSeqRef.current;
    return new Promise<string | null>((resolve) => {
      aiPendingRef.current.set(id, resolve);
      worker.postMessage({ id, fen: currentFen, difficulty });
      setTimeout(() => {
        const pending = aiPendingRef.current.get(id);
        if (pending) {
          aiPendingRef.current.delete(id);
          // Never run heavy AI fallback on the main thread.
          // If worker stalls, return null and use cheap legal-move fallback in caller.
          pending(null);
        }
      }, 450);
    });
  }, []);

  // The FEN displayed on the board — historical if reviewing, live otherwise
  const displayFen = reviewFen ?? fen;
  const isReviewing = reviewFen !== null;

  // Push a new FEN to history and jump to it (used after every move)
  function pushFenHistory(newFen: string) {
    fenHistoryRef.current = [...fenHistoryRef.current, newFen];
    viewIndexRef.current = fenHistoryRef.current.length - 1;
    setReviewFen(null); // always return to live view on new move
  }

  // Single persistent timer — created ONCE on mount, never re-created on moves.
  // Reads whose turn it is via fenRef (updated each render) to avoid stale closures
  // AND to prevent multiple overlapping intervals that previously drained clocks
  // at 10× speed (one new interval per move × moves accumulating).
  //
  // IMPORTANT: loser param = the player whose clock hit 0 (they lose).
  //   White times out → handleTimeout('white') → Black wins
  //   Black times out → handleTimeout('black') → White wins
  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (gameStatusRef.current !== 'active') return;
      // Parse active turn from the latest FEN (ref is always current)
      const fenTurn = fenRef.current.split(' ')[1] as 'w' | 'b';
      // During AI thinking we account elapsed time precisely on AI move completion.
      const aiMeta = aiThinkingMetaRef.current;
      if (isAIThinkingRef.current && aiMeta && fenTurn === aiMeta.color) return;
      if (fenTurn === 'w') {
        setWhiteTime(prev => {
          if (prev <= 0) return 0; // already stopped
          if (prev === 1) {
            setTimeout(() => handleTimeoutRef.current('white'), 0);
            return 0;
          }
          return prev - 1;
        });
      } else {
        setBlackTime(prev => {
          if (prev <= 0) return 0;
          if (prev === 1) {
            setTimeout(() => handleTimeoutRef.current('black'), 0);
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []); // Empty deps — single interval for the component lifetime

  // AI move effect
  // Fires when fen changes (i.e. after every move) or when review state changes.
  // Uses fen captured at effect-setup time to avoid stale closure issues.
  useEffect(() => {
    if (!isAI || gameStatus !== 'active') return;
    if (isReviewing) return; // never fire AI while player is reviewing history

    const aiColor = playerColor === 'white' ? 'b' : 'w';
    if (game.turn() !== aiColor) return;

    setIsAIThinking(true);
    aiThinkingMetaRef.current = { color: aiColor, startedAt: Date.now() };
    const baseDelay = aiLevel === 'easy' ? 280 : aiLevel === 'medium' ? 520 : 520;
    // Add ±100ms jitter so AI feels more natural
    const jitter = Math.floor(Math.random() * 201) - 100;
    const delay = Math.max(120, baseDelay + jitter);

    // Capture current FEN at effect-setup time (same as `game.fen()` since they're always synced)
    const currentFen = fen;

    const timer = setTimeout(async () => {
      let move = await requestAIMove(currentFen, aiLevel);

      // Fallback: if AI returns null (e.g. edge case in minimax), pick first legal move
      if (!move) {
        const fallbackChess = new Chess(currentFen);
        const legalMoves = fallbackChess.moves({ verbose: true });
        if (legalMoves.length > 0) {
          move = legalMoves[Math.floor(Math.random() * legalMoves.length)].san;
        }
      }

      if (move) {
        const gameCopy = new Chess(currentFen);
        const result = gameCopy.move(move);
        if (result) {
          const meta = aiThinkingMetaRef.current;
          if (meta) {
            const elapsedSec = Math.max(1, Math.floor((Date.now() - meta.startedAt) / 1000));
            if (meta.color === 'w') {
              setWhiteTime(t => Math.max(0, t - elapsedSec));
            } else {
              setBlackTime(t => Math.max(0, t - elapsedSec));
            }
          }
          const moveRecord: MoveRecord = {
            san: result.san, from: result.from, to: result.to, piece: result.piece,
            captured: result.captured, promotion: result.promotion, timestamp: Date.now(),
            timeLeft: result.color === 'w' ? whiteTime : blackTime,
          };
          setMoveHistory(h => [...h, moveRecord]);
          setHistoryIndex(prev => prev + 1);
          setLastMove({ from: result.from as Square, to: result.to as Square });
          pushFenHistory(gameCopy.fen());
          setGame(gameCopy);
          setFen(gameCopy.fen());
          playChessSound(soundForMove(result.flags, gameCopy.inCheck(), !!result.captured));
          if (timeControl.increment > 0) {
            if (result.color === 'w') setWhiteTime(t => t + timeControl.increment);
            else setBlackTime(t => t + timeControl.increment);
          }
          checkGameEnd(gameCopy);
        }
      }
      aiThinkingMetaRef.current = null;
      setIsAIThinking(false);
    }, delay);
    return () => {
      clearTimeout(timer);
      aiThinkingMetaRef.current = null;
    };
  }, [fen, isAI, gameStatus, isReviewing, requestAIMove]); // isReviewing must be a dep so AI stops when reviewing

  // Auto-scroll move history
  useEffect(() => {
    if (moveHistoryRef.current) {
      moveHistoryRef.current.scrollTop = moveHistoryRef.current.scrollHeight;
    }
  }, [moveHistory]);

  const handleTimeout = (loser: 'white' | 'black') => {
    const winnerColor = loser === 'white' ? 'Black' : 'White';
    setGameStatus('finished');
    setWinner(winnerColor);
    setGameEndReason('timeout');
    onGameEnd?.(loser === playerColor ? 'loss' : 'win');
  };
  // Keep ref in sync so the single timer interval always calls the latest version
  handleTimeoutRef.current = handleTimeout;

  const checkGameEnd = (g: Chess) => {
    if (g.isCheckmate()) {
      setGameStatus('finished');
      const w = g.turn() === 'w' ? 'Black' : 'White';
      setWinner(w);
      setGameEndReason('checkmate');
      const result = g.turn() === (playerColor === 'white' ? 'w' : 'b') ? 'loss' : 'win';
      playChessSound(result === 'win' ? 'win' : 'lose');
      onGameEnd?.(result);
    } else if (g.isDraw() || g.isStalemate() || g.isThreefoldRepetition() || g.isInsufficientMaterial()) {
      setGameStatus('draw');
      setWinner(null);
      setGameEndReason(null);
      playChessSound('draw');
      onGameEnd?.('draw');
    }
  };

  function getMoveOptions(square: Square) {
    const moves = game.moves({ square, verbose: true });
    if (moves.length === 0) return false;
    const squares: Record<string, object> = {};
    moves.forEach((m) => {
      squares[m.to] = {
        background: game.get(m.to as Square) && game.get(m.to as Square)?.color !== game.get(square)?.color
          ? 'radial-gradient(circle, rgba(239,68,68,0.6) 85%, transparent 85%)'
          : 'radial-gradient(circle, rgba(14,165,233,0.5) 25%, transparent 25%)',
        borderRadius: '50%',
      };
    });
    squares[square] = { background: 'rgba(255,255,0,0.3)' };
    setOptionSquares(squares);
    return true;
  }

  function onSquareClick(square: Square) {
    // Block moves while reviewing history or AI is thinking
    if (gameStatus !== 'active' || isAIThinking || isReviewing) return;
    if (isAI && game.turn() !== (playerColor === 'white' ? 'w' : 'b')) return;

    if (!moveFrom) {
      const piece = game.get(square);
      if (piece && piece.color === game.turn()) {
        setMoveFrom(square);
        getMoveOptions(square);
      }
      return;
    }

    const gameCopy = new Chess(game.fen());
    let move = null;
    try {
      move = gameCopy.move({ from: moveFrom, to: square, promotion: 'q' });
    } catch {}

    if (!move) {
      const piece = game.get(square);
      if (piece && piece.color === game.turn()) {
        setMoveFrom(square);
        getMoveOptions(square);
      } else {
        setMoveFrom(null);
        setOptionSquares({});
      }
      return;
    }

    const moveRecord: MoveRecord = {
      san: move.san, from: move.from, to: move.to, piece: move.piece,
      captured: move.captured, promotion: move.promotion, timestamp: Date.now(),
      timeLeft: game.turn() === 'w' ? whiteTime : blackTime,
    };

    setMoveHistory(h => [...h, moveRecord]);
    setHistoryIndex(prev => prev + 1);
    setLastMove({ from: move.from as Square, to: move.to as Square });
    setMoveFrom(null);
    setOptionSquares({});

    playChessSound(soundForMove(move.flags, gameCopy.inCheck(), !!move.captured));

    if (timeControl.increment > 0) {
      if (move.color === 'w') setWhiteTime(t => t + timeControl.increment);
      else setBlackTime(t => t + timeControl.increment);
    }

    pushFenHistory(gameCopy.fen());
    setGame(gameCopy);
    setFen(gameCopy.fen());
    checkGameEnd(gameCopy);
  }

  function onDrop(sourceSquare: Square, targetSquare: Square) {
    // Block moves while reviewing history or AI is thinking
    if (gameStatus !== 'active' || isAIThinking || isReviewing) return false;
    if (isAI && game.turn() !== (playerColor === 'white' ? 'w' : 'b')) return false;

    const gameCopy = new Chess(game.fen());
    let move = null;
    try { move = gameCopy.move({ from: sourceSquare, to: targetSquare, promotion: 'q' }); } catch {}
    if (!move) return false;

    const moveRecord: MoveRecord = {
      san: move.san, from: move.from, to: move.to, piece: move.piece,
      captured: move.captured, promotion: move.promotion, timestamp: Date.now(),
      timeLeft: game.turn() === 'w' ? whiteTime : blackTime,
    };
    setMoveHistory(h => [...h, moveRecord]);
    setHistoryIndex(prev => prev + 1);
    setLastMove({ from: move.from as Square, to: move.to as Square });
    setMoveFrom(null);
    setOptionSquares({});

    playChessSound(soundForMove(move.flags, gameCopy.inCheck(), !!move.captured));

    if (timeControl.increment > 0) {
      if (move.color === 'w') setWhiteTime(t => t + timeControl.increment);
      else setBlackTime(t => t + timeControl.increment);
    }
    pushFenHistory(gameCopy.fen());
    setGame(gameCopy);
    setFen(gameCopy.fen());
    checkGameEnd(gameCopy);
    return true;
  }

  // Navigation helpers using fenHistoryRef
  function navStart() {
    if (fenHistoryRef.current.length === 0) return;
    viewIndexRef.current = 0;
    setReviewFen(fenHistoryRef.current[0]);
  }
  function navPrev() {
    const newIdx = Math.max(0, viewIndexRef.current - 1);
    viewIndexRef.current = newIdx;
    if (newIdx === fenHistoryRef.current.length - 1) {
      setReviewFen(null);
    } else {
      setReviewFen(fenHistoryRef.current[newIdx]);
    }
  }
  function navNext() {
    const newIdx = Math.min(fenHistoryRef.current.length - 1, viewIndexRef.current + 1);
    viewIndexRef.current = newIdx;
    if (newIdx === fenHistoryRef.current.length - 1) {
      setReviewFen(null); // arrived at live position
    } else {
      setReviewFen(fenHistoryRef.current[newIdx]);
    }
  }
  function navEnd() {
    viewIndexRef.current = fenHistoryRef.current.length - 1;
    setReviewFen(null); // back to live
  }

  function handleRematch() {
    const newGame = new Chess();
    setGame(newGame);
    setFen(newGame.fen());
    setReviewFen(null);
    fenHistoryRef.current = [newGame.fen()];
    viewIndexRef.current = 0;
    setMoveHistory([]);
    setHistoryIndex(-1);
    setLastMove(null);
    setOptionSquares({});
    setGameStatus('active');
    setWinner(null);
    setGameEndReason(null);
    setWhiteTime(timeControl.initial);
    setBlackTime(timeControl.initial);
  }

  const customSquareStyles: Record<string, object> = {
    ...(showLegalMoves && !isReviewing ? optionSquares : {}),
    ...(lastMove ? {
      [lastMove.from]: { background: 'rgba(255, 213, 0, 0.25)' },
      [lastMove.to]: { background: 'rgba(255, 213, 0, 0.4)' },
    } : {}),
    ...(game.inCheck() && gameStatus === 'active' && !isReviewing ? (() => {
      const pieces = game.board().flat();
      const king = pieces.find(p => p?.type === 'k' && p.color === game.turn());
      if (king) return { [king.square]: { background: 'rgba(239,68,68,0.5)' } };
      return {};
    })() : {}),
  };

  const currentPlayer = user?.username || 'You';
  const whiteName = playerColor === 'white' ? currentPlayer : opponent.username;
  const blackName = playerColor === 'black' ? currentPlayer : opponent.username;
  const whiteElo = playerColor === 'white' ? (user?.elo || 1500) : opponent.elo;
  const blackElo = playerColor === 'black' ? (user?.elo || 1500) : opponent.elo;
  const whiteAvatar = playerColor === 'white' ? (user?.avatar || '') : opponent.avatar;
  const blackAvatar = playerColor === 'black' ? (user?.avatar || '') : opponent.avatar;

  const isWhiteTurn = game.turn() === 'w';
  const movePairs: [MoveRecord | undefined, MoveRecord | undefined][] = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    movePairs.push([moveHistory[i], moveHistory[i + 1]]);
  }

  return (
    <div className="flex flex-col xl:flex-row gap-4 h-full">
      {/* Left: Board */}
      <div className="flex flex-col items-center gap-3">
        {/* Top player (opponent/black) */}
        <PlayerBar
          name={boardFlipped ? whiteName : blackName}
          elo={boardFlipped ? whiteElo : blackElo}
          avatar={boardFlipped ? whiteAvatar : blackAvatar}
          time={boardFlipped ? whiteTime : blackTime}
          isActive={!isReviewing && (boardFlipped ? isWhiteTurn : !isWhiteTurn)}
          color={boardFlipped ? 'white' : 'black'}
          isThinking={isAI && isAIThinking && !isReviewing && (boardFlipped ? game.turn() === 'w' : game.turn() === 'b')}
        />

        {/* Board */}
        <div className="chess-board-wrapper relative">
          {gameStatus !== 'active' && (
            <GameEndOverlay status={gameStatus} winner={winner} stakes={stakes}
              playerColor={playerColor} endReason={gameEndReason} onRematch={handleRematch} />
          )}
          {/* Review mode indicator */}
          {isReviewing && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-amber-500/90 text-white text-xs font-semibold px-3 py-1 rounded-full pointer-events-none">
              Reviewing — click End to return to live
            </div>
          )}
          <Chessboard
            id="main-board"
            position={displayFen}
            onSquareClick={onSquareClick}
            onPieceDrop={onDrop}
            boardOrientation={boardFlipped ? 'black' : 'white'}
            customBoardStyle={{
              borderRadius: '8px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
            customLightSquareStyle={{ backgroundColor: theme.light }}
            customDarkSquareStyle={{ backgroundColor: theme.dark }}
            customSquareStyles={customSquareStyles}
            animationDuration={animationsEnabled ? 200 : 0}
            showBoardNotation={true}
            boardWidth={Math.min(480, typeof window !== 'undefined' ? window.innerWidth - 48 : 480)}
            arePiecesDraggable={!isReviewing}
          />
        </div>

        {/* Bottom player */}
        <PlayerBar
          name={boardFlipped ? blackName : whiteName}
          elo={boardFlipped ? blackElo : whiteElo}
          avatar={boardFlipped ? blackAvatar : whiteAvatar}
          time={boardFlipped ? blackTime : whiteTime}
          isActive={!isReviewing && (boardFlipped ? !isWhiteTurn : isWhiteTurn)}
          color={boardFlipped ? 'black' : 'white'}
          isThinking={false}
        />

        {/* Controls */}
        <div className="flex items-center gap-2">
          <ControlBtn icon={SkipBack} onClick={navStart} title="Start" />
          <ControlBtn icon={ChevronLeft} onClick={navPrev} title="Previous" />
          <ControlBtn icon={ChevronRight} onClick={navNext} title="Next" />
          <ControlBtn icon={SkipForward} onClick={navEnd} title="End" active={!isReviewing} />
          <div className="w-px h-6 bg-[var(--border)]" />
          <ControlBtn icon={RotateCcw} onClick={() => setBoardFlipped(f => !f)} title="Flip board" />
          <ControlBtn icon={Share2} onClick={() => {}} title="Share" />
          <ControlBtn icon={MessageSquare} onClick={() => setShowChat(c => !c)} title="Chat"
            active={showChat} badge={chatMessages.length} />
          {gameStatus === 'active' && (
            <button onClick={() => setShowResignConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-colors border border-red-500/20">
              <Flag className="w-4 h-4" />
              Resign
            </button>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col gap-4 min-w-0 max-w-sm xl:max-w-none mx-auto xl:mx-0 w-full">
        {/* Game info */}
        <div className="card p-4 rounded-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {isAI ? <Brain className="w-4 h-4 text-purple-400" /> : <Zap className="w-4 h-4 text-sky-400" />}
              <span className="font-semibold text-sm text-[var(--text-primary)]">
                {isAI ? `vs AI (${aiLevel.charAt(0).toUpperCase() + aiLevel.slice(1)})` : 'Live Match'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--text-muted)]" />
              <span className="text-sm font-mono text-[var(--text-secondary)]">{timeControl.label}</span>
            </div>
          </div>
          {stakes > 0 && (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <span className="text-sm text-yellow-600 dark:text-yellow-400">Stakes</span>
              <span className="font-bold text-yellow-600 dark:text-yellow-400">
                Rp {stakes.toLocaleString('id-ID')}
              </span>
            </div>
          )}
          {game.inCheck() && gameStatus === 'active' && !isReviewing && (
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}
              className="mt-2 text-center text-sm font-bold text-red-400 bg-red-500/10 rounded-lg py-1.5 border border-red-500/20">
              ♚ CHECK!
            </motion.div>
          )}
        </div>

        {/* Move history */}
        <div className="card rounded-xl flex-1 flex flex-col min-h-[200px] max-h-[400px]">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <span className="font-semibold text-sm text-[var(--text-primary)]">Move History</span>
            <span className="text-xs text-[var(--text-muted)]">{moveHistory.length} moves</span>
          </div>
          <div ref={moveHistoryRef} className="flex-1 overflow-y-auto p-3 space-y-1">
            {movePairs.length === 0 ? (
              <div className="text-center text-[var(--text-muted)] text-sm py-8">No moves yet</div>
            ) : (
              movePairs.map((pair, i) => (
                <div key={i} className="flex items-center gap-1 text-sm">
                  <span className="w-8 text-[var(--text-muted)] font-mono text-xs flex-shrink-0">{i + 1}.</span>
                  {pair[0] && (
                    <button
                      onClick={() => {
                        const idx = i * 2 + 1; // +1 because fenHistory[0] is starting pos
                        viewIndexRef.current = idx;
                        setReviewFen(fenHistoryRef.current[idx] ?? null);
                      }}
                      className="flex-1 text-left px-2 py-1 rounded hover:bg-[var(--bg-hover)] font-mono font-medium text-[var(--text-primary)] transition-colors">
                      {pair[0].san}
                    </button>
                  )}
                  {pair[1] ? (
                    <button
                      onClick={() => {
                        const idx = i * 2 + 2;
                        viewIndexRef.current = idx;
                        setReviewFen(fenHistoryRef.current[idx] ?? null);
                      }}
                      className="flex-1 text-left px-2 py-1 rounded hover:bg-[var(--bg-hover)] font-mono font-medium text-[var(--text-primary)] transition-colors">
                      {pair[1].san}
                    </button>
                  ) : <div className="flex-1" />}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Chat (if open) */}
        <AnimatePresence>
          {showChat && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="card rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <span className="font-semibold text-sm text-[var(--text-primary)]">Chat</span>
              </div>
              <div className="p-3 space-y-2 max-h-32 overflow-y-auto">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex gap-2 ${msg.from === 'opponent' ? '' : 'flex-row-reverse'}`}>
                    <div className={`max-w-[70%] px-3 py-1.5 rounded-xl text-sm ${msg.from === 'opponent' ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'bg-sky-500 text-white'}`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-[var(--border)] flex gap-2">
                <input placeholder="Type a message..." className="flex-1 bg-[var(--bg-hover)] rounded-lg px-3 py-1.5 text-sm outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
                <button className="px-3 py-1.5 bg-sky-500 rounded-lg text-white text-sm font-medium hover:bg-sky-600 transition-colors">Send</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Resign confirm modal */}
      <AnimatePresence>
        {showResignConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-[var(--bg-card)] rounded-2xl p-6 w-full max-w-sm border border-[var(--border)] shadow-2xl">
              <Flag className="w-10 h-10 text-red-400 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-center text-[var(--text-primary)] mb-2">Resign Game?</h3>
              <p className="text-sm text-[var(--text-muted)] text-center mb-6">
                You will lose this match{stakes > 0 ? ` and forfeit Rp ${stakes.toLocaleString('id-ID')}` : ''}.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowResignConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-hover)] transition-colors">
                  Cancel
                </button>
                <button onClick={() => {
                  setShowResignConfirm(false);
                  setGameStatus('resigned');
                  setWinner(playerColor === 'white' ? 'Black' : 'White');
                  setGameEndReason('resignation');
                  onGameEnd?.('loss');
                }}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors">
                  Resign
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlayerBar({ name, elo, avatar, time, isActive, color, isThinking }: {
  name: string; elo: number; avatar: string; time: number;
  isActive: boolean; color: string; isThinking: boolean;
}) {
  const isLowTime = time < 30;
  const isCritical = time < 10;

  return (
    <div className={`flex items-center justify-between w-full max-w-[480px] px-3 py-2 rounded-xl transition-all
      ${isActive ? 'bg-[var(--bg-hover)] border border-[var(--accent)]/30' : 'bg-[var(--bg-card)] border border-[var(--border)]'}`}
      style={{ minWidth: '280px' }}>
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <div className={`w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 ${isActive ? 'ring-2 ring-sky-400' : ''}`}>
            <img src={avatar || `https://api.dicebear.com/9.x/avataaars/svg?seed=${name}`} alt={name} className="w-full h-full object-cover" />
          </div>
          {isActive && <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[var(--bg-card)] active-timer" />}
        </div>
        <div>
          <div className="font-semibold text-sm text-[var(--text-primary)]">{name}</div>
          <div className="text-xs text-[var(--text-muted)]">ELO {elo} • {color === 'white' ? '⬜' : '⬛'}</div>
        </div>
        {isThinking && (
          <div className="flex gap-1 ml-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        )}
      </div>
      <div className={`font-mono font-bold text-lg px-3 py-1.5 rounded-lg min-w-[72px] text-center
        ${isCritical ? 'bg-red-500/20 text-red-400 active-timer' : isLowTime ? 'bg-yellow-500/10 text-yellow-400' : 'bg-[var(--bg-primary)] text-[var(--text-primary)]'}`}>
        {formatTime(time)}
      </div>
    </div>
  );
}

function ControlBtn({ icon: Icon, onClick, title, active, badge }: {
  icon: any; onClick: () => void; title: string; active?: boolean; badge?: number;
}) {
  return (
    <button onClick={onClick} title={title} className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors
      ${active ? 'bg-sky-500/20 text-sky-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}>
      <Icon className="w-4 h-4" />
      {badge && badge > 0 ? (
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-sky-500 rounded-full text-white text-[9px] flex items-center justify-center font-bold">{badge}</span>
      ) : null}
    </button>
  );
}

function GameEndOverlay({ status, winner, stakes, playerColor, endReason, onRematch }: {
  status: string; winner: string | null; stakes: number; playerColor: string;
  endReason: 'checkmate' | 'timeout' | 'resignation' | null; onRematch: () => void;
}) {
  const isWin = winner === (playerColor === 'white' ? 'White' : 'Black');
  const isDraw = status === 'draw';

  const reasonText = endReason === 'resignation' ? 'resignation'
    : endReason === 'timeout' ? 'timeout'
    : 'checkmate';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-lg">
      <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 15 }}
        className="text-center">
        <div className="text-6xl mb-3">{isDraw ? '🤝' : isWin ? '🏆' : '😔'}</div>
        <div className={`text-2xl font-black mb-1 ${isDraw ? 'text-yellow-400' : isWin ? 'text-emerald-400' : 'text-red-400'}`}>
          {isDraw ? 'Draw!' : isWin ? 'You Win!' : 'You Lose!'}
        </div>
        {winner && !isDraw && (
          <div className="text-white/70 text-sm mb-2">{winner} wins by {reasonText}</div>
        )}
        {stakes > 0 && (
          <div className={`text-lg font-bold mb-4 ${isWin ? 'text-emerald-400' : isDraw ? 'text-yellow-400' : 'text-red-400'}`}>
            {isDraw ? '±Rp 0' : isWin ? `+Rp ${stakes.toLocaleString('id-ID')}` : `-Rp ${stakes.toLocaleString('id-ID')}`}
          </div>
        )}
        <div className="flex gap-3 justify-center mt-2">
          <button onClick={onRematch}
            className="px-5 py-2.5 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-colors">
            Rematch
          </button>
          <button onClick={() => window.location.href = '/game'}
            className="px-5 py-2.5 bg-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/20 transition-colors">
            New Game
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, Square } from 'chess.js';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flag, RotateCcw, MessageSquare,
  Wifi, WifiOff, Handshake, Clock
} from 'lucide-react';
import { getSocket } from '@/lib/socket';
import { useAppStore } from '@/lib/store';
import { formatTime } from '@/lib/chess-ai';
import { playChessSound, soundForMove, setChessSoundsEnabled } from '@/lib/chess-sounds';
import type { TimeControl } from '@/types';

interface OnlineGameProps {
  gameId: string;
  playerColor: 'white' | 'black';
  white: { id: string; username: string; elo: number; avatar: string; title?: string };
  black: { id: string; username: string; elo: number; avatar: string; title?: string };
  timeControl: TimeControl;
  stakes: number;
  token: string;
  onGameEnd?: (result: 'win' | 'loss' | 'draw', eloChange: number) => void;
}

const BOARD_THEMES = {
  classic: { light: '#f0d9b5', dark: '#b58863' },
  ocean: { light: '#dee3e6', dark: '#8ca2ad' },
  neon: { light: '#1a1a2e', dark: '#16213e' },
};

export default function OnlineGame({
  gameId, playerColor, white, black, timeControl, stakes, token, onGameEnd
}: OnlineGameProps) {
  const { boardTheme, showLegalMoves, soundEnabled, user } = useAppStore();
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [moveFrom, setMoveFrom] = useState<Square | null>(null);
  const [optionSquares, setOptionSquares] = useState<Record<string, object>>({});
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [moveHistory, setMoveHistory] = useState<Array<{ san: string; from: string; to: string }>>([]);
  const [whiteTime, setWhiteTime] = useState(timeControl.initial);
  const [blackTime, setBlackTime] = useState(timeControl.initial);
  const [status, setStatus] = useState<'active' | 'finished' | 'draw'>('active');
  const [gameResult, setGameResult] = useState<{ winner: string; reason: string; eloChange?: number } | null>(null);
  const [opponentConnected, setOpponentConnected] = useState(true);
  const [drawOffered, setDrawOffered] = useState(false);
  const [showResign, setShowResign] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ from: string; text: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [boardFlipped, setBoardFlipped] = useState(playerColor === 'black');
  const [sessionDisplaced, setSessionDisplaced] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  // ── Premove state ─────────────────────────────────────────────────────────
  // Premove is a move queued during opponent's turn, auto-executed when our turn starts.
  // Use a ref in addition to state so the useEffect closure can read the current value.
  const [premove, setPremove] = useState<{ from: Square; to: Square; promotion?: string } | null>(null);
  const [premoveSquares, setPremoveSquares] = useState<Record<string, object>>({});
  const premoveRef = useRef<{ from: Square; to: Square; promotion?: string } | null>(null);

  const moveHistoryRef = useRef<HTMLDivElement>(null);

  // [SECURITY] Move nonce token — diterima dari server setelah setiap move
  const moveTokenRef = useRef<string | null>(null);

  // [OPTIMISTIC UPDATE] Simpan FEN sebelum move untuk rollback jika server menolak
  const pendingMoveRef = useRef<{ prevFen: string; from: Square; to: Square } | null>(null);

  // Socket disimpan di ref agar semua handler menggunakan INSTANCE YANG SAMA
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  // ── Client-side clock interpolation ──────────────────────────────────────
  // Server sends game:clock every ~1s. Between syncs, we decrement locally.
  // clockTurnRef tracks whose clock is ticking so we decrement the right one.
  const clockIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const clockTurnRef = useRef<'w' | 'b'>('w'); // current turn (from FEN)
  const statusRef = useRef<'active' | 'finished' | 'draw'>('active');
  // Track current FEN in a ref so callbacks (setTimeout, socket handlers) don't get stale fen
  const fenRef = useRef('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

  // Keep statusRef in sync so the clock interval can read it without a stale closure
  useEffect(() => { statusRef.current = status; }, [status]);

  // Clear queued premove when game ends
  useEffect(() => {
    if (status !== 'active') {
      premoveRef.current = null;
      setPremove(null);
      setPremoveSquares({});
    }
  }, [status]);

  // Keep premoveRef in sync so the socket handler can read current premove value
  useEffect(() => { premoveRef.current = premove; }, [premove]);

  // Keep fenRef in sync so setTimeout callbacks can read current FEN
  useEffect(() => { fenRef.current = fen; }, [fen]);

  const theme = BOARD_THEMES[boardTheme as keyof typeof BOARD_THEMES] || BOARD_THEMES.classic;
  const chess = new Chess(fen);
  const myId = user?.id;

  // Keep soundEnabled in sync with the chess-sounds module
  useEffect(() => { setChessSoundsEnabled(soundEnabled !== false); }, [soundEnabled]);

  // ── [SECURITY] Tab-switching detection ───────────────────────────────────
  // Detects when user hides the tab (possible engine assistance window).
  // Reports cumulative hidden time to server via socket; server logs as security event.
  useEffect(() => {
    if (status !== 'active') return;

    let hiddenSince: number | null = null;
    let totalHiddenMs = 0;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenSince = Date.now();
      } else {
        if (hiddenSince !== null) {
          const hiddenMs = Date.now() - hiddenSince;
          totalHiddenMs += hiddenMs;
          hiddenSince = null;
          // Report tab switch to server — server logs as security event
          socketRef.current?.emit('game:tab-hidden', {
            gameId,
            hiddenMs,
            totalHiddenMs,
          });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [gameId, status]);

  // ── Start/restart local clock interpolation ───────────────────────────────
  const startClockInterpolation = useCallback((turn: 'w' | 'b') => {
    if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
    clockTurnRef.current = turn;
    clockIntervalRef.current = setInterval(() => {
      if (statusRef.current !== 'active') return;
      if (clockTurnRef.current === 'w') {
        setWhiteTime(t => Math.max(0, t - 1));
      } else {
        setBlackTime(t => Math.max(0, t - 1));
      }
    }, 1000);
  }, []);

  // ── Connect socket and join game room ────────────────────────────────────
  useEffect(() => {
    const socket = getSocket(token);
    socketRef.current = socket;

    // ── Reconnect recovery ────────────────────────────────────────────────
    // On any (re)connect, rejoin the game room. Server will replay game:state
    // so we get the latest FEN, clock values, and move history automatically.
    const handleConnect = () => {
      setIsConnected(true);
      socket.emit('game:join', { gameId });
    };

    const handleDisconnect = () => {
      setIsConnected(false);
      if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    // Initial join (socket may already be connected)
    socket.emit('game:join', { gameId });

    socket.on('game:state', (data: any) => {
      // Authoritative server snapshot overrides any unresolved optimistic state.
      pendingMoveRef.current = null;
      fenRef.current = data.fen;
      setFen(data.fen);
      setMoveHistory(data.moveHistory || []);
      setWhiteTime(data.whiteTimeLeft);
      setBlackTime(data.blackTimeLeft);
      if (data.nextMoveToken) moveTokenRef.current = data.nextMoveToken;

      // Restart clock interpolation from server-authoritative state
      const turn = new Chess(data.fen).turn();
      if (statusRef.current === 'active') startClockInterpolation(turn);
    });

    socket.on('game:move', (data: any) => {
      if (pendingMoveRef.current !== null) {
        const pending = pendingMoveRef.current;
        const isEcho = pending.from === data.move?.from && pending.to === data.move?.to;
        if (isEcho) {
          // Echo of our own move — sync clocks, clear pending
          pendingMoveRef.current = null;
          setWhiteTime(data.whiteTimeLeft);
          setBlackTime(data.blackTimeLeft);
          // Restart clock for opponent's turn
          const nextTurn = data.nextTurn || (playerColor === 'white' ? 'b' : 'w');
          startClockInterpolation(nextTurn);
          // Execute queued premove if any — use ref to avoid stale closure
          if (premoveRef.current) {
            const pm = premoveRef.current;
            premoveRef.current = null;
            setPremove(null);
            setPremoveSquares({});
            // Small delay to let state settle
            setTimeout(() => attemptPremove(pm), 50);
          }
          return;
        }
        // Unresolved optimistic move diverged from server move; drop it and resync.
        pendingMoveRef.current = null;
        setMoveHistory(prev => prev.slice(0, -1));
      }
      // Opponent's move — apply fully
      fenRef.current = data.fen;
      setFen(data.fen);
      setLastMove({ from: data.move.from, to: data.move.to });
      setMoveHistory(prev => [...prev, data.move]);
      setWhiteTime(data.whiteTimeLeft);
      setBlackTime(data.blackTimeLeft);

      // Play sound for opponent's move
      if (data.move) {
        const afterChess = new Chess(data.fen);
        const snd = soundForMove(
          data.move.flags || '',
          afterChess.inCheck(),
          !!(data.move.flags || '').includes('c') || !!(data.move.flags || '').includes('e'),
        );
        playChessSound(snd);
      }

      // Restart clock — now it's our turn
      const myTurnLetter = playerColor === 'white' ? 'w' : 'b';
      startClockInterpolation(myTurnLetter);
    });

    // [SECURITY] Server sends fresh token after each accepted move
    socket.on('move:token', (data: any) => {
      if (data.nextMoveToken) moveTokenRef.current = data.nextMoveToken;
    });

    // [SECURITY] Displaced by another tab/device
    socket.on('session:displaced', () => {
      setSessionDisplaced(true);
      setStatus('finished');
      if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
    });

    socket.on('game:clock', (data: any) => {
      // Server authoritative sync — correct any local drift
      setWhiteTime(data.whiteTimeLeft);
      setBlackTime(data.blackTimeLeft);
    });

    socket.on('game:over', (data: any) => {
      if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
      setStatus(data.winner === 'draw' ? 'draw' : 'finished');
      const myEloChange = data.eloChanges?.[myId!] || 0;
      setGameResult({ winner: data.winner, reason: data.endReason, eloChange: myEloChange });
      const myColor = playerColor;
      const result = data.winner === 'draw' ? 'draw' : data.winner === myColor ? 'win' : 'loss';
      playChessSound(result === 'win' ? 'win' : result === 'loss' ? 'lose' : 'draw');
      onGameEnd?.(result, myEloChange);
      // Clear any queued premove
      setPremove(null);
      setPremoveSquares({});
    });

    socket.on('game:draw-offered', () => setDrawOffered(true));
    socket.on('game:draw-declined', () => setDrawOffered(false));

    socket.on('opponent:disconnected', () => setOpponentConnected(false));
    socket.on('opponent:connected', () => setOpponentConnected(true));

    socket.on('move:invalid', (data: any) => {
      console.warn('[Move] Invalid:', data.reason);
      if (pendingMoveRef.current !== null) {
        fenRef.current = pendingMoveRef.current.prevFen;
        setFen(pendingMoveRef.current.prevFen);
        setMoveHistory(prev => prev.slice(0, -1));
        pendingMoveRef.current = null;
      }
      // Also cancel any queued premove on rejection
      setPremove(null);
      setPremoveSquares({});
      setMoveFrom(null);
      setOptionSquares({});
      if (data?.requestTokenRefresh) {
        // Rejoin to fetch fresh server-authoritative state + move token.
        socket.emit('game:join', { gameId });
      }
    });

    socket.on('game:chat', (data: any) => {
      setChatMessages(prev => [...prev, { from: data.username, text: data.message }]);
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('game:state');
      socket.off('game:move');
      socket.off('game:clock');
      socket.off('game:over');
      socket.off('game:draw-offered');
      socket.off('game:draw-declined');
      socket.off('opponent:disconnected');
      socket.off('opponent:connected');
      socket.off('move:invalid');
      socket.off('move:token');
      socket.off('session:displaced');
      socket.off('game:chat');
      if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, token]);

  // Auto-scroll move history
  useEffect(() => {
    if (moveHistoryRef.current) {
      moveHistoryRef.current.scrollTop = moveHistoryRef.current.scrollHeight;
    }
  }, [moveHistory]);

  // ── Move handling ─────────────────────────────────────────────────────────
  const isMyTurn = (chess.turn() === 'w' && playerColor === 'white') ||
                   (chess.turn() === 'b' && playerColor === 'black');

  function getMoveOptions(square: Square) {
    const moves = chess.moves({ square, verbose: true });
    if (moves.length === 0) return false;
    const squares: Record<string, object> = {};
    moves.forEach(m => {
      squares[m.to] = {
        background: chess.get(m.to as Square)
          ? 'radial-gradient(circle, rgba(239,68,68,0.6) 85%, transparent 85%)'
          : 'radial-gradient(circle, rgba(14,165,233,0.5) 25%, transparent 25%)',
        borderRadius: '50%',
      };
    });
    squares[square] = { background: 'rgba(255,255,0,0.3)' };
    setOptionSquares(squares);
    return true;
  }

  // ── Premove attempt ───────────────────────────────────────────────────────
  // Called when our turn starts — try to execute the queued premove.
  // Uses fenRef (not fen state) to get the latest FEN even in setTimeout callbacks.
  function attemptPremove(pm: { from: Square; to: Square; promotion?: string }) {
    const currentFen = fenRef.current; // always up-to-date
    const chessCopy = new Chess(currentFen);
    let move;
    try { move = chessCopy.move({ from: pm.from, to: pm.to, promotion: pm.promotion || 'q' }); } catch {}
    if (!move) {
      // Illegal premove — cancel silently
      setPremove(null);
      setPremoveSquares({});
      return;
    }
    sendMove(pm.from, pm.to, move.promotion, chessCopy.fen(), move.san, currentFen);
  }

  function onSquareClick(square: Square) {
    if (status !== 'active') return;

    // ── NOT MY TURN: queue premove ────────────────────────────────────────
    if (!isMyTurn) {
      if (!moveFrom) {
        // Select premove source — only own pieces
        const myColor = playerColor === 'white' ? 'w' : 'b';
        const piece = chess.get(square);
        if (piece && piece.color === myColor) {
          setMoveFrom(square);
          setPremoveSquares({ [square]: { background: 'rgba(168,85,247,0.4)' } });
        }
        return;
      }
      // Set premove destination
      const myColor = playerColor === 'white' ? 'w' : 'b';
      const piece = chess.get(square);
      if (piece && piece.color === myColor) {
        // Reselect source
        setMoveFrom(square);
        setPremoveSquares({ [square]: { background: 'rgba(168,85,247,0.4)' } });
        return;
      }
      // Queue the premove (will be validated on execution)
      setPremove({ from: moveFrom as Square, to: square });
      setPremoveSquares({
        [moveFrom as string]: { background: 'rgba(168,85,247,0.4)' },
        [square]: { background: 'rgba(168,85,247,0.25)' },
      });
      setMoveFrom(null);
      return;
    }

    // ── MY TURN: normal move ──────────────────────────────────────────────
    // Clear any queued premove when we start moving manually
    if (premove) {
      setPremove(null);
      setPremoveSquares({});
    }

    if (!moveFrom) {
      const piece = chess.get(square);
      if (piece && piece.color === chess.turn()) {
        setMoveFrom(square);
        getMoveOptions(square);
      }
      return;
    }

    const chessCopy = new Chess(fen);
    let move;
    try { move = chessCopy.move({ from: moveFrom, to: square, promotion: 'q' }); } catch {}

    if (!move) {
      const piece = chess.get(square);
      if (piece && piece.color === chess.turn()) {
        setMoveFrom(square);
        getMoveOptions(square);
      } else {
        setMoveFrom(null);
        setOptionSquares({});
      }
      return;
    }

    sendMove(moveFrom, square, move.promotion, chessCopy.fen(), move.san, fen);
    setMoveFrom(null);
    setOptionSquares({});
  }

  function onDrop(sourceSquare: Square, targetSquare: Square) {
    if (status !== 'active') return false;

    // ── NOT MY TURN: queue premove via drag ───────────────────────────────
    if (!isMyTurn) {
      const myColor = playerColor === 'white' ? 'w' : 'b';
      const piece = chess.get(sourceSquare);
      if (piece && piece.color === myColor) {
        setPremove({ from: sourceSquare, to: targetSquare });
        setPremoveSquares({
          [sourceSquare]: { background: 'rgba(168,85,247,0.4)' },
          [targetSquare]: { background: 'rgba(168,85,247,0.25)' },
        });
        return true;
      }
      return false;
    }

    const chessCopy = new Chess(fen);
    let move;
    try { move = chessCopy.move({ from: sourceSquare, to: targetSquare, promotion: 'q' }); } catch {}
    if (!move) return false;
    sendMove(sourceSquare, targetSquare, move.promotion, chessCopy.fen(), move.san, fen);
    return true;
  }

  /**
   * Send move to server with instant optimistic update.
   *
   * @param from        - source square
   * @param to          - target square
   * @param promotion   - promotion piece (optional)
   * @param newFen      - FEN after move (pre-computed by caller)
   * @param san         - algebraic notation (pre-computed by caller)
   * @param prevFen     - FEN before move (for rollback)
   */
  function sendMove(
    from: Square,
    to: Square,
    promotion: string | undefined,
    newFen: string,
    san: string,
    prevFen: string,
  ) {
    // ── OPTIMISTIC UPDATE ─────────────────────────────────────────────────
    pendingMoveRef.current = { prevFen, from, to };
    fenRef.current = newFen; // keep ref in sync immediately (before setState batching)
    setFen(newFen);
    setLastMove({ from, to });
    setMoveHistory(prev => [...prev, { san, from, to }]);

    // Play sound for our own move
    const afterChess = new Chess(newFen);
    const isCapture = chess.get(to) !== null || san.includes('x');
    const flags = san.includes('O') ? (san.includes('O-O-O') ? 'q' : 'k') : (san.includes('=') ? 'p' : isCapture ? 'c' : 'n');
    playChessSound(soundForMove(flags, afterChess.inCheck(), isCapture));

    // Update clock turn to opponent immediately
    const opponentTurn = playerColor === 'white' ? 'b' : 'w';
    startClockInterpolation(opponentTurn);
    // ── END OPTIMISTIC UPDATE ─────────────────────────────────────────────

    socketRef.current?.emit('game:move', {
      gameId, from, to, promotion,
      moveToken: moveTokenRef.current,
    });
  }

  function resign() {
    socketRef.current?.emit('game:resign', { gameId });
    setShowResign(false);
  }

  function offerDraw() {
    socketRef.current?.emit('game:draw-offer', { gameId });
  }

  function acceptDraw() {
    socketRef.current?.emit('game:draw-accept', { gameId });
    setDrawOffered(false);
  }

  function declineDraw() {
    socketRef.current?.emit('game:draw-decline', { gameId });
    setDrawOffered(false);
  }

  function sendChat() {
    if (!chatInput.trim()) return;
    socketRef.current?.emit('game:chat', { gameId, message: chatInput.trim() });
    setChatMessages(prev => [...prev, { from: 'me', text: chatInput.trim() }]);
    setChatInput('');
  }

  const customSquareStyles: Record<string, object> = {
    // Premove highlights (purple) take priority while queued
    ...premoveSquares,
    ...(showLegalMoves ? optionSquares : {}),
    ...(lastMove ? {
      [lastMove.from]: { background: 'rgba(255,213,0,0.25)' },
      [lastMove.to]: { background: 'rgba(255,213,0,0.4)' },
    } : {}),
    ...(chess.inCheck() && status === 'active' ? (() => {
      const pieces = chess.board().flat();
      const king = pieces.find(p => p?.type === 'k' && p.color === chess.turn());
      return king ? { [king.square]: { background: 'rgba(239,68,68,0.5)' } } : {};
    })() : {}),
  };

  const topPlayer = boardFlipped ? white : black;
  const bottomPlayer = boardFlipped ? black : white;
  const topTime = boardFlipped ? whiteTime : blackTime;
  const bottomTime = boardFlipped ? blackTime : whiteTime;
  const isTopTurn = boardFlipped ? chess.turn() === 'w' : chess.turn() === 'b';

  const movePairs: [{ san: string } | undefined, { san: string } | undefined][] = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    movePairs.push([moveHistory[i], moveHistory[i + 1]]);
  }

  return (
    <div className="flex flex-col xl:flex-row gap-4">
      {/* Board column */}
      <div className="flex flex-col items-center gap-3">
        {/* Opponent (top) */}
        <OnlinePlayerBar
          player={topPlayer}
          time={topTime}
          isActive={isTopTurn && status === 'active'}
          connected={opponentConnected}
          isMe={topPlayer.id === myId}
        />

        {/* Board */}
        <div className="relative">
          {status !== 'active' && gameResult && (
            <GameEndOverlay
              result={gameResult}
              playerColor={playerColor}
              stakes={stakes}
              onNewGame={() => window.location.href = '/game'}
            />
          )}
          <Chessboard
            id="online-board"
            position={fen}
            onSquareClick={onSquareClick}
            onPieceDrop={onDrop}
            boardOrientation={boardFlipped ? 'black' : 'white'}
            customBoardStyle={{ borderRadius: '8px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
            customLightSquareStyle={{ backgroundColor: theme.light }}
            customDarkSquareStyle={{ backgroundColor: theme.dark }}
            customSquareStyles={customSquareStyles}
            animationDuration={100}
            showBoardNotation={true}
            boardWidth={Math.min(480, typeof window !== 'undefined' ? window.innerWidth - 48 : 480)}
          />
          {/* Premove indicator badge */}
          {premove && (
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs bg-purple-600/80 text-white px-2 py-0.5 rounded-full font-medium backdrop-blur-sm">
              Premove: {premove.from}→{premove.to} · Click to cancel
            </div>
          )}
        </div>

        {/* You (bottom) */}
        <OnlinePlayerBar
          player={bottomPlayer}
          time={bottomTime}
          isActive={!isTopTurn && status === 'active'}
          connected={true}
          isMe={bottomPlayer.id === myId}
        />

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Connection indicator */}
          <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${isConnected ? 'text-emerald-400' : 'text-orange-400 bg-orange-500/10 animate-pulse'}`}>
            {isConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {!isConnected && 'Reconnecting...'}
          </div>
          <button onClick={() => setBoardFlipped(f => !f)}
            className="w-9 h-9 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors flex items-center justify-center">
            <RotateCcw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowChat(c => !c)}
            className={`w-9 h-9 rounded-lg transition-colors flex items-center justify-center ${showChat ? 'bg-sky-500/20 text-sky-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}>
            <MessageSquare className="w-4 h-4" />
          </button>
          {/* Cancel premove button */}
          {premove && (
            <button
              onClick={() => { setPremove(null); setPremoveSquares({}); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-400 text-sm font-medium hover:bg-purple-500/20 border border-purple-500/20 transition-colors">
              ✕ Premove
            </button>
          )}
          {status === 'active' && (
            <>
              <button onClick={offerDraw}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 text-sm font-medium hover:bg-yellow-500/20 border border-yellow-500/20 transition-colors">
                <Handshake className="w-4 h-4" /> Draw
              </button>
              <button onClick={() => setShowResign(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-sm font-medium hover:bg-red-500/20 border border-red-500/20 transition-colors">
                <Flag className="w-4 h-4" /> Resign
              </button>
            </>
          )}
        </div>

        {/* Draw offer notification */}
        <AnimatePresence>
          {drawOffered && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="w-full max-w-[480px] card rounded-xl p-4 border-yellow-500/30 bg-yellow-500/10">
              <p className="text-sm font-medium text-yellow-400 mb-3">
                <Handshake className="w-4 h-4 inline mr-1.5" />
                Opponent offers a draw
              </p>
              <div className="flex gap-2">
                <button onClick={acceptDraw} className="flex-1 py-2 bg-yellow-500 text-white rounded-lg text-sm font-semibold hover:bg-yellow-600 transition-colors">Accept</button>
                <button onClick={declineDraw} className="flex-1 py-2 bg-[var(--bg-hover)] text-[var(--text-primary)] rounded-lg text-sm font-medium hover:bg-[var(--border)] transition-colors">Decline</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Side panel */}
      <div className="flex-1 flex flex-col gap-4 min-w-0 max-w-sm xl:max-w-none mx-auto xl:mx-0 w-full">
        {/* Game info */}
        <div className="card p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {status === 'active' ? 'Live PvP Match' : 'Game Over'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              <span className="text-sm font-mono text-[var(--text-secondary)]">{timeControl.label}</span>
            </div>
          </div>
          {stakes > 0 && (
            <div className="mt-2.5 flex items-center justify-between px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <span className="text-xs text-yellow-600 dark:text-yellow-400">Stakes</span>
              <span className="font-bold text-yellow-600 dark:text-yellow-400 text-sm">
                Rp {stakes.toLocaleString('id-ID')}
              </span>
            </div>
          )}
          {!opponentConnected && status === 'active' && (
            <div className="mt-2 flex items-center gap-2 text-xs text-orange-400 bg-orange-500/10 rounded-lg px-3 py-2 border border-orange-500/20">
              <WifiOff className="w-3.5 h-3.5" />
              Opponent disconnected — 60s to reconnect
            </div>
          )}
          {sessionDisplaced && (
            <div className="mt-2 flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
              <WifiOff className="w-3.5 h-3.5" />
              Sesi ini dibuka di tab lain. Tab ini tidak aktif.
            </div>
          )}
          {chess.inCheck() && status === 'active' && (
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}
              className="mt-2 text-center text-sm font-bold text-red-400 bg-red-500/10 rounded-lg py-1.5 border border-red-500/20">
              ♚ CHECK!
            </motion.div>
          )}
          {/* Premove hint */}
          {premove && !isMyTurn && (
            <div className="mt-2 text-center text-xs text-purple-400 bg-purple-500/10 rounded-lg py-1.5 border border-purple-500/20">
              ⚡ Premove queued: {premove.from} → {premove.to}
            </div>
          )}
        </div>

        {/* Move history */}
        <div className="card rounded-xl flex flex-col min-h-[180px] max-h-[360px]">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between flex-shrink-0">
            <span className="font-semibold text-sm text-[var(--text-primary)]">Move History</span>
            <span className="text-xs text-[var(--text-muted)]">{moveHistory.length} moves</span>
          </div>
          <div ref={moveHistoryRef} className="flex-1 overflow-y-auto p-3 space-y-0.5">
            {movePairs.length === 0
              ? <div className="text-center text-[var(--text-muted)] text-sm py-6">Waiting for moves...</div>
              : movePairs.map((pair, i) => (
                <div key={i} className="flex items-center gap-1 text-sm">
                  <span className="w-7 text-[var(--text-muted)] font-mono text-xs flex-shrink-0">{i + 1}.</span>
                  {pair[0] && <span className="flex-1 px-2 py-0.5 rounded font-mono font-medium text-[var(--text-primary)] text-sm">{pair[0].san}</span>}
                  {pair[1] && <span className="flex-1 px-2 py-0.5 rounded font-mono font-medium text-[var(--text-primary)] text-sm">{pair[1].san}</span>}
                </div>
              ))
            }
          </div>
        </div>

        {/* Chat */}
        <AnimatePresence>
          {showChat && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="card rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <span className="font-semibold text-sm text-[var(--text-primary)]">Chat</span>
              </div>
              <div className="p-3 space-y-2 max-h-32 overflow-y-auto">
                {chatMessages.length === 0
                  ? <p className="text-xs text-[var(--text-muted)] text-center">No messages yet</p>
                  : chatMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.from === 'me' ? 'flex-row-reverse' : ''}`}>
                      <div className={`px-3 py-1.5 rounded-xl text-sm max-w-[75%] ${msg.from === 'me' ? 'bg-sky-500 text-white' : 'bg-[var(--bg-hover)] text-[var(--text-primary)]'}`}>
                        {msg.text}
                      </div>
                    </div>
                  ))
                }
              </div>
              <div className="p-3 border-t border-[var(--border)] flex gap-2">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendChat()}
                  placeholder="Message..." className="flex-1 bg-[var(--bg-hover)] rounded-lg px-3 py-1.5 text-sm outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
                <button onClick={sendChat} className="px-3 py-1.5 bg-sky-500 rounded-lg text-white text-sm font-medium hover:bg-sky-600 transition-colors">Send</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Resign confirm */}
      <AnimatePresence>
        {showResign && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-[var(--bg-card)] rounded-2xl p-6 w-full max-w-xs border border-[var(--border)] shadow-2xl text-center">
              <Flag className="w-10 h-10 text-red-400 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">Resign?</h3>
              <p className="text-sm text-[var(--text-muted)] mb-5">
                {stakes > 0 ? `You'll forfeit Rp ${stakes.toLocaleString('id-ID')}` : 'You will lose this game.'}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setShowResign(false)} className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-hover)] transition-colors">Cancel</button>
                <button onClick={resign} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors">Resign</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function OnlinePlayerBar({ player, time, isActive, connected, isMe }: {
  player: { username: string; elo: number; avatar: string; title?: string };
  time: number; isActive: boolean; connected: boolean; isMe: boolean;
}) {
  const isLow = time < 30;
  const isCritical = time < 10;
  return (
    <div className={`flex items-center justify-between w-full max-w-[480px] px-3 py-2 rounded-xl transition-all
      ${isActive ? 'bg-[var(--bg-hover)] border border-[var(--accent)]/30' : 'bg-[var(--bg-card)] border border-[var(--border)]'}`}
      style={{ minWidth: 280 }}>
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <div className={`w-9 h-9 rounded-xl overflow-hidden ${isActive ? 'ring-2 ring-sky-400' : ''}`}>
            <img src={player.avatar || `https://api.dicebear.com/9.x/avataaars/svg?seed=${player.username}`} alt="" className="w-full h-full object-cover" />
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-card)] ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            {player.title && <span className="text-xs font-bold text-yellow-400">{player.title}</span>}
            <span className={`font-semibold text-sm ${isMe ? 'text-sky-400' : 'text-[var(--text-primary)]'}`}>
              {player.username}{isMe ? ' (You)' : ''}
            </span>
          </div>
          <div className="text-xs text-[var(--text-muted)]">ELO {player.elo}</div>
        </div>
      </div>
      <div className={`font-mono font-bold text-lg px-3 py-1.5 rounded-lg min-w-[72px] text-center
        ${isCritical ? 'bg-red-500/20 text-red-400 active-timer' : isLow ? 'bg-yellow-500/10 text-yellow-400' : 'bg-[var(--bg-primary)] text-[var(--text-primary)]'}`}>
        {formatTime(time)}
      </div>
    </div>
  );
}

function GameEndOverlay({ result, playerColor, stakes, onNewGame }: {
  result: { winner: string; reason: string; eloChange?: number };
  playerColor: string; stakes: number; onNewGame: () => void;
}) {
  const isDraw = result.winner === 'draw';
  const isWin = result.winner === playerColor;
  const reasonLabels: Record<string, string> = {
    checkmate: 'by checkmate', resign: 'by resignation', timeout: 'on time',
    disconnect: 'by disconnection', stalemate: 'by stalemate',
    'draw-agreement': 'by agreement', repetition: 'by repetition',
    insufficient: 'insufficient material',
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-lg">
      <motion.div initial={{ scale: 0.8, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', damping: 15 }}
        className="text-center px-6">
        <div className="text-6xl mb-3">{isDraw ? '🤝' : isWin ? '🏆' : '😔'}</div>
        <div className={`text-3xl font-black mb-1 ${isDraw ? 'text-yellow-400' : isWin ? 'text-emerald-400' : 'text-red-400'}`}>
          {isDraw ? 'Draw!' : isWin ? 'You Win!' : 'You Lose!'}
        </div>
        <p className="text-white/60 text-sm mb-1 capitalize">{reasonLabels[result.reason] || result.reason}</p>
        {result.eloChange !== undefined && (
          <div className={`text-lg font-bold mb-1 ${result.eloChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {result.eloChange >= 0 ? '+' : ''}{result.eloChange} ELO
          </div>
        )}
        {stakes > 0 && (
          <div className={`text-base font-bold mb-4 ${isWin ? 'text-emerald-400' : isDraw ? 'text-yellow-400' : 'text-red-400'}`}>
            {isDraw ? '±Rp 0' : isWin ? `+Rp ${Math.floor(stakes * 0.96).toLocaleString('id-ID')}` : `-Rp ${stakes.toLocaleString('id-ID')}`}
          </div>
        )}
        <div className="flex gap-3 justify-center mt-3">
          <button onClick={onNewGame} className="px-5 py-2.5 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-colors">
            New Game
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

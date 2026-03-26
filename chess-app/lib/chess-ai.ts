import { Chess, Move } from 'chess.js';

// Piece values for evaluation
const PIECE_VALUES: Record<string, number> = {
  p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000,
};

// Position bonus tables for better positional play
const PAWN_TABLE = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];

const KNIGHT_TABLE = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];

function getPiecePositionValue(piece: string, color: string, square: string): number {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]) - 1;
  const index = color === 'w' ? (7 - rank) * 8 + file : rank * 8 + file;

  if (piece === 'p') return PAWN_TABLE[index] || 0;
  if (piece === 'n') return KNIGHT_TABLE[index] || 0;
  return 0;
}

function evaluateBoard(chess: Chess): number {
  let score = 0;
  const board = chess.board();

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = board[rank][file];
      if (!piece) continue;

      const square = String.fromCharCode(97 + file) + (rank + 1);
      const value = PIECE_VALUES[piece.type] + getPiecePositionValue(piece.type, piece.color, square);

      score += piece.color === 'w' ? value : -value;
    }
  }

  return score;
}

function minimax(chess: Chess, depth: number, alpha: number, beta: number, maximizing: boolean): number {
  if (depth === 0 || chess.isGameOver()) {
    if (chess.isCheckmate()) return maximizing ? -100000 : 100000;
    if (chess.isDraw()) return 0;
    return evaluateBoard(chess);
  }

  const moves = chess.moves({ verbose: true });

  // Move ordering: captures first
  moves.sort((a, b) => {
    if (a.captured && !b.captured) return -1;
    if (!a.captured && b.captured) return 1;
    return 0;
  });

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      chess.move(move);
      const evalScore = minimax(chess, depth - 1, alpha, beta, false);
      chess.undo();
      maxEval = Math.max(maxEval, evalScore);
      alpha = Math.max(alpha, evalScore);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      chess.move(move);
      const evalScore = minimax(chess, depth - 1, alpha, beta, true);
      chess.undo();
      minEval = Math.min(minEval, evalScore);
      beta = Math.min(beta, evalScore);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

export function getBestMove(fen: string, difficulty: 'easy' | 'medium' | 'hard'): string | null {
  const chess = new Chess(fen);

  if (chess.isGameOver()) return null;

  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;

  // Easy: random move
  if (difficulty === 'easy') {
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    return randomMove.san;
  }

  // Medium: depth 2, with some randomness
  if (difficulty === 'medium') {
    if (Math.random() < 0.2) {
      const randomMove = moves[Math.floor(Math.random() * moves.length)];
      return randomMove.san;
    }
  }

  const depth = difficulty === 'medium' ? 2 : 4;
  const isMaximizing = chess.turn() === 'w';

  let bestMove: Move | null = null;
  let bestScore = isMaximizing ? -Infinity : Infinity;

  for (const move of moves) {
    chess.move(move);
    const score = minimax(chess, depth - 1, -Infinity, Infinity, !isMaximizing);
    chess.undo();

    if (isMaximizing ? score > bestScore : score < bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove?.san || null;
}

export function formatTime(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}


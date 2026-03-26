export interface User {
  id: string;
  username: string;
  email: string;
  avatar: string;
  elo: number;
  rank: string;
  wins: number;
  losses: number;
  draws: number;
  balance: number;
  verified: boolean;
  createdAt: string;
  country: string;
  title?: 'GM' | 'IM' | 'FM' | 'CM' | 'WGM' | 'WIM';
  // Anti-cheat fields
  trust_score?: number;
  flagged?: boolean;
  is_admin?: boolean;
}

export interface GameState {
  id: string;
  fen: string;
  pgn: string;
  turn: 'w' | 'b';
  status: 'waiting' | 'active' | 'finished' | 'draw' | 'resigned';
  winner?: 'white' | 'black' | 'draw';
  whitePlayer: Player;
  blackPlayer: Player;
  timeControl: TimeControl;
  moveHistory: MoveRecord[];
  stakes: number;
  startedAt: string;
  endedAt?: string;
  mode: GameMode;
}

export interface Player {
  id: string;
  username: string;
  avatar: string;
  elo: number;
  timeLeft: number;
  title?: string;
}

export interface MoveRecord {
  san: string;
  from: string;
  to: string;
  piece: string;
  captured?: string;
  promotion?: string;
  timestamp: number;
  timeLeft: number;
}

export interface TimeControl {
  type: 'bullet' | 'blitz' | 'rapid' | 'classical';
  initial: number;
  increment: number;
  label: string;
}

export type GameMode = 'pvp-online' | 'pvp-local' | 'ai-easy' | 'ai-medium' | 'ai-hard' | 'ai-stockfish';

export interface Transaction {
  id: string;
  type: 'deposit' | 'withdraw' | 'game-win' | 'game-loss' | 'tournament-prize' | 'commission';
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  description: string;
  createdAt: string;
  reference?: string;
}

export interface Tournament {
  id: string;
  name: string;
  format: 'swiss' | 'round-robin' | 'knockout' | 'arena';
  timeControl: TimeControl;
  prizePool: number;
  entryFee: number;
  maxPlayers: number;
  currentPlayers: number;
  status: 'upcoming' | 'active' | 'finished';
  startsAt: string;
  endsAt?: string;
  winner?: string;
}

export interface LeaderboardEntry {
  rank: number;
  user: User;
  gamesPlayed: number;
  winRate: number;
  eloChange: number;
  earnings: number;
}

export type ThemeMode = 'dark' | 'light';

export interface MatchmakingState {
  searching: boolean;
  timeSearching: number;
  opponent?: Player;
  gameId?: string;
}

export type BoardTheme = 'classic' | 'ocean' | 'forest' | 'neon' | 'marble';
export type PieceTheme = 'standard' | 'neo' | 'alpha' | 'chess24';

// Notifikasi dari server (tersimpan di DB)
export interface ServerNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  data?: Record<string, unknown>;
}

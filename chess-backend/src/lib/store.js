/**
 * In-memory store for users, games, and queues.
 * In production, replace with PostgreSQL/Redis.
 */

const { v4: uuidv4 } = require('uuid');

// ─── Users ──────────────────────────────────────────────────────────────────
const users = new Map(); // userId → user object

function createUser({ username, email, password }) {
  const id = uuidv4();
  const user = {
    id,
    username,
    email,
    password, // plain for demo; hash in production
    elo: 1200,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    balance: 0,
    verified: false,
    title: null,
    country: 'ID',
    avatar: `https://api.dicebear.com/9.x/avataaars/svg?seed=${username}`,
    createdAt: new Date().toISOString(),
    online: false,
    socketId: null,
  };
  users.set(id, user);
  // Also index by username for lookup
  usersByUsername.set(username.toLowerCase(), id);
  return user;
}

const usersByUsername = new Map(); // username.lower → userId

function getUserById(id) {
  return users.get(id) || null;
}

function getUserByUsername(username) {
  const id = usersByUsername.get(username.toLowerCase());
  return id ? users.get(id) : null;
}

function updateUser(id, updates) {
  const user = users.get(id);
  if (!user) return null;
  Object.assign(user, updates);
  return user;
}

function getUserPublic(id) {
  const u = users.get(id);
  if (!u) return null;
  const { password, ...pub } = u;
  return pub;
}

// ─── Games ───────────────────────────────────────────────────────────────────
const games = new Map(); // gameId → game object
const gameHistory = []; // completed games

function createGame({ whiteId, blackId, timeControl, stakes }) {
  const id = uuidv4();
  const game = {
    id,
    whiteId,
    blackId,
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn: '',
    moveHistory: [],
    status: 'active', // active | finished | draw | aborted
    winner: null,     // 'white' | 'black' | 'draw' | null
    endReason: null,  // checkmate | timeout | resign | draw-agreement | disconnect
    timeControl,
    stakes,
    whiteTimeLeft: timeControl.initial,
    blackTimeLeft: timeControl.initial,
    lastMoveAt: Date.now(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    drawOfferedBy: null,
  };
  games.set(id, game);
  return game;
}

function getGame(id) {
  return games.get(id) || null;
}

function updateGame(id, updates) {
  const game = games.get(id);
  if (!game) return null;
  Object.assign(game, updates);
  return game;
}

function finishGame(id, { winner, endReason, eloChanges }) {
  const game = games.get(id);
  if (!game) return null;
  game.status = winner === 'draw' ? 'draw' : 'finished';
  game.winner = winner;
  game.endReason = endReason;
  game.endedAt = new Date().toISOString();
  game.eloChanges = eloChanges;

  // Move to history
  gameHistory.push({ ...game });
  games.delete(id);
  return game;
}

function getUserActiveGame(userId) {
  for (const [, game] of games) {
    if ((game.whiteId === userId || game.blackId === userId) && game.status === 'active') {
      return game;
    }
  }
  return null;
}

// ─── Matchmaking Queues ────────────────────────────────────────────────────
// Structure: Map<queueKey, [{ userId, socketId, elo, joinedAt, stakes }]>
const queues = new Map();

function getQueueKey(timeControl, stakes) {
  return `${timeControl.label}:${stakes}`;
}

function joinQueue(timeControl, stakes, { userId, socketId, elo }) {
  const key = getQueueKey(timeControl, stakes);
  if (!queues.has(key)) queues.set(key, []);
  const queue = queues.get(key);

  // Remove if already in queue
  const existing = queue.findIndex(e => e.userId === userId);
  if (existing !== -1) queue.splice(existing, 1);

  queue.push({ userId, socketId, elo, joinedAt: Date.now(), timeControl, stakes });
  return key;
}

function leaveQueue(userId) {
  for (const [key, queue] of queues) {
    const idx = queue.findIndex(e => e.userId === userId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      return key;
    }
  }
  return null;
}

function findMatch(timeControl, stakes, { userId, elo }) {
  const key = getQueueKey(timeControl, stakes);
  const queue = queues.get(key);
  if (!queue || queue.length === 0) return null;

  // Find best ELO match (within ±300, or take closest after 30s)
  const now = Date.now();
  const entry = queue.find(e => {
    if (e.userId === userId) return false;
    const eloDiff = Math.abs(e.elo - elo);
    const waited = (now - e.joinedAt) / 1000;
    // Accept larger ELO range the longer someone waits
    const maxDiff = Math.min(300 + waited * 10, 800);
    return eloDiff <= maxDiff;
  });

  if (!entry) return null;

  // Remove both from queue
  const idx = queue.findIndex(e => e.userId === entry.userId);
  if (idx !== -1) queue.splice(idx, 1);
  leaveQueue(userId);

  return entry;
}

// Seed a demo user
const demoUser = createUser({
  username: 'GrandMasterX',
  email: 'player@chess-arena.com',
  password: 'demo123',
});
updateUser(demoUser.id, {
  elo: 1842, wins: 312, losses: 98, draws: 44,
  balance: 250000, verified: true, title: 'FM',
  gamesPlayed: 454,
});

module.exports = {
  createUser, getUserById, getUserByUsername, updateUser, getUserPublic,
  createGame, getGame, updateGame, finishGame, getUserActiveGame,
  joinQueue, leaveQueue, findMatch,
  users, games, gameHistory,
};

/**
 * Socket.IO event tests — matchmaking, game room, anticheat real-time flags
 *
 * Uses socket.io-client to connect to a real test server.
 * DB calls are mocked.
 */

const http = require('http');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');
const express = require('express');

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../src/lib/db', () => ({
  supabase: {},
  users: {
    findById: jest.fn(async (id) => ({
      id, username: `user_${id}`,
      elo: 1500, elo_bullet: 1500, elo_blitz: 1500, elo_rapid: 1500,
      trust_score: 100, flagged: false, online: false,
    })),
    setOnline: jest.fn(async () => {}),
    setOffline: jest.fn(async () => {}),
    update: jest.fn(async (id, updates) => ({ id, ...updates })),
  },
  wallets: {
    getBalance: jest.fn(async () => ({ balance: 1000000, locked: 0 })),
    lock: jest.fn(async () => {}),
    unlock: jest.fn(async () => {}),
    settleGamePayout: jest.fn(async () => {}),
    getBalance: jest.fn(async () => ({ balance: 1000000, locked: 0 })),
    credit: jest.fn(async () => {}),
    debit: jest.fn(async () => {}),
  },
  games: {
    findById: jest.fn(async (id) => ({
      id, white_id: 'user-1', black_id: 'user-2',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      move_history: [], status: 'active',
      time_control: { initial: 300, increment: 0 },
      stakes: 0,
      white_elo_before: 1500, black_elo_before: 1500,
      white_time_left: 300, black_time_left: 300,
    })),
    create: jest.fn(async (data) => ({
      id: 'game-123',
      ...data,
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      status: 'active',
    })),
    update: jest.fn(async (id, updates) => ({ id, ...updates })),
    findActiveByUser: jest.fn(async () => null),
    getRecentNoContestCount: jest.fn(async () => 0),
    updateIfStatus: jest.fn(async (id, expectedStatus, updates) => ({ id, status: updates.status || expectedStatus, ...updates })),
  },
  transactions: { create: jest.fn(async () => ({})) },
  notifications: {
    create: jest.fn(async () => {}),
    getUnread: jest.fn(async () => []),
  },
  eloHistory: { create: jest.fn(async () => {}) },
}));

jest.mock('../src/lib/anticheat', () => ({
  analyzeGame: jest.fn(() => ({
    white: { suspicious: false, flags: [], score: 0 },
    black: { suspicious: false, flags: [], score: 0 },
  })),
  analyzeRealtime: jest.fn(() => ({
    white: { suspicious: false, flags: [], score: 0 },
    black: { suspicious: false, flags: [], score: 0 },
  })),
  enforceAnticheat: jest.fn(async () => {}),
  detectEloAnomaly: jest.fn(async () => ({ suspicious: false, flags: [], score: 0 })),
  runStockfishBackground: jest.fn(async () => {}),
  detectDisconnectAbuse: jest.fn(() => ({ abusive: false, disconnects: 0, threshold: 3 })),
}));

jest.mock('../src/lib/collusion', () => ({
  runCollusionDetection: jest.fn(async () => ({
    white: { suspicious: false, flags: [], score: 0 },
    black: { suspicious: false, flags: [], score: 0 },
  })),
}));

jest.mock('../src/lib/fingerprint', () => ({
  recordAndDetect: jest.fn(async () => ({ isMultiAccount: false })),
  scoreFingerprintResult: jest.fn(() => ({ flags: [], score: 0 })),
}));

jest.mock('../src/lib/auditLog', () => ({
  logMove: jest.fn(),
  logSecurityEvent: jest.fn(),
  logAnticheatAction: jest.fn(async () => {}),
}));

jest.mock('../src/lib/midtrans', () => ({
  netWinnings: jest.fn((amount) => ({ net: amount * 0.96, fee: amount * 0.04 })),
}));

jest.mock('../src/lib/walletCleanup', () => ({
  startWalletCleanupJob: jest.fn(),
  unlockForUser: jest.fn(async () => {}),
  recordLock: jest.fn(),
}));

jest.mock('../src/lib/auth', () => ({
  verifyToken: jest.fn((token) => {
    if (token === 'token-user-1') return { userId: 'user-1' };
    if (token === 'token-user-2') return { userId: 'user-2' };
    return null;
  }),
  signToken: jest.fn(() => 'mock-token'),
  passwordHashVersion: jest.fn(() => 'mock-phv'),
}));

// ── Server Setup ──────────────────────────────────────────────────────────────

let httpServer, ioServer, portNum;
let client1, client2;

beforeAll((done) => {
  const app = express();
  httpServer = http.createServer(app);
  ioServer = new Server(httpServer, { cors: { origin: '*' } });

  // Apply auth middleware
  ioServer.use(async (socket, next) => {
    const { verifyToken } = require('../src/lib/auth');
    const { users } = require('../src/lib/db');
    const token = socket.handshake.auth?.token;
    const payload = verifyToken(token);
    if (!payload) return next(new Error('Authentication required'));
    const user = await users.findById(payload.userId);
    if (!user) return next(new Error('User not found'));
    socket.userId = payload.userId;
    socket.username = user.username;
    socket.userElo = user.elo;
    next();
  });

  const { registerMatchmaking } = require('../src/socket/matchmaking');
  const { registerGameRoom } = require('../src/socket/gameRoom');

  ioServer.on('connection', async (socket) => {
    const { users } = require('../src/lib/db');
    await users.setOnline(socket.userId, socket.id).catch(() => {});
    socket.join(socket.userId);
    registerMatchmaking(ioServer, socket, socket.userId);
    registerGameRoom(ioServer, socket, socket.userId);

    // Lobby chat — mirror of server.js
    socket.on('lobby:chat', ({ message }) => {
      if (!message || !message.trim()) return;
      ioServer.emit('lobby:chat', {
        from: socket.username,
        fromId: socket.userId,
        message: message.trim().slice(0, 200),
        timestamp: Date.now(),
      });
    });

    socket.on('disconnect', async () => {
      await users.setOffline(socket.userId).catch(() => {});
    });
  });

  httpServer.listen(0, () => {
    portNum = httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  if (client1?.connected) client1.disconnect();
  if (client2?.connected) client2.disconnect();
  ioServer.close();
  httpServer.close(done);
});

afterEach(() => {
  if (client1?.connected) { client1.removeAllListeners(); client1.disconnect(); }
  if (client2?.connected) { client2.removeAllListeners(); client2.disconnect(); }
});

function createClient(token) {
  return new Client(`http://localhost:${portNum}`, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
}

// ── Connection tests ──────────────────────────────────────────────────────────

describe('Socket.IO — Connection', () => {
  it('connects with valid token', (done) => {
    client1 = createClient('token-user-1');
    client1.on('connect', () => {
      expect(client1.connected).toBe(true);
      done();
    });
  });

  it('rejects connection without token', (done) => {
    const badClient = new Client(`http://localhost:${portNum}`, {
      auth: {}, transports: ['websocket'], forceNew: true,
    });
    badClient.on('connect_error', (err) => {
      expect(err.message).toMatch(/authentication/i);
      badClient.disconnect();
      done();
    });
  });
});

// ── Matchmaking Queue ─────────────────────────────────────────────────────────

describe('Socket.IO — Matchmaking Queue', () => {
  it('emits queue:joined when player joins queue', (done) => {
    client1 = createClient('token-user-1');
    client1.on('connect', () => {
      client1.on('queue:joined', (data) => {
        expect(data).toHaveProperty('queueKey');
        done();
      });
      client1.emit('queue:join', {
        timeControl: { initial: 300, increment: 0 },
        stakes: 0,
      });
    });
  });

  it('emits queue:left when player leaves queue', (done) => {
    client1 = createClient('token-user-1');
    client1.on('connect', () => {
      client1.emit('queue:join', { timeControl: { initial: 300, increment: 0 }, stakes: 0 });
      client1.on('queue:joined', () => {
        client1.on('queue:left', () => done());
        client1.emit('queue:leave');
      });
    });
  });

  it('pairs two players and emits game:found', (done) => {
    client1 = createClient('token-user-1');
    client2 = createClient('token-user-2');

    let foundCount = 0;
    const onFound = () => {
      foundCount++;
      if (foundCount === 2) done();
    };

    const tc = { initial: 300, increment: 0 };

    client1.on('connect', () => {
      client1.on('game:found', onFound);
      client1.emit('queue:join', { timeControl: tc, stakes: 0 });
    });

    client2.on('connect', () => {
      client2.on('game:found', onFound);
      client2.emit('queue:join', { timeControl: tc, stakes: 0 });
    });
  });
});

// ── Game Room ─────────────────────────────────────────────────────────────────

describe('Socket.IO — Game Room', () => {
  it('emits game:state when player joins game room', (done) => {
    client1 = createClient('token-user-1');
    client1.on('connect', () => {
      client1.on('game:state', (data) => {
        expect(data).toHaveProperty('fen');
        expect(data).toHaveProperty('playerColor');
        expect(data).toHaveProperty('nextMoveToken');
        done();
      });
      client1.emit('game:join', { gameId: 'game-123' });
    });
  });

  it('emits move:invalid when player sends invalid game:move without token', (done) => {
    client1 = createClient('token-user-1');
    client1.on('connect', () => {
      // Try to make a move without joining first (no token issued)
      client1.on('move:invalid', (data) => {
        expect(data).toHaveProperty('reason');
        done();
      });
      client1.emit('game:move', { gameId: 'game-123', from: 'e2', to: 'e4', moveToken: 'invalid' });
    });
  });
});

// ── Lobby Chat ────────────────────────────────────────────────────────────────

describe('Socket.IO — Lobby Chat', () => {
  it('broadcasts lobby:chat to all connected clients', (done) => {
    client1 = createClient('token-user-1');
    client2 = createClient('token-user-2');
    let c1Ready = false, c2Ready = false;

    function tryEmit() {
      if (!c1Ready || !c2Ready) return;
      client1.emit('lobby:chat', { message: 'Hello!' });
    }

    client2.on('connect', () => {
      c2Ready = true;
      client2.on('lobby:chat', (data) => {
        expect(data).toHaveProperty('from');
        expect(data).toHaveProperty('message');
        expect(data.message).toBe('Hello!');
        done();
      });
      tryEmit();
    });

    client1.on('connect', () => {
      c1Ready = true;
      tryEmit();
    });
  });

  it('truncates long chat messages to 200 chars', (done) => {
    client1 = createClient('token-user-1');
    client1.on('connect', () => {
      client1.on('lobby:chat', (data) => {
        expect(data.message.length).toBeLessThanOrEqual(200);
        done();
      });
      client1.emit('lobby:chat', { message: 'a'.repeat(500) });
    });
  });
});

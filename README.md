# Chess Arena — Real-Money Competitive Chess Platform

A full-stack real-time chess platform with rated matchmaking, real-money wagering, anti-cheat system, and tournament support.

**Stack**: Node.js + Express + Socket.IO (Railway) · Next.js 16 (Vercel) · Supabase (PostgreSQL) · Midtrans (Payments)

---

## Quick Start (Local Dev)

### Prerequisites
- Node.js 18+
- [Supabase](https://supabase.com) project
- [Midtrans](https://midtrans.com) sandbox account (optional for payment testing)

### 1. Clone & install

```bash
git clone <repo-url>
cd chess-arena

# Backend
cd chess-backend
npm install

# Frontend
cd ../chess-app
npm install
```

### 2. Configure environment

**Backend** — create `chess-backend/.env`:
```env
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_KEY=<your-service-key>
JWT_SECRET=<random-32-char-string>
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxx
MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxx
FRONTEND_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000
NODE_ENV=development
PORT=4000

# Optional
REDIS_URL=redis://localhost:6379
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=app-password
ADMIN_EMAIL=admin@yourdomain.com
```

**Frontend** — create `chess-app/.env.local`:
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxx
```

### 3. Run locally

```bash
# Terminal 1 — Backend
cd chess-backend
npm run dev

# Terminal 2 — Frontend
cd chess-app
npm run dev
```

Open `http://localhost:3000`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   Browser (Next.js)                  │
│  React + Zustand state + Socket.io-client           │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP + WebSocket
┌──────────────────────▼──────────────────────────────┐
│              Express + Socket.IO (Railway)           │
│                                                      │
│  REST API: /api/auth  /api/wallet  /api/game        │
│            /api/tournament  /api/leaderboard        │
│                                                      │
│  Socket.IO events:                                   │
│    queue:join/leave → game:found                    │
│    game:join/move/resign/draw → game:over           │
│    game:spectate → spectate:state + moves           │
│    lobby:chat                                       │
│                                                      │
│  Background jobs:                                    │
│    walletCleanup — unlock stuck funds (30s)         │
│    monitor — admin SLA alerts                       │
└──────────┬──────────────────────┬───────────────────┘
           │                      │
┌──────────▼──────────┐  ┌────────▼────────────┐
│  Supabase (Postgres) │  │  Midtrans Payment   │
│  Users, games, ELO  │  │  Snap, Iris API     │
│  wallets, audit logs│  └─────────────────────┘
└─────────────────────┘
```

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `users` | Accounts with per-TC ELO (elo_bullet, elo_blitz, elo_rapid), trust score, ban state |
| `wallets` | Balance + locked funds (escrow during match) |
| `transactions` | Deposit, withdraw, game-win/loss, tournament prizes |
| `games` | Full game record: FEN, PGN, move history, anticheat flags, ELO snapshots |
| `elo_history` | Per-game ELO delta history for chart/stats |
| `tournaments` | Metadata, prize pool, distribution, format (Swiss/knockout/round-robin) |
| `tournament_registrations` | Player enrollment with score for standings |
| `collusion_flags` | Match-fixing detection results for admin review |
| `multi_account_flags` | Device fingerprint overlap between accounts |
| `appeals` | Ban dispute submissions |
| `move_audit_log` | Immutable move log with timestamps and FEN |
| `anticheat_actions` | Warn/flag/suspend enforcement actions |
| `security_events` | Rate limit hits, unauthorized moves, multi-tab attempts |

**Supabase RPC functions** (atomic, no race conditions):
- `credit_wallet(user_id, amount)` — add funds
- `debit_wallet(user_id, amount)` — remove funds (fails if insufficient)
- `lock_wallet_funds(user_id, amount)` — escrow for match
- `unlock_wallet_funds(user_id, amount)` — return escrowed funds
- `settle_game_payout(winner, loser, white, black, stakes, fee)` — atomic match settlement

---

## Anti-Cheat System

5 independent detection layers run on every completed game:

| Layer | Method | Trigger |
|-------|--------|---------|
| 1 — Timing | Move speed + consistency coefficient | Avg < 0.5s or CV < 0.15 |
| 2 — Integrity | chess.js move validation replay | Any illegal move |
| 3 — Accuracy | Blunder rate analysis | 0 blunders in 20+ moves |
| 4 — ELO Anomaly | Win vs 400+ gap, rapid gain | +200 ELO in 5 games |
| 5 — Stockfish | Move match vs engine top-3 | >80% engine match rate |

**Trust Score**: starts at 100, decreases per flag. Thresholds:
- ≥40 penalty → warn
- ≥65 → auto-flag for review
- ≥90 → auto-suspend

---

## Deployment

### Backend → Railway

```bash
# Set environment variables in Railway dashboard
# Then push main branch to trigger GitHub Actions deploy
git push origin main
```

Required Railway secrets:
- `RAILWAY_TOKEN` (in GitHub repository secrets)

### Frontend → Vercel

```bash
# Set environment variables in Vercel dashboard
# GitHub Actions auto-deploys on push to main
```

Required Vercel secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

### GitHub Actions Required Secrets

| Secret | Used for |
|--------|---------|
| `RAILWAY_TOKEN` | Backend deploy |
| `BACKEND_URL` | Health check after deploy |
| `VERCEL_TOKEN` | Frontend deploy |
| `VERCEL_ORG_ID` | Vercel project ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |
| `MONITOR_WEBHOOK_URL` | Deploy success/failure Slack notification |

---

## Environment Variables Reference

### Backend

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUPABASE_URL` | ✅ | — | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | ✅ | — | Service-role key (bypasses RLS) |
| `JWT_SECRET` | ✅ | dev-secret | JWT signing key |
| `MIDTRANS_SERVER_KEY` | ✅ | — | Midtrans server key |
| `MIDTRANS_CLIENT_KEY` | ✅ | — | Midtrans client key |
| `FRONTEND_URL` | ✅ | localhost:3000 | Frontend URL for CORS + email links |
| `ALLOWED_ORIGINS` | — | localhost:3000 | Comma-separated CORS whitelist |
| `PORT` | — | 4000 | HTTP/WS port |
| `NODE_ENV` | — | development | `production` enables stricter security |
| `REDIS_URL` | — | disabled | Redis for Socket.IO horizontal scaling |
| `SMTP_HOST` | — | — | SMTP server for verification/reset emails |
| `SMTP_PORT` | — | 587 | SMTP port |
| `SMTP_USER` | — | — | SMTP username |
| `SMTP_PASS` | — | — | SMTP password |
| `SMTP_SECURE` | — | false | TLS (true for port 465) |
| `ADMIN_EMAIL` | — | — | Admin alert recipient |
| `MONITOR_WEBHOOK_URL` | — | — | Slack/Discord webhook for SLA alerts |
| `LOG_LEVEL` | — | info (prod) | Winston log level |

### Frontend

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_BACKEND_URL` | ✅ | Backend API URL |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | ✅ | Midtrans client key for Snap payment UI |

---

## Running Tests

```bash
cd chess-backend

# All tests
npm test

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

Test files in `chess-backend/tests/`:
- `elo.test.js` — FIDE ELO calculation (26 assertions)
- `anticheat.test.js` — All 5 anti-cheat layers (20 assertions)
- `auth.test.js` — Register, login, verify, reset password (22 assertions)
- `wallet.test.js` — Deposit/withdraw validation (14 assertions)
- `socket.test.js` — Socket.IO matchmaking, game room, lobby (8 scenarios)

---

## API Endpoints

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Register new user |
| POST | `/api/auth/login` | — | Login |
| POST | `/api/auth/guest` | — | Create guest account |
| GET | `/api/auth/me` | ✅ | Get current user |
| PATCH | `/api/auth/profile` | ✅ | Update profile |
| POST | `/api/auth/change-password` | ✅ | Change password |
| POST | `/api/auth/verify-email` | — | Verify email with token |
| POST | `/api/auth/forgot-password` | — | Request password reset email |
| POST | `/api/auth/reset-password` | — | Reset password with token |

### Wallet
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/wallet/balance` | ✅ | Get balance |
| GET | `/api/wallet/transactions` | ✅ | Transaction history |
| POST | `/api/wallet/deposit` | ✅ | Create Midtrans deposit (Snap) |
| POST | `/api/wallet/withdraw` | ✅ | Request bank withdrawal |

### Game
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/game/:id` | ✅ | Get game details |
| GET | `/api/game/:id/pgn` | ✅ | Download PGN file |
| GET | `/api/game/:id/replay` | — | Get replay data |
| GET | `/api/game/history/me` | ✅ | My game history |
| GET | `/api/game/elo-history/me` | ✅ | My ELO history |

### Tournament
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/tournament` | — | List tournaments |
| GET | `/api/tournament/:id` | — | Tournament details |
| GET | `/api/tournament/:id/players` | — | Player standings |
| GET | `/api/tournament/:id/standings` | — | Standings with prizes |
| POST | `/api/tournament` | ✅ Admin | Create tournament |
| POST | `/api/tournament/:id/register` | ✅ | Register for tournament |
| POST | `/api/tournament/:id/finish` | ✅ Admin | Finish + distribute prizes |
| PATCH | `/api/tournament/:id/score` | ✅ Admin | Update player score |

### Other
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/leaderboard` | — | Top players (filter: `?timeControl=bullet\|blitz\|rapid`) |
| GET | `/api/games/active` | — | Active games for spectator browser |
| GET | `/health` | — | Server health check |

---

## Socket.IO Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `queue:join` | `{ timeControl, stakes, color }` | Join matchmaking queue |
| `queue:leave` | `{ stakes }` | Leave queue (unlocks funds) |
| `game:join` | `{ gameId }` | Join game room |
| `game:move` | `{ gameId, from, to, promotion, moveToken }` | Make a move |
| `game:resign` | `{ gameId }` | Resign |
| `game:draw-offer` | `{ gameId }` | Offer draw |
| `game:draw-accept` | `{ gameId }` | Accept draw |
| `game:draw-decline` | `{ gameId }` | Decline draw |
| `game:spectate` | `{ gameId }` | Join as spectator |
| `game:unspectate` | `{ gameId }` | Leave spectator |
| `lobby:chat` | `{ message }` | Send lobby chat message |

### Server → Client
| Event | Description |
|-------|-------------|
| `queue:joined` | Successfully joined queue |
| `queue:left` | Left queue |
| `game:found` | Match found — contains game + player data |
| `game:state` | Full game state on join (includes initial move token) |
| `game:move` | A move was made |
| `game:clock` | Clock tick (1/second) |
| `game:over` | Game ended |
| `move:invalid` | Your move was rejected |
| `move:token` | New move token after successful move |
| `spectate:state` | Full state for new spectators |
| `spectator:count` | Updated spectator count |
| `opponent:connected/disconnected/reconnected` | Opponent connection events |
| `wallet:update` | Real-time balance update after game |
| `user:stats` | ELO update after game |
| `notification:new` | New notification |
| `account:status` | Account flagged/suspended notification |
| `lobby:online` | Updated online count + active games |
| `lobby:chat` | Lobby chat message |

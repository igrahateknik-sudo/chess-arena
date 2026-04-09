# ─────────────────────────────────────────────────────────────────
#  Chess Arena Backend — Production Dockerfile
#  Compatible: Railway · Render · Fly.io · any Docker host
#  Deps stage: node:20-alpine (lean npm install)
#  Runner stage: node:20-slim (Debian — apt has stockfish)
# ─────────────────────────────────────────────────────────────────

# ── Stage 1: install node_modules ────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifest terlebih dulu (layer cache)
COPY package*.json ./

# Install production dependencies only (no native build tools needed)
RUN npm ci --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install stockfish + pm2 dependencies
RUN apt-get update \
 && apt-get install -y --no-install-recommends stockfish \
 && rm -rf /var/lib/apt/lists/*

# Install PM2 globally for process clustering
RUN npm install -g pm2@latest

# Non-root user untuk security
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs chess

# Copy node_modules dari stage deps
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=chess:nodejs . .

USER chess

# Railway/Render/Fly.io inject PORT via env var
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-4000}/health || exit 1

# PM2 cluster mode: uses all available CPUs, graceful reload, auto-restart
CMD ["pm2-runtime", "ecosystem.config.js", "--env", "production"]

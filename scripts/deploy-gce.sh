#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Chess Arena — Deploy to GCE
#  Run from your LOCAL machine to push code + restart backend on GCE
#  Usage: bash scripts/deploy-gce.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

GCE_USER="ubuntu"                 # ← change to your GCE username
GCE_IP="YOUR_GCE_IP"              # ← change to your GCE external IP
GCE_DIR="/opt/chess-arena"
SSH_KEY="~/.ssh/id_rsa"           # ← your SSH key path

echo "🚀 Deploying Chess Arena backend to GCE..."

# ── 1. Sync backend code (exclude node_modules and secrets) ─────────────────
echo "[1/3] Syncing backend code..."
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude '.env.production' \
  --exclude 'nginx/ssl' \
  --exclude 'nginx/logs' \
  -e "ssh -i $SSH_KEY" \
  ./chess-backend/ \
  "$GCE_USER@$GCE_IP:$GCE_DIR/chess-backend/"

# ── 2. Rebuild Docker image and restart ─────────────────────────────────────
echo "[2/3] Rebuilding and restarting..."
ssh -i "$SSH_KEY" "$GCE_USER@$GCE_IP" << 'ENDSSH'
  cd /opt/chess-arena/chess-backend
  docker compose -f docker-compose.gce.yml build --no-cache backend
  docker compose -f docker-compose.gce.yml up -d --remove-orphans
  echo "Container status:"
  docker compose -f docker-compose.gce.yml ps
ENDSSH

# ── 3. Health check ──────────────────────────────────────────────────────────
echo "[3/3] Checking health..."
sleep 5
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$GCE_IP/health" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ Backend healthy (HTTP $HTTP_STATUS)"
else
  echo "⚠  Health check returned HTTP $HTTP_STATUS (may still be starting)"
fi

echo ""
echo "✅ Deployment complete!"
echo "   Logs: ssh $GCE_USER@$GCE_IP 'docker compose -f $GCE_DIR/chess-backend/docker-compose.gce.yml logs -f backend'"

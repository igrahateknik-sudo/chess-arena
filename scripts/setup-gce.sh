#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Chess Arena — Google Compute Engine Setup Script
#  Run this ONCE on a fresh GCE VM (Ubuntu 22.04 LTS recommended)
#  VM spec: e2-standard-2 (2 vCPU, 8 GB RAM) minimum
#           e2-standard-4 (4 vCPU, 16 GB RAM) recommended for 500+ concurrent
#
#  Usage: bash setup-gce.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e
DOMAIN="YOUR_DOMAIN"   # e.g. api.chessarena.id  ← CHANGE THIS
EMAIL="YOUR_EMAIL"     # for Let's Encrypt cert  ← CHANGE THIS

echo "═══════════════════════════════════════════════════════════"
echo "  Chess Arena — GCE Setup"
echo "═══════════════════════════════════════════════════════════"

# ── 1. System update ─────────────────────────────────────────────────────────
echo "[1/8] Updating system..."
sudo apt-get update -qq && sudo apt-get upgrade -y -qq

# ── 2. Install Docker ────────────────────────────────────────────────────────
echo "[2/8] Installing Docker..."
sudo apt-get install -y -qq ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -qq
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable docker
sudo usermod -aG docker $USER

# ── 3. Install certbot (Let's Encrypt SSL) ───────────────────────────────────
echo "[3/8] Installing certbot..."
sudo apt-get install -y -qq certbot
sudo certbot certonly --standalone -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive
sudo cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /opt/chess-arena/chess-backend/nginx/ssl/
sudo cp /etc/letsencrypt/live/$DOMAIN/privkey.pem   /opt/chess-arena/chess-backend/nginx/ssl/
# Auto-renew
echo "0 3 * * * root certbot renew --quiet --post-hook 'docker compose -f /opt/chess-arena/chess-backend/docker-compose.gce.yml exec nginx nginx -s reload'" \
  | sudo tee /etc/cron.d/certbot-renew

# ── 4. Clone / copy repo ─────────────────────────────────────────────────────
echo "[4/8] Setting up app directory..."
sudo mkdir -p /opt/chess-arena
sudo chown $USER:$USER /opt/chess-arena
# Option A: git clone (if repo is on GitHub)
# git clone https://github.com/YOUR_ORG/chess-arena.git /opt/chess-arena
# Option B: rsync from local (run from your machine):
#   rsync -avz --exclude node_modules ./chess-backend/ user@GCE_IP:/opt/chess-arena/chess-backend/

# ── 5. Firewall (GCE already has firewall rules, this is OS-level) ───────────
echo "[5/8] Configuring firewall..."
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP → redirects to HTTPS
sudo ufw allow 443/tcp   # HTTPS
sudo ufw --force enable

# ── 6. Create .env.production ────────────────────────────────────────────────
echo "[6/8] Setting up environment..."
if [ ! -f /opt/chess-arena/chess-backend/.env.production ]; then
  cp /opt/chess-arena/chess-backend/.env.production.example /opt/chess-arena/chess-backend/.env.production
  echo ""
  echo "⚠  IMPORTANT: Edit .env.production before starting:"
  echo "   nano /opt/chess-arena/chess-backend/.env.production"
  echo ""
fi

# ── 7. Sysctl tuning for high concurrency ───────────────────────────────────
echo "[7/8] Tuning kernel for high traffic..."
sudo tee /etc/sysctl.d/99-chess-arena.conf > /dev/null <<EOF
# Max open files
fs.file-max = 2097152
# TCP tuning for high concurrency
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.core.netdev_max_backlog = 16384
EOF
sudo sysctl --system

# ── 8. Systemd service for auto-restart ─────────────────────────────────────
echo "[8/8] Creating systemd service..."
sudo tee /etc/systemd/system/chess-arena.service > /dev/null <<EOF
[Unit]
Description=Chess Arena Backend Stack
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/chess-arena/chess-backend
ExecStart=/usr/bin/docker compose -f docker-compose.gce.yml up -d --remove-orphans
ExecStop=/usr/bin/docker compose -f docker-compose.gce.yml down
Restart=on-failure
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable chess-arena

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Edit /opt/chess-arena/chess-backend/.env.production"
echo "  2. Update nginx/nginx.conf: replace YOUR_DOMAIN with $DOMAIN"
echo "  3. Start: sudo systemctl start chess-arena"
echo "  4. Logs:  docker compose -f /opt/chess-arena/chess-backend/docker-compose.gce.yml logs -f"
echo "═══════════════════════════════════════════════════════════"

#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Chess Arena — Railway Deployment Script
#  Jalankan setelah: railway login
#  Usage: chmod +x deploy-railway.sh && ./deploy-railway.sh
# ═══════════════════════════════════════════════════════════════

set -e  # Exit on any error

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${BLUE}♔ Chess Arena — Railway Deployment${NC}"
echo "═══════════════════════════════════════"

# 1. Cek Railway auth
echo -e "\n${YELLOW}[1/5] Checking Railway auth...${NC}"
if ! railway whoami &>/dev/null; then
  echo -e "${RED}❌ Not logged in. Run: railway login${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Logged in as: $(railway whoami)${NC}"

# 2. Init project jika belum ada
echo -e "\n${YELLOW}[2/5] Setting up Railway project...${NC}"
if [ ! -f ".railway/config.json" ]; then
  echo "Creating new Railway project 'chess-arena-backend'..."
  railway init --name chess-arena-backend
else
  echo -e "${GREEN}✅ Existing project found${NC}"
fi

# 3. Set environment variables dari .env.railway
echo -e "\n${YELLOW}[3/5] Setting environment variables...${NC}"

# Pastikan .env.railway ada
if [ ! -f ".env.railway" ]; then
  echo -e "${RED}❌ .env.railway not found. Run: vercel env pull .env.railway${NC}"
  exit 1
fi

# Extract dan set hanya variabel yang diperlukan
while IFS='=' read -r key value; do
  # Skip komentar, baris kosong, dan variabel Vercel-specific
  [[ "$key" =~ ^#.*$ ]] && continue
  [[ -z "$key" ]] && continue
  [[ "$key" =~ ^VERCEL ]] && continue
  [[ "$key" =~ ^NX_ ]] && continue
  [[ "$key" =~ ^TURBO_ ]] && continue

  # Bersihkan newline literal \n dari value
  clean_value=$(echo "$value" | tr -d '"' | sed 's/\\n$//')

  echo "  Setting $key..."
  railway variables set "$key=$clean_value" 2>/dev/null || true
done < .env.railway

# Set Railway-specific vars
railway variables set PORT=4000 2>/dev/null || true
railway variables set ADMIN_EMAILS="admin@chess-arena.com" 2>/dev/null || true

echo -e "${GREEN}✅ Environment variables configured${NC}"

# 4. Deploy
echo -e "\n${YELLOW}[4/5] Deploying to Railway...${NC}"
railway up --detach
echo -e "${GREEN}✅ Deployment triggered${NC}"

# 5. Get URL
echo -e "\n${YELLOW}[5/5] Getting deployment URL...${NC}"
sleep 5
railway status 2>/dev/null || echo "Check dashboard for URL"

echo -e "\n${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Deploy complete!${NC}"
echo ""
echo -e "Next steps:"
echo -e "  1. Update NEXT_PUBLIC_SOCKET_URL in chess-app Vercel env vars"
echo -e "     to your Railway URL (e.g. https://chess-arena-backend.up.railway.app)"
echo -e "  2. Update ALLOWED_ORIGINS in Railway vars to match"
echo -e "  3. Re-deploy frontend: cd ../chess-app && vercel --prod --yes"
echo -e "  4. Run Supabase migration v3 + v4 SQL"
echo ""
echo -e "${BLUE}Railway Dashboard: https://railway.app/dashboard${NC}"

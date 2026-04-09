# Migrasi Railway → Google Compute Engine

## Kenapa GCE?

| Railway | GCE e2-standard-2 |
|---------|-------------------|
| Auto-scale (cold starts) | Always-on, 0 cold start |
| Max 512 MB RAM free tier | 8 GB RAM |
| Shared network | Dedicated bandwidth |
| WebSocket sometimes drops | Full WebSocket support |
| ~$20/bulan untuk traffic tinggi | ~$35/bulan, predictable |

Untuk 100–500 concurrent players dengan WebSocket rooms, **GCE always-on jauh lebih stabil**.

---

## Step-by-step Migration

### 1. Buat GCE VM

Di Google Cloud Console atau gcloud CLI:

```bash
# Buka: https://console.cloud.google.com/compute/instances
# Create instance dengan:
#   Machine type: e2-standard-2 (2 vCPU, 8 GB) — bisa upgrade nanti
#   OS: Ubuntu 22.04 LTS
#   Boot disk: 50 GB SSD
#   Firewall: Allow HTTP, HTTPS traffic ✓
#   Region: asia-southeast2 (Jakarta) — untuk latency rendah dari Indonesia
```

Catat **External IP** setelah VM ready.

### 2. Setup domain

Pointing domain/subdomain ke GCE IP:
```
api.yourdomain.com  →  A record  →  GCE_EXTERNAL_IP
```

### 3. Upload repo ke GCE

```bash
# Dari lokal kamu:
rsync -avz --exclude node_modules ./chess-backend/ ubuntu@GCE_IP:/opt/chess-arena/chess-backend/
```

### 4. Jalankan setup script

```bash
ssh ubuntu@GCE_IP
bash /opt/chess-arena/scripts/setup-gce.sh
```

Script ini otomatis:
- Install Docker + Docker Compose
- Install certbot + SSL certificate
- Tuning kernel untuk high concurrency
- Buat systemd service (auto-restart)

### 5. Isi environment variables

```bash
nano /opt/chess-arena/chess-backend/.env.production
# Isi semua value dari .env.production.example
```

### 6. Update nginx domain

```bash
nano /opt/chess-arena/chess-backend/nginx/nginx.conf
# Ganti YOUR_DOMAIN dengan domain kamu
```

### 7. Start!

```bash
sudo systemctl start chess-arena
# Check logs:
docker compose -f /opt/chess-arena/chess-backend/docker-compose.gce.yml logs -f
```

### 8. Update frontend env

Di Vercel dashboard, update environment variable:
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_WS_URL=https://api.yourdomain.com
```

---

## Deploy updates (setelah migrasi)

```bash
# Dari lokal:
bash scripts/deploy-gce.sh
```

---

## Scaling untuk 500+ concurrent

Konfigurasi yang sudah disiapkan di `docker-compose.gce.yml`:
- Redis maxmemory 256 MB
- Nginx 4096 worker connections per worker
- OS sysctl: somaxconn=65535, tcp_max_syn_backlog=65535
- Backend resource limits: 2 CPU, 1 GB RAM

Kalau traffic > 500 concurrent:
1. Upgrade ke **e2-standard-4** (4 vCPU, 16 GB) di GCE console
2. Scale backend: `docker compose up --scale backend=2 -d` (butuh load balancer tambahan)
3. Atau gunakan **Cloud Run** untuk auto-scaling yang lebih fleksibel

---

## Play Store (Trusted Web Activity)

App sudah dikonfigurasi sebagai PWA. Untuk upload ke Play Store:

### Install Bubblewrap

```bash
npm install -g @bubblewrap/cli
```

### Generate APK

```bash
bubblewrap init --manifest https://yourdomain.com/manifest.json
bubblewrap build
```

File APK ada di `./app-release-signed.apk`.

### Sebelum submit ke Play Store:

1. Buat [Google Play Console account](https://play.google.com/console) (~$25 one-time)
2. Buat keystore: `keytool -genkey -v -keystore chess-arena.jks -alias chess-arena -keyalg RSA -keysize 2048 -validity 10000`
3. Sign APK dengan keystore tersebut
4. Upload ke Play Console → Internal Testing → lakukan review
5. **Digital Asset Links** — tambahkan file ini ke domain kamu:

```json
// https://yourdomain.com/.well-known/assetlinks.json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.yourdomain.chessarena",
    "sha256_cert_fingerprints": ["YOUR_KEYSTORE_SHA256_HERE"]
  }
}]
```

---

## Monitoring setelah live

```bash
# Real-time logs
docker compose -f docker-compose.gce.yml logs -f backend

# Container stats (CPU/RAM usage)
docker stats

# Redis info
docker compose -f docker-compose.gce.yml exec redis redis-cli info stats
```

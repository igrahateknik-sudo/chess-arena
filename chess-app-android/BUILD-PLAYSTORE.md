# Chess Arena — Build APK untuk Play Store

## Prasyarat (install sekali)

```bash
# 1. Java JDK 17 (wajib untuk Android build)
brew install openjdk@17
echo 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# 2. Android SDK Command Line Tools
#    Download dari: https://developer.android.com/studio#command-tools
#    Atau install via Android Studio

# 3. Bubblewrap sudah terinstall ✓
#    npm install -g @bubblewrap/cli
```

## Step 1 — Setup Android SDK (sekali saja)

```bash
# Setelah install Android Studio atau Command Line Tools:
bubblewrap doctor
# Bubblewrap akan otomatis setup Android SDK jika belum ada
```

## Step 2 — Buat Keystore (sekali saja — SIMPAN BAIK-BAIK!)

```bash
cd chess-app-android

keytool -genkey -v \
  -keystore android.keystore \
  -alias chess-arena \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass YOUR_STORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD \
  -dname "CN=Chess Arena, OU=Mobile, O=Chess Arena, L=Jakarta, S=DKI, C=ID"
```

⚠️ **PENTING**: Backup `android.keystore`. Kalau hilang, tidak bisa update app di Play Store!

## Step 3 — Dapatkan SHA-256 Fingerprint

```bash
keytool -list -v -keystore android.keystore -alias chess-arena -storepass YOUR_STORE_PASSWORD \
  | grep "SHA256:"
```

Copy nilai SHA-256, lalu update file ini di frontend:
`chess-app/public/.well-known/assetlinks.json`

Ganti `REPLACE_WITH_YOUR_KEYSTORE_SHA256_FINGERPRINT` dengan nilai SHA-256 tadi.

## Step 4 — Build APK

```bash
cd chess-app-android

# Init (hanya perlu sekali — baca twa-manifest.json)
bubblewrap init --manifest https://chess-app-two-kappa.vercel.app/manifest.json

# Build APK
bubblewrap build
```

Output: `./app-release-signed.apk` dan `./app-release-bundle.aab`

Gunakan `.aab` untuk Play Store (lebih kecil), `.apk` untuk testing langsung.

## Step 5 — Test di Android

```bash
# Install ke device/emulator:
adb install app-release-signed.apk
```

## Step 6 — Upload ke Play Store

1. Buka https://play.google.com/console
2. **Create app** → Game → Free
3. Isi semua metadata (deskripsi, kategori, rating konten)
4. Upload `app-release-bundle.aab` ke **Internal Testing**
5. Tambahkan email tester → tunggu ~1 jam untuk tersedia
6. Kalau sudah oke, **Promote to Production**

## Update App (versi baru)

Setiap update cukup:
1. Naikkan `appVersionCode` di `twa-manifest.json`
2. Jalankan `bubblewrap build`
3. Upload `.aab` baru ke Play Console

Tidak perlu ubah kode Android — perubahan web otomatis masuk karena TWA load dari URL live!

## Kapasitas Concurrent Users

| GCE Instance | vCPU | RAM | PM2 Workers | Est. Concurrent Matches |
|---|---|---|---|---|
| e2-standard-2 | 2 | 8 GB | 2 | ~300 |
| e2-standard-4 | 4 | 16 GB | 4 | ~700 |
| e2-standard-8 | 8 | 32 GB | 8 | ~1500+ |
| n2-standard-8 | 8 | 32 GB | 8 | ~2000+ |

Untuk ribuan match stabil: gunakan **e2-standard-4** minimum, **e2-standard-8** ideal.
Redis di VM yang sama sudah cukup sampai ~3000 concurrent dengan config yang sudah diset.

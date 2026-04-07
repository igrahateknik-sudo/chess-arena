# Security Smoke Checklist

Gunakan checklist ini sebelum rilis production untuk validasi cepat keamanan + fairness sistem.

## Auth & Session

- [ ] **JWT expiry**
  - Login, ambil token, decode `exp`, pastikan sesuai `JWT_EXPIRES` (default `12h`).
  - Pakai token expired ke endpoint auth, pastikan balas `401`.

- [ ] **Password-change invalidates old token**
  - Login di device A, simpan token.
  - Ganti password di device B.
  - Pakai token lama ke `/api/auth/me` dan koneksi Socket.IO, pastikan ditolak.

- [ ] **No auth persistence di browser storage**
  - Login lalu cek `localStorage` key `chess-arena-store`.
  - Pastikan tidak ada `token`, `user`, `isAuthenticated`.
  - Refresh page: user diminta login ulang (expected behavior).

## Admin Security

- [ ] **Admin step-up aktif**
  - Set `ADMIN_STEPUP_SECRET` di backend.
  - Request admin mutasi (`POST/PUT/PATCH/DELETE`) tanpa header `x-admin-stepup` => `403`.
  - Request dengan header benar => berhasil.

## Abuse & Brute-force Controls

- [ ] **Redis-backed login lockout**
  - Lakukan login salah berulang hingga lockout.
  - Coba ulang dari tab/device lain, lockout tetap berlaku dalam window.
  - Setelah durasi lockout lewat, login valid kembali normal.

- [ ] **Anti-abort cooldown**
  - Trigger no-contest berulang sesuai threshold.
  - Coba antre lagi, harus ditolak dengan pesan cooldown.
  - Setelah cooldown selesai, antre normal.

## Realtime Fairness & Stability

- [ ] **Matchmaking race safety**
  - Dua akun join queue hampir bersamaan beberapa kali.
  - Pastikan tidak ada double `game:found` untuk akun yang sama.

- [ ] **No-contest fairness**
  - Start game lalu disconnect sebelum ada move.
  - Pastikan game `cancelled`, ELO change `0`, W/L/D tidak berubah, stake kembali.

- [ ] **Spectator isolation**
  - Satu player + satu spectator masuk.
  - Pastikan timer belum berjalan sampai dua player asli join.

- [ ] **Explicit game leave flow**
  - Saat klik Exit dari online game, emit `game:leave`.
  - Pastikan reconnect-window logic berjalan normal dan game tidak orphan.

## Deploy Reliability

- [ ] **Deploy verification**
  - Push perubahan kecil.
  - Pastikan workflow `Deploy — Production` hijau dan tidak gagal karena health check timeout cepat.

## Catatan

- Jalankan checklist ini minimal untuk environment staging sebelum promote ke production.
- Simpan bukti hasil (screenshot/log) untuk audit rilis.

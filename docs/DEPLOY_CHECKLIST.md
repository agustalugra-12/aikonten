# Deploy Checklist — KontenPilot (2 Server)

KontenPilot berjalan di **2 server terpisah** dengan SQLite lokal masing-masing. Tidak ada replikasi/sync otomatis — drift kode/skema/config antar server adalah risiko struktural. Checklist ini wajib diikuti tiap deploy.

## Pre-deploy (lokal)

- [ ] `npm run lint` — 0 error.
- [ ] `npx tsc --noEmit` — PASS.
- [ ] `npm run build` — PASS.
- [ ] Jalankan semua verify script:
  - `npx tsx scripts/verify-locks.ts`
  - `npx tsx scripts/verify-agency-summary.ts`
  - `npx tsx scripts/verify-content-brief.ts`
  - `npx tsx scripts/verify-content-intelligence.ts`
  - `npx tsx scripts/verify-context-firewall.ts`
  - `npx tsx scripts/verify-experiment-tier.ts`
  - `npx tsx scripts/verify-platform-fit-score.ts`
  - `npx tsx scripts/verify-platform-normalization.ts`
  - `npx tsx scripts/verify-retention-intelligence.ts`
- [ ] Pastikan migrasi Drizzle baru (kalau ada) sudah di-generate dan konsisten:
  - `npx drizzle-kit check`
- [ ] Catat commit SHA yang akan di-deploy:
  - `git rev-parse HEAD`

## Deploy per server

Ulangi langkah-langkah di bawah **untuk server A dan server B**.

1. [ ] SSH ke server.
2. [ ] Pull kode ke commit SHA yang sama:
   - `git fetch origin && git checkout <sha>`
3. [ ] Install dependency:
   - `npm ci`
4. [ ] Sync environment variables (`.env.local`):
   - Bandingkan dengan template/last-known-good.
   - **Hanya variable yang MEMANG boleh beda antar server boleh diubah** (mis. nama server lokal); semua secret/API key/cron key/agency key harus sama.
5. [ ] Jalankan migrasi database:
   - `npx drizzle-kit migrate`
6. [ ] Build:
   - `npm run build`
7. [ ] Restart service:
   - `sudo systemctl restart kontenpilot`
   - `sudo systemctl status kontenpilot` — pastikan active & log start bersih.

## Post-deploy (drift check)

- [ ] Tunggu kedua server up.
- [ ] Jalankan drift check:
  - `npx tsx scripts/check-deployment.ts https://server-a.example.com https://server-b.example.com`
  - atau `DEPLOYMENT_TARGETS="https://a,https://b" npx tsx scripts/check-deployment.ts`
- [ ] Pastikan output:
  - Kedua server return commit SHA yang sama dengan local HEAD.
  - Tidak ada `DRIFT` atau `FAIL`.
- [ ] Cek endpoint `/api/version` langsung (opsional):
  - `curl https://server-a.example.com/api/version`
  - `curl https://server-b.example.com/api/version`

## Kalau terjadi drift

1. Jangan lanjutkan deploy fitur baru.
2. Identifikasi penyebab: kode belum pull, migrasi belum jalan, config beda, atau service belum restart.
3. Perbaiki server yang ketinggalan sampai `check-deployment.ts` menunjukkan `SEMUA SERVER MATCH`.

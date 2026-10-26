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
- [ ] (Opsional, inspeksi saja) `npx drizzle-kit check` / `generate`:
  - ⚠️ Histori migrasi Drizzle repo ini TERTINGGAL jauh dari `schema.ts` (drift lama; schema diterapkan via ALTER manual, bukan file migrasi — ini **belum** diperbaiki). `check`/`generate` boleh utk inspeksi, tapi output `generate` membungkus skema yg SUDAH diterapkan → **JANGAN** di-`migrate` ke DB mana pun. Perubahan schema → lihat langkah "Deploy per server" #5 (ALTER manual ber-guard).
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
5. [ ] Terapkan perubahan schema DB (kalau ada) — **JANGAN `npx drizzle-kit migrate`**:
   - ⚠️ `drizzle-kit migrate` TIDAK AMAN di server ini (jurnal `__drizzle_migrations` rusak + histori snapshot tertinggal jauh dari `schema.ts`; migrate akan gagal / meng-recreate tabel). Lihat `RUNBOOK_SAAS.md` → "Prosedur perubahan schema DB".
   - Perubahan schema diterapkan via **ALTER MANUAL ber-guard** (cek `PRAGMA` dulu, idempoten).
   - Kolom `brands.brand_kit` (Phase 2 Font Studio): `npx tsx scripts/add-brand-kit-column.ts` — idempoten, aman diulang, skip kalau kolom sudah ada. (DB prod EXISTING sudah punya kolom ini → helper akan "SKIP".)
   - Perubahan schema lain: tulis ALTER ber-guard serupa (PRAGMA cek dulu).
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

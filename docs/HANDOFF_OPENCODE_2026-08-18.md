# Handoff to OpenCode — 2026-08-18

Ditulis oleh Claude Code, untuk koordinasi kerja paralel (Agus jalankan OpenCode + Claude
Code bersamaan di repo ini). Tujuan file ini: supaya OpenCode bisa lanjut kerja tanpa perlu
re-explore ulang apa yang sudah terjadi di sesi Claude Code sebelumnya.

## Status saat ini (per commit `8c67f40`)

- **Fase 1 "Content Diversity Engine"** (Claude Code, commit `3a55181`..`b0eea48`): SELESAI &
  terverifikasi lokal — hookType/structureTemplate classification, weighted anti-repetition
  pick, bounded regen. `npx tsc --noEmit` bersih, `scripts/verify-content-diversity.ts`
  18/18 PASS. Spec: `docs/superpowers/specs/2026-08-14-content-diversity-engine-design.md`.
  Plan: `docs/superpowers/plans/2026-08-14-content-diversity-engine-plan.md`.
- **TIER 0-3** (OpenCode/Codex, commit `858221b`..`8c67f40`): lock verification, Content
  Type Taxonomy, Usage Tracking, Advanced Diversity Strategy — di luar konteks langsung
  Claude Code, tidak diaudit ulang di sini, diasumsikan sudah OpenCode verifikasi sendiri
  (lihat `docs/TIER_0_VERIFICATION_REPORT.md`).

## Yang BELUM jalan ke produksi (penting)

1. **Server lama (lokal, ini VPS Pelangi)**: kode sampai TIER 3 sudah ke-build lokal
   (`npm run build` sukses), tapi **service belum di-restart** — sengaja ditahan Claude
   Code karena OpenCode masih aktif kerja bersamaan, supaya tidak race. Restart kapan pun
   OpenCode/Agus bilang sudah aman (titik henti yang stabil).
2. **Server baru** (`admin@202.10.41.72`, VPS agustapstudio.com, service
   `kontenpilot-backend.service`) — **UPDATE 2026-08-19, dikerjakan Claude Code**:
   - [x] DB di-backup dulu (`data/kontenpilot.db.backup-20260818210227`).
   - [x] Konfirmasi `npx drizzle-kit migrate` MEMANG rusak di server ini juga (jurnal
     `__drizzle_migrations` ada 3 baris `id NULL`, sama persis pola server lama) - dipakai
     fallback DDL langsung via `sqlite3` CLI, BUKAN drizzle-kit migrate.
   - [x] Migrasi 0031 diterapkan manual: `CREATE TABLE content_types` + `ALTER TABLE
     projects ADD content_type_id` - dijalankan LANGSUNG oleh Agus sendiri (aksi ini kena
     block permission classifier Claude Code 2x berturut, diserahkan ke Agus lewat `!`).
     Terverifikasi: `sqlite3 data/kontenpilot.db '.tables'` menampilkan `content_types`.
   - [x] File TIER 1-3 di-scp ke server baru (path sama semua, `/home/admin/kontenpilot-ai/`):
     `src/db/schema.ts`, `src/lib/ai/contentTypeUtils.ts`, `src/lib/ai/contentVariety.ts`,
     `src/lib/ai/generateContent.ts`, `src/lib/pipeline/processProject.ts`,
     `scripts/seed-content-types.ts`, `drizzle/0031_nappy_bloodaxe.sql`,
     `drizzle/meta/0031_snapshot.json`, `drizzle/meta/_journal.json`. (Tidak ikut disync:
     `scripts/verify-locks.spec.ts` - file test, tidak dibutuhkan di server produksi.)
   - [x] Seed 16 system content type: `PATH=/home/admin/.nvm/versions/node/v20.20.2/bin:$PATH
     npx tsx scripts/seed-content-types.ts` - **16/16 INSERTED**, 0 skipped, 0 error.
   - [x] Build: `npm run build` sukses, "Compiled successfully", nol error di log
     (`/tmp/kontenpilot_build.log` di server itu, belum dibersihkan - aman dihapus kapan saja).
   - [x] **RESTART SERVICE - SELESAI 2026-08-19 00:25 WIB** (dijalankan manual oleh Agus,
     `sudo` butuh password interaktif jadi tidak bisa dieksekusi Claude Code langsung).
     Terverifikasi: `ActiveEnterTimestamp` baru (`Wed 2026-08-19 00:25:29 WIB`), PID baru
     (`1614518`, beda dari PID lama `174954`), `systemctl is-active` = `active`, `curl
     localhost:3100` = `HTTP 307` (redirect normal, bukan error). Log startup (journalctl)
     TIDAK sempat dicek langsung (user `admin` tidak masuk grup `adm`/`systemd-journal`,
     butuh sudo interaktif juga) - tapi build sebelumnya sudah "Compiled successfully" nol
     error & service tidak crash-loop (masih `active` beberapa menit setelah restart), jadi
     dianggap cukup sehat. **Verifikasi susulan dicoba 2026-08-19**: 3 project terbaru di
     DB semua `content_type_id` masih NULL - TAPI setelah timestamp-nya dikonversi,
     ketiganya dari 18 Agustus 06:16 WIB, JAUH SEBELUM restart (19 Agustus 00:25 WIB).
     Jadi ini BUKAN tanda gagal, cuma belum ada project baru yang diproses SETELAH
     restart (cron `kontenpilot-auto-generate-animalstory.timer` berikutnya baru jam
     02:15 WIB). **Masih perlu dicek ulang setelah project pertama pasca-restart selesai
     diproses** - kalau project itu JUGA NULL, baru layak dicurigai ada masalah nyata
     (kemungkinan classification GPT gagal fail-soft ke NULL, atau field tidak
     ke-passing ke insert). Command cek: `sqlite3 data/kontenpilot.db "SELECT id,
     content_type_id, created_at FROM projects ORDER BY created_at DESC LIMIT 3;"`.
   - **KESIMPULAN: Server baru sekarang SUDAH SEJAJAR dengan server lama untuk TIER 1-3**
     (kode + DB + seed + restart semua selesai). Item "#2 - server baru belum full re-sync"
     di HANDOFF ini **SELESAI**.
   - **Catatan umum yang masih berlaku**: `npx drizzle-kit migrate` TERBUKTI RUSAK di KEDUA
     server (jurnal `__drizzle_migrations` `id: NULL`) - migrasi berikutnya JANGAN asumsikan
     drizzle-kit migrate jalan bersih, langsung siapkan fallback SQL manual dari awal.
     `npx`/`npm`/`node` TIDAK ada di PATH default sesi SSH non-interaktif user `admin` di
     server baru - selalu prefix `PATH=/home/admin/.nvm/versions/node/v20.20.2/bin:$PATH`
     (lihat isi `systemctl cat kontenpilot-backend.service` utk PATH persis yang dipakai
     service asli, supaya konsisten).

## Roadmap sisanya (PRD asli "AI Content Intelligence v2.0", di luar TIER 1-3)

Dari diskusi awal dgn Agus, PRD 58-bagian dipecah 4 fase besar — Fase 1 (di atas) selesai,
TIER 1-3 OpenCode kemungkinan sudah masuk sebagian ke Fase 1 lanjutan/Fase 4. Yang JELAS
belum tersentuh sama sekali oleh siapa pun:

- **Competitor Intelligence + SWOT** (PRD §5-8): 100% belum ada infrastrukturnya
  (`grep -rli "competitor\|swot" src/` = nol hasil, dicek 2026-08-14). **BLOCKED pada
  keputusan bisnis Agus**: cara ambil data kompetitor (API berbayar recurring cost vs input
  manual staf vs AI browsing kualitas rendah) — JANGAN pilih sendiri tanpa tanya Agus dulu,
  ini sama kelasnya dgn "integrasi pihak ketiga baru" yg biasanya perlu izin eksplisit.
- **Analytics/Reporting penuh** (PRD §25-34): `performanceLearning.ts` + `analytics` table
  SUDAH ada fondasi nyata (sync views/engagement per-post dari Buffer GraphQL, sudah
  dipakai feedback ke scoring ide harian) — TAPI belum ada weekly/monthly report generation,
  PDF export, atau dashboard. Verifikasi dulu metrik apa yg BENAR-BENAR tersedia dari Buffer
  GraphQL `Post.metrics` (saves/retention-per-detik dkk mungkin tidak ada) sebelum janji ke
  Agus fitur itu bisa dibangun.

## Kalau ada pertanyaan silang antara OpenCode & Claude Code

Tulis catatan balik di file ini atau `docs/_audit_kontenpilot_raw.md` (working artifact,
sudah ada, tidak di-commit) — biar sesi berikutnya (Claude Code atau OpenCode) bisa lanjut
tanpa tanya ulang ke Agus soal hal yg sudah pernah diputuskan.

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
2. **Server baru** (`admin@202.10.41.72`, VPS agustapstudio.com): baru punya file Fase 1
   Claude Code dari 2026-08-14 (`schema.ts`, `contentVariety.ts`, `generateContent.ts`,
   `processProject.ts`) — **belum punya TIER 1-3 sama sekali**. DB kolom `hook_type`/
   `structure_template` sudah ada di server itu (sudah di-ALTER TABLE langsung), tapi kolom
   utk TIER 1-3 (content_types dkk) kemungkinan belum. Perlu full re-sync (scp semua file
   yg berubah sejak `3a55181`) + migrasi kolom baru + build + restart, BUKAN cuma restart
   dgn file lama.
   - **Catatan penting**: `npx drizzle-kit migrate` TERBUKTI RUSAK di server lama (journal
     `__drizzle_migrations` punya `id: NULL` di semua baris, migrate gagal diam-diam exit 1
     tanpa pesan error). Kemungkinan besar sama di server baru. Jangan asumsikan migrate
     jalan bersih — cek dulu, siapkan fallback ALTER TABLE langsung via `better-sqlite3`
     kalau perlu (lihat detail workaround di plan doc Task 1 Step 3).
   - Kredensial SSH sudah pernah dipakai sesi ini (lihat
     `docs/superpowers/plans/2026-08-14-render-tree-merge.md` utk pola lengkap
     scp/build/restart), tidak diulang di sini.

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

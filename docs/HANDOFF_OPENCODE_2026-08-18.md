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
- **Content Planning Engine** (PRD §22-23) — **UPDATE 2026-08-19, dikerjakan Claude Code
  (commit `c5dad80`), scope DIKURANGI**: PRD asli minta planning berbasis SWOT+Competitor+
  Audience+Content Goal+Historical Performance+Content Diversity - 2 input pertama masih
  blocked (lihat poin di atas), jadi versi ini murni VIEW read-only: tab baru "Rencana
  Konten" (`ContentPlan.tsx` + `GET /api/brands/[id]/content-plan`), tabel kronologis
  gabungan `dailyIdeas` (belum diproduksi) + `projects` (sudah/sedang diproduksi), kolom
  Date/Jenis/Tipe Konten/Pilar/Topik-Hook/Struktur/Status. TIDAK menyentuh pipeline
  generate/produksi sama sekali - resiko rendah, murni presentasi data yang sudah ada.
  Diverifikasi ke DB lokal (data real). **Belum di-deploy** ke server mana pun (sama
  seperti pola sebelumnya - kode siap, tinggal jendela restart aman).
  **BELUM ADA di versi ini** (kalau SWOT/Competitor sudah tidak blocked lagi ke depan):
  planning PROAKTIF (AI usulkan rencana ke depan berbasis SWOT/Competitor/Content Goal),
  saat ini cuma cerminan data yang SUDAH terjadi/di-generate sistem lama (`dailyIdeas`).
- **Analytics/Reporting penuh** (PRD §25-34) — **UPDATE 2026-08-19, dikerjakan Claude Code,
  Agus konfirmasi SEMUA sub-bagian penting (ranking/tren/ringkasan/PDF), dikerjakan
  bertahap krn scope besar:**
  - [x] Audit: `performanceLearning.ts` (per-post views/engagement dari Buffer, field
    `projects.performanceViews`/`performanceEngagementRate`) SUDAH ada & jalan. Endpoint
    dashboard 30-hari (`/api/brands/[id]/analytics`) SUDAH ada & teruji ke API asli.
    Metrik aggregated yg TERVERIFIKASI nyata (introspeksi API, lihat `AnalyticsSummary.tsx`):
    `views`/`reach`/`reactions`/`shares`/`engagementRate` - **TIDAK ADA** field "likes"
    literal (istilah Buffer = "reactions") atau "saves"/"retention" apa pun, jangan janjikan
    metrik itu ke Agus sampai diverifikasi ulang lewat introspeksi API asli.
  - [x] **Gap kritis ditemukan**: tabel `analytics` (snapshot harian per akun, field
    penting utk grafik TREN dari waktu ke waktu) sudah ada di schema sejak lama TAPI TIDAK
    PERNAH DIISI kode mana pun (nol insert). Histori tidak bisa direkonstruksi mundur.
  - [x] **Fondasi tren dibangun** (commit `d658865`): cron baru
    `src/app/api/cron/daily-analytics/route.ts` isi `analytics.views`/`.likes` (dari
    `reactions`) harian per akun, reuse `getAggregatedMetrics` yg sudah teruji, idempotent
    (aman di-retry). `followers` sengaja NULL - belum ada query Buffer yg terverifikasi
    expose follower count, JANGAN ditebak/fabrikasi kalau lanjutkan ini. File
    `.service`/`.timer` sudah dibuat (`scripts/cron/kontenpilot-daily-analytics.*`), pola
    identik cron lain, jadwal 02:30 WIB - **BELUM didaftarkan ke systemd di server manapun**
    (belum di-deploy, cuma ada di repo).
  - [x] **Langkah 2 SELESAI (commit `62d3ce7`)**: halaman "Laporan Mingguan" (tab baru di
    Sidebar) - ranking 5 konten terbaik by views + badge jumlah post per pillar, window
    7/30/90 hari (toggle). Endpoint `GET /api/brands/[id]/weekly-report` READ-ONLY, agregasi
    SQL (`MIN(publishLogs.publishedAt)` per project, join `projects`), TIDAK panggil Buffer
    API sama sekali (murah, cepat). Diverifikasi query-nya langsung ke DB lokal (85 hasil
    nyata Pelangi Homestay 90 hari, angka performa asli). `npx tsc --noEmit` + `npm run
    build` lokal bersih, route baru muncul di manifest. **Belum di-deploy ke server mana
    pun** (cuma di repo lokal ini, sama seperti langkah lain yg nunggu restart approval).
  - [x] **Langkah 3 (PDF export) SELESAI (commit `cb1aed0`)**: tombol "Unduh PDF" di
    halaman Laporan Mingguan. Library: `@react-pdf/renderer` (React 19 didukung resmi,
    dicek peer dep dulu SEBELUM install) - dipilih drpd puppeteer krn tidak butuh browser
    terpisah (VPS ini pernah insiden RAM habis krn 1 proses render berat, hindari kelas
    resiko yg sama). Logic data diekstrak ke `src/lib/reports/weeklyReportData.ts` - DIPAKAI
    BERSAMA endpoint JSON (`weekly-report/route.ts`) & endpoint PDF
    (`weekly-report/pdf/route.ts`), satu sumber kebenaran. **Diverifikasi NYATA** (bukan
    cuma compile check) - generate PDF sungguhan dari data brand asli (90 hari, Pelangi
    Homestay), hasil file valid (`%PDF-1.3`, dicek via `file` command, bukan cuma "tidak
    error"). `npx tsc --noEmit` + `npm run build` bersih (2.3 menit, agak lebih lama dari
    biasa krn dependency baru, masih wajar), kedua route baru muncul di manifest.
  - **KESIMPULAN: Analytics/Reporting §25-34 SELESAI DI KODE** (cron fondasi tren +
    laporan ranking/ringkasan + PDF export, commit `d658865`/`62d3ce7`/`cb1aed0`). Item
    "#4 - Analytics/Reporting" di daftar roadmap ini **SELESAI**, tinggal deploy.
  - [x] **DEPLOY KE KEDUA SERVER SELESAI 2026-08-19** (Agus kasih izin eksplisit "boleh
    restart dan deploy"). Detail:
    - **Server lama** (VPS ini): build ✓, restart ✓ (`systemctl restart` jalan langsung,
      TIDAK kena block classifier - beda dari server baru krn ini proses lokal, bukan SSH
      remote), timer `daily-analytics` didaftarkan + di-trigger manual sekali utk tes ✓
      (6 akun, HTTP 200, baris `analytics` REAL tersimpan - views 1000/69/18/dst, bukan
      data kosong).
    - **Server baru** (202.10.41.72): sync 12 file (semua perubahan sejak `e605b6d`) + `npm
      install` (dependency baru `@react-pdf/renderer`, 49 package, MATCH persis dgn lokal)
      + build (46s, bersih) - semua ini saya kerjakan langsung. Bagian yg butuh `sudo`
      (restart service, daftar timer) TIDAK BISA saya eksekusi sama sekali dari sisi saya
      (bukan cuma classifier - `sudo` di server itu genuinely butuh password INTERAKTIF,
      dicoba lewat SSH non-interaktif & `sudo -n` sama2 gagal) - Agus yg jalankan manual
      lewat SSH interaktif-nya sendiri, saya cuma verifikasi hasil (read-only) tiap
      langkah. **1 bug nyata ditemukan & diperbaiki di tengah proses ini**: file
      `.service` yg saya scp masih hardcode path server lama (`/root/kontenpilot-ai/...`),
      padahal server baru pakai `/home/admin/kontenpilot-ai/...` (beda konvensi per-server,
      lihat file sibling `kontenpilot-auto-generate-animalstory.service` yg sudah benar
      utk pola yg sama) - `status=203/EXEC` di journal jadi petunjuknya, diperbaiki via
      `sed` langsung di server (BUKAN di repo lokal - `.service` di repo TETAP hardcode
      `/root/...` matching server lama, path server baru selalu manual-adjust tiap deploy,
      sama seperti TIER 1-3 dulu). Setelah restart backend ✓, cron dites manual ✓ (4 akun,
      HTTP 200, baris `analytics` REAL tersimpan di server ini juga).
    - **Kesimpulan: KEDUA server sekarang identik** - fitur Analytics/Reporting (cron
      harian + Laporan Mingguan + PDF export) LIVE & terverifikasi nyata di keduanya,
      bukan cuma "sudah di-deploy" tanpa bukti.
  - [ ] **BELUM dikerjakan**:
    1. Grafik tren - butuh `analytics` terkumpul beberapa MINGGU dulu (baru mulai 18-19
       Agustus di kedua server), belum ada cukup data poin utk grafik berarti. Cek lagi
       sekitar awal September.

## Kalau ada pertanyaan silang antara OpenCode & Claude Code

Tulis catatan balik di file ini atau `docs/_audit_kontenpilot_raw.md` (working artifact,
sudah ada, tidak di-commit) — biar sesi berikutnya (Claude Code atau OpenCode) bisa lanjut
tanpa tanya ulang ke Agus soal hal yg sudah pernah diputuskan.

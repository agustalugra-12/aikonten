# Handoff to OpenCode — 2026-08-18 (terus diupdate, baca dari atas dulu)

Ditulis oleh Claude Code, untuk koordinasi kerja paralel (Agus jalankan OpenCode + Claude
Code bersamaan di repo ini). Tujuan file ini: supaya OpenCode bisa lanjut kerja tanpa perlu
re-explore ulang apa yang sudah terjadi di sesi Claude Code sebelumnya.

## STATUS TERKINI (2026-08-19, baca ini dulu sebelum bagian lain di bawah - itu histori)

**Semua fitur P0 yang tidak blocked sudah SELESAI DI KODE & sebagian besar SUDAH
TERVERIFIKASI (bukan cuma compile check) - lihat detail lengkap tiap fitur di bagian
"Roadmap sisanya" & "Competitor Intelligence + SWOT" di bawah.** Ringkasan commit
terbaru (urut lama→baru): `d658865` (cron analytics) → `62d3ce7` (Laporan Mingguan) →
`cb1aed0` (PDF export) → `c5dad80` (Content Planning Engine) → `999bd96` (Laporan
Bulanan) → `e4264c2` (Competitor Intelligence + SWOT, migrasi 0032).

**PENDING PALING PENTING**: Competitor Intelligence (`e4264c2`) BELUM di-deploy ke
server manapun - butuh migrasi DB (tabel `competitors` baru, pola sama TIER1: backup,
DDL manual via better-sqlite3/sqlite3 CLI di tiap server, BUKAN `drizzle-kit migrate`
yang tetap rusak di kedua server) + sync file + build + restart. Agus bilang "nanti
deploy bersamaan" - artinya TUNGGU sampai ada fitur lain yg juga siap deploy, jangan
deploy sendirian dulu kecuali diminta eksplisit.

**SEDANG DIKERJAKAN saat handoff ini ditulis (belum ada kode baru, baru investigasi)**:
melengkapi §38 Content Similarity Score (lihat "Audit 5 Bagian PRD" di bawah) - skor
similarity SUDAH dihitung & disimpan (`contentSimilarity.ts`), TAPI belum ada 4 tingkat
threshold (Safe/Review/High/Regenerate) yang diminta PRD. **Keputusan desain yang sudah
diambil** (jangan diubah tanpa alasan kuat): jangan auto-regenerate (resiko biaya AI
tak terkendali + butuh ubah signature `generateCaptionAndHashtags`/
`generateCaptionForImages` di 2 tempat, invasif) - cukup TAMBAH label threshold sbg
badge yang staf lihat di dashboard (kandidat: `ContentPlan.tsx` atau `ProjectList.tsx`),
staf yang putuskan regenerate manual via tombol "Coba Lagi" YANG SUDAH ADA
(`ProjectList.tsx` → `POST /api/projects/[id]/retry`) - TIDAK perlu bikin mekanisme
regenerate baru, tinggal SAMBUNGKAN visibility ke yang sudah ada. **Belum ada kode
untuk ini ditulis** - baru sampai tahap keputusan desain + verifikasi tombol retry
sudah ada.

**Next steps kalau lanjutkan ini**:
1. Tulis fungsi threshold di `contentSimilarity.ts` (pure function, gampang unit-test):
   `getSimilarityTier(score: number): "safe" | "review" | "high" | "regenerate"` sesuai
   tabel PRD §38 (0-40/41-60/61-75/>75).
2. Tampilkan badge di UI tempat yang paling masuk akal staf lihat draft (cek
   `DraftReview.tsx` dulu - lebih relevan dari `ContentPlan.tsx` krn itu tempat staf
   review SEBELUM publish, sesuai maksud PRD "Sebelum publish").
3. Setelah itu, roadmap P1 berikutnya per urutan di bagian "Roadmap P1/P2" di bawah:
   Content Fatigue Detection (§39) - kandidat berikutnya, datanya sudah ada semua.

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
  Diverifikasi ke DB lokal (data real). **DEPLOY SELESAI 2026-08-19** ke KEDUA server -
  lihat catatan deploy gabungan di bawah (Laporan Bulanan).
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
    identik cron lain, jadwal 02:30 WIB - **DIDAFTARKAN & AKTIF di KEDUA server sejak
    2026-08-19**, sudah dites manual (bukan cuma nunggu jadwal) & terverifikasi baris
    `analytics` real tersimpan di kedua server.
  - [x] **Langkah 2 SELESAI (commit `62d3ce7`)**: halaman "Laporan Mingguan" (tab baru di
    Sidebar) - ranking 5 konten terbaik by views + badge jumlah post per pillar, window
    7/30/90 hari (toggle). Endpoint `GET /api/brands/[id]/weekly-report` READ-ONLY, agregasi
    SQL (`MIN(publishLogs.publishedAt)` per project, join `projects`), TIDAK panggil Buffer
    API sama sekali (murah, cepat). Diverifikasi query-nya langsung ke DB lokal (85 hasil
    nyata Pelangi Homestay 90 hari, angka performa asli). `npx tsc --noEmit` + `npm run
    build` lokal bersih, route baru muncul di manifest. **DEPLOY SELESAI** ke kedua server.
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
  - [x] **Laporan Bulanan SELESAI (commit `999bd96`)**: executive summary (total konten/
    views/engagement, best/worst content) + breakdown performa 4 dimensi (Content Type/
    Pillar/Hook/Structure - 5 dimensi lain dari PRD §32 [CTA/Footage/Posting Time/
    Platform] TIDAK ADA sumber data terverifikasi, sengaja tidak difabrikasi) +
    rekomendasi strategis dari AI (Continue/Reduce/Stop/Increase/Test, gpt-4.1-mini,
    fail-soft kalau JSON invalid, guard data-terlalu-sedikit). PDF export juga ada. Tab
    "Laporan" sekarang toggle Mingguan/Bulanan. **Diverifikasi ke API OpenAI ASLI**
    (bukan simulasi) - 85 konten/10557 views nyata, AI hasilkan rekomendasi menyebut
    nama pilar asli dari data. `§34 Monthly SWOT Update` TIDAK dibangun (blocked, sama
    alasan Competitor Intelligence). **Belum di-cache** (biaya nyata tiap load AI, tapi
    laporan bulanan wajar jarang dibuka - tambahkan cache pola `socialAccounts.
    cachedMetrics` KALAU ke depan terbukti sering dibuka & biaya jadi masalah nyata,
    jangan bangun cache preemptif tanpa bukti perlu).
  - [x] **DEPLOY GABUNGAN SELESAI 2026-08-19** (Content Planning Engine + Laporan Bulanan
    sekaligus, satu jendela restart, Agus konfirmasi "ya lanjut"): build lokal ✓, restart
    server lama ✓ (`systemctl restart` jalan langsung, timestamp baru 07:27:28 WIB, nol
    error di journal selain 1 warning cgroup-cleanup systemd yang tidak relevan), sync 10
    file ke server baru ✓ (tidak ada dependency baru kali ini - `@react-pdf/renderer`
    sudah ter-install dari deploy sebelumnya), build server baru ✓ (27s), restart server
    baru ✓ (dijalankan manual Agus via sudo interaktif, sama pola seperti sebelumnya -
    timestamp baru 07:42:01 WIB). **Verifikasi akhir**: `curl` langsung ke
    `/api/brands/x/content-plan` & `/api/brands/x/monthly-report` di KEDUA server
    menghasilkan `HTTP 401` (Unauthorized) BUKAN `404` - membuktikan route benar-benar
    dikenali server (butuh login, sesuai desain), bukan cuma "restart tidak error".
    **KESIMPULAN: kedua server sekarang identik & 100% up to date** dengan semua fitur
    yang dikerjakan sesi ini (Analytics/Reporting penuh + Content Planning Engine).
  - [ ] **BELUM dikerjakan**:
    1. Grafik tren - butuh `analytics` terkumpul beberapa MINGGU dulu (baru mulai 18-19
       Agustus di kedua server), belum ada cukup data poin utk grafik berarti. Cek lagi
       sekitar awal September.

## Competitor Intelligence + SWOT — SELESAI 2026-08-19 (TIDAK LAGI BLOCKED)

Agus putuskan eksplisit: **"kerjakan tanpa API berbayar"**. Commit `e4264c2`. Desain:
TIDAK ADA scraping/API kompetitor apa pun (sengaja, bukan gap) - staf input observasi
kompetitor MANUAL (nama + catatan bebas) via tab baru "Kompetitor", AI (gpt-4.1-mini,
biaya sudah ada, bukan baru) HANYA menganalisis catatan itu + performa brand sendiri
jadi Content Gap + SWOT (tombol "Generate Analisis", on-demand bukan auto). Diverifikasi
NYATA dgn insert data test realistis - AI benar menganalisis catatan asli, tidak
mengarang. Tabel baru `competitors` (migrasi 0032). **Belum di-deploy ke server manapun**
- butuh migrasi DB lagi di kedua server (pola sama spt TIER1: backup dulu, DDL manual via
better-sqlite3/sqlite3 CLI krn drizzle-kit migrate tetap rusak, BUKAN drizzle-kit migrate).

**Sekarang UNBLOCKED, bisa dikerjakan kalau ada waktu**: Content Planning Engine versi
PENUH (§22, sekarang bisa pakai SWOT+Competitor sbg input planning, bukan cuma view
read-only) & Monthly SWOT Update (§34, "Previous SWOT + New Performance + New Competitor
Data + Market Changes = Updated SWOT" - fondasinya [generateCompetitorIntelligence] sudah
ada, tinggal jadikan bagian dari alur bulanan + simpan histori SWOT dari waktu ke waktu).

## Audit 5 Bagian PRD yang Belum Jelas (2026-08-19, diminta Agus "biar PRD lengkap")

Dicek langsung ke kode (grep+Read, bukan tebakan):

- **§37 Pre-Publishing Quality Control**: ❌ TIDAK ADA - nol file/mekanisme.
- **§38 Content Similarity Score**: ✅ SELESAI - `lib/ai/similarityTier.ts` sudah punya
  `getSimilarityTier()` (safe 0-40/review 41-60/high 61-75/regenerate >75) + label/warna,
  di-re-export dari `contentSimilarity.ts`. Badge sudah tampil di `DraftReview.tsx`
  (bukan ContentPlan.tsx — tempat staf review SEBELUM publish, sesuai PRD). Tombol
  "Coba Lagi" (`POST /api/projects/[id]/retry`) sudah ada di `ProjectList.tsx`, tinggal
  sambungkan visibility-nya kalau mau. Commit `ef6d0c1` + `3d785e9`.
- **§39 Content Fatigue Detection**: ✅ SELESAI - `lib/ai/contentFatigue.ts` (trend
  detection: increasing/decreasing/stable, rekomendasi continue/reduce/rotate berdasarkan
  usage count + trend) + `FatigueSummary.tsx` (UI). Commit `ef6d0c1`.
- **§41 Caption Intelligence** (variasi GAYA caption - storytelling/educational/short/
  dst): ❌ TIDAK ADA sbg mekanisme rotasi eksplisit - caption digenerate kontekstual dari
  skrip (lihat `generateCaptionAndHashtags`), tapi tidak ada tracking/avoid gaya yang
  overused (beda dari TIER 1-3 yang SUDAH ada rotasi utk structureTemplate/hookType/
  contentType - caption STYLE belum punya rotasi serupa).
- **§42 Hashtag Intelligence**: ✅ SELESAI - `lib/ai/hashtagTracking.ts` (tracking
  frekuensi hashtag dari 20 project terakhir, threshold overused >=3x, avoidance prompt
  builder). Sudah diintegrasikan ke `processProject.ts` (line 485: `avoidHashtags`) +
  `prePublishQC.ts` (line 66). Commit `1144b5c`.
- **§43 Platform Adaptation** (gaya konten beda per platform - TikTok fast-pacing vs
  YouTube retention dst): ❌ TIDAK ADA. **PERINGATAN false-positive**: ada file
  `lib/policy/platformPolicy.ts` yang NAMANYA mirip tapi ISINYA beda total - itu soal
  compliance monetisasi YouTube ("YouTube Content & Monetization Safety System"), BUKAN
  adaptasi gaya konten per platform. Jangan salah kira sudah ada krn nama file mirip.

## Roadmap P1/P2 (PRD §56) - urutan rekomendasi kalau lanjut

Semua ini BUKAN blocked, cuma belum dikerjakan (fokus P0 dulu). Urutan disarankan
(termudah/paling murah dulu, bukan urutan PRD):
1. ~~**Content Similarity threshold+regenerate**~~ ✅ SELESAI (§38, commit `ef6d0c1` + `3d785e9`)
2. ~~**Content Fatigue Detection**~~ ✅ SELESAI (§39, commit `ef6d0c1`)
3. ~~**Hashtag repetition tracking**~~ ✅ SELESAI (§42, commit `1144b5c`)
4. ~~**Content Intelligence Score**~~ ✅ SELESAI (§36, commit `1144b5c`, bareng §42) - entri
   ini sempat basi di handoff, sudah dicek ulang 2026-08-20, memang sudah di-commit.
5. **Caption style rotation §41**: ✅ SELESAI (commit `396dbf0`, 10 caption styles, tracked in regeneration loop)
6. **Platform Adaptation §43**: ✅ SELESAI (commit `95fb0ee`, TikTok/Instagram/Facebook/YouTube unique caption style)
7. **Pre-Publishing QC §37**: ✅ SELESAI (commit `396dbf0`, POST /api/projects/[id] quality checks)
8. **Trend Adaptation §40**: ✅ SELESAI (2026-08-19) - `lib/ai/trendAdaptation.ts`
   (single GPT call, zero cost baru, infer tren dari data performa brand sendiri +
   catatan kompetitor) + API route `POST /api/brands/[id]/trend-adaptation`. Pola sama
   dgn competitorAnalysis.ts. 2-5 tren signifikan dgn relevanceScore/competitorUsage/
   audienceRelevance/recommendation. Belum ada UI dashboard (tombol ON-DEMAND via API).
9. **BELUM DIKERJAKAN** (masih P1, prioritas berikutnya kalau lanjut roadmap): AI
   Recommendation Center §45, Content Experiment Engine §46, Client Reporting mode §48 -
   baca PRD detail dulu sebelum mulai masing-masing.

## P2 - status per 2026-08-20 (PENGECUALIAN urutan prioritas, baca catatan di bawah)

PRD §56 sendiri bilang P2 (predictive performance/A-B testing otomatis/audience
segmentation/predictive trend/cross-brand learning) PALING RENDAH prioritas, jangan
dikerjakan sebelum semua P1 selesai - poin 9 di atas (§45/§46/§48) masih belum dikerjakan
saat 2 item P2 di bawah ini dibuat. Ini BUKAN keputusan baru buat balik ubah urutan
prioritas P1/P2 secara umum - Agus SUDAH cek dan pilih "sudah kadung dibikin, benerin &
pakai" utk 2 item spesifik ini (2026-08-20), bukan izin buat lanjut P2 lain di luar 2 ini.
Sesi berikutnya (OpenCode atau Claude Code manapun): balik ke urutan P1 poin 9 di atas dulu
kalau mau lanjut, JANGAN mulai item P2 lain tanpa tanya Agus lagi.

- **Audience Segmentation §P2**: ✅ SELESAI 2026-08-20 - `lib/ai/audienceSegmentation.ts` +
  `POST /api/brands/[id]/audience-segmentation`. Awalnya dibuat sesi OpenCode model
  gratisan (`nemotron-3.5-lightning-free`) yang lalu macet/loop rusak (lihat catatan commit)
  - ditemukan 2 bug nyata saat verifikasi: (1) bahasa Indonesia ngaco di 2 tempat
    ("seklarserasi"->"segmentasi", "Pawalai"->"Pertahankan"); (2) BUG SERIUS - prompt-nya
    TIDAK PERNAH minta output JSON (beda dari pola baku competitorAnalysis.ts/
    trendAdaptation.ts), jadi GPT balas prosa bebas, JSON.parse selalu gagal, fitur diam-diam
    SELALU balas kosong sejak awal dibuat - sudah diperbaiki + diverifikasi live pakai
    gpt-4.1-mini sungguhan (bukan cuma tsc). Verifikasi: `npx tsx scripts/verify-audience-segmentation.ts`.
  Belum ada UI dashboard (tombol ON-DEMAND via API, sama seperti Trend Adaptation §40).
- **Predictive Performance §P2**: ✅ SELESAI 2026-08-20 - `lib/ai/predictivePerformance.ts`
  + `POST /api/brands/[id]/predictive-performance`. Bug nyata saat verifikasi: trend
  naik/turun dihitung dari slice array kategori (byPillar+byContentType+byHookType+
  byStructure, sudah diurutkan berdasar avgViews) yang DIKIRA representasi waktu - jadi
  yang dibandingkan sebenarnya "kategori performa tertinggi" vs "sisanya", BUKAN paruh
  awal vs akhir window sungguhan. Diperbaiki dgn fungsi baru `getPerformanceTrendSplit()`
  di `lib/reports/monthlyReportData.ts` yang query `firstPublishedAt` ASLI dari
  `publish_logs`. Diverifikasi thd 3 brand asli (Pelangi/laundry in bali/Animal Story & Co)
  + `npx tsx scripts/verify-predictive-performance.ts` (8 skenario deterministik).

## Kalau ada pertanyaan silang antara OpenCode & Claude Code

Tulis catatan balik di file ini atau `docs/_audit_kontenpilot_raw.md` (working artifact,
sudah ada, tidak di-commit) — biar sesi berikutnya (Claude Code atau OpenCode) bisa lanjut
tanpa tanya ulang ke Agus soal hal yg sudah pernah diputuskan.

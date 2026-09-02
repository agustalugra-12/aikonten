# RISK_MAP — Agustap Studio Content Intelligence & Faceless Extension

Dibuat 2026-09-02, PRD §46 (dokumen ke-4 dari 4, terakhir). Titik rawan
nyata di implementasi ini + mitigasi yang SUDAH ada di kode (bukan usulan).

## 1. Brand isolation bocor (risiko tertinggi kalau terjadi)

**Skenario gagal**: brand lain (Pelangi/Harmoni/Laundry in Bali/Animal
Story) tiba-tiba dapat perilaku Agustap (benchmark/inspiration ikut
mempengaruhi script mereka).

**Mitigasi**: guard tunggal `isAgustapExtensionActive(brand.knowledgeSite)`
di baris PERTAMA `applyAgustapStrategyIfActive()` — bukan di caller, supaya
tidak bisa "lupa dipanggil". Diverifikasi eksplisit di
`verify-agustap-pipeline-wiring.ts` (test 1 & 2): brand `knowledgeSite`
apa pun selain `agustap_studio`, walau flag ON, HARUS balikin `script`
persis sama, TANPA query DB tambahan.

**Sisa risiko**: kalau suatu saat brand LAIN sengaja diberi
`knowledgeSite="agustap_studio"` oleh kesalahan input manual di UI Brand
Settings — guard ini tidak mendeteksi "niat", cuma nilai kolom. Mitigasi
praktis: `knowledgeSite` diisi lewat form terbatas, bukan free text bebas
role admin biasa (belum diverifikasi eksplisit di sesi ini — cek manual
kalau brand baru ditambahkan).

## 2. Feature flag lupa dimatikan / default berubah

**Skenario gagal**: `.env` production ke-reset (redeploy tanpa
`.env.example` → `.env` proper) dan flag balik ke unset/false secara tidak
sengaja mematikan fitur diam-diam, ATAU sebaliknya seseorang set flag=true
di server yang bukan untuk Agustap.

**Mitigasi**: default eksplisit OFF di kode (`isAgustapContentIntelligenceEnabled()`
return `false` kalau env var tidak ada ATAU bukan string `"true"` persis),
bukan default ON yang butuh override eksplisit. Kombinasi flag+brand guard
berarti flag=true di server manapun TETAP no-op untuk brand non-Agustap.

## 3. Biaya OpenAI tak terduga (relevance filter + originality)

**Skenario gagal**: tiap generate konten Agustap memicu N panggilan LLM
(1 per benchmark aktif) alih-alih 1 panggilan gabungan → biaya membengkak
tanpa disadari.

**Mitigasi**: `buildAgustapContentStrategy()` SATU panggilan LLM per
generate, model sendiri yang self-report `benchmarksUsed[]` dari SEMUA
benchmark aktif yang dikirim di prompt — bukan N panggilan terpisah.
Diverifikasi live (lihat riwayat sesi): 6 benchmark aktif, 1 panggilan API,
hasil correctly pilih 1 yang relevan. Zero-benchmark & zero-inspiration
→ return awal SEBELUM panggil LLM sama sekali (`verify-agustap-pipeline-wiring`
test 3 & 4).

## 4. Kegagalan modul Agustap merusak generate konten brand itu sendiri

**Skenario gagal**: `buildAgustapContentStrategy()` timeout/error (rate
limit OpenAI, JSON parse gagal, dst) → seluruh proses generate konten
Agustap Studio ikut gagal/nge-hang, padahal brand lain jalannya lancar.

**Mitigasi**: seluruh badan `applyAgustapStrategyIfActive()` (query DB +
panggilan LLM) dibungkus try/catch tunggal — gagal apa pun → fallback ke
`script` ASLI (hasil `suggestContentIdeas`/`scriptOverride`), `console.error`,
TIDAK throw. Proses lanjut seperti brand tanpa Agustap. Terverifikasi nyata
saat testing awal: `OPENAI_API_KEY` tidak ter-load di skrip `tsx` standalone
→ modul gagal → fallback jalan otomatis, konten tetap ter-generate (§43
proven, bukan cuma diklaim).

## 5. Data Creator Benchmark tidak real (risiko kualitas, bukan risiko teknis)

**Status saat ini**: 6 profil `CREATOR_BENCHMARK_V1_SEED` ditulis manual
dari pengetahuan umum publik, DITANDAI eksplisit
`"[SEED MANUAL - belum dianalisis dari konten asli]"` di `benchmarkProfile`
tersimpan — bukan disamarkan seolah hasil analisis nyata.

**Risiko**: kalau flag dianggap "selesai" dan tag SEED MANUAL ini
terlewat/tidak dibaca staf lain, output generate konten bisa terasa
generic (profil dari pengetahuan umum, bukan pola asli creator).

**Mitigasi**: `analyzeInspiration()` + `buildCreatorBenchmarkFromContentUrls()`
sudah siap menerima URL asli kapan pun tersedia — mengganti seed TIDAK
butuh perubahan kode, cuma re-run dengan URL nyata. Constraint teknis:
fetch HTTP polos (tanpa headless browser) — realistis hanya berhasil untuk
sumber statis (blog/newsletter/artikel/transcript YouTube terindeks web),
BUKAN video TikTok/Reels/Shorts langsung (JS-rendered, akan balik
`SOURCE_UNAVAILABLE`, bukan gagal diam-diam).

## 6. Originality check tidak dijalankan di titik akhir (quality gate)

**Keputusan desain**: `contentTransformer.ts` (embed+cosine+retry)
dipanggil sebagai bagian dari `generationStrategy.ts`, BUKAN diulang lagi
di `prePublishQC.ts`. Alasan: mendeteksi originality SEBELUM render
(ffmpeg/TTS berbayar) lebih murah daripada mendeteksi SESUDAH render lalu
menolak publish. Trade-off: kalau `generationStrategy.ts` di masa depan
diubah/di-bypass (mis. seseorang memanggil `processProject()` langsung
dengan script custom yang tidak lewat `applyAgustapStrategyIfActive`),
tidak ada originality check kedua sebagai jaring pengaman.

**Sisa risiko diterima secara sadar**: rendah, karena SEMUA jalur generate
konten (cron `auto-generate` + tombol manual) sama-sama lewat
`runAutoContent()` → `applyAgustapStrategyIfActive()`. Tidak ada jalur lain
yang membuat project baru untuk brand Agustap saat ini.

## Ringkasan tingkat risiko

| # | Risiko | Kemungkinan | Dampak kalau terjadi | Status mitigasi |
|---|---|---|---|---|
| 1 | Brand isolation bocor | Rendah | Tinggi | Guard + test eksplisit ✅ |
| 2 | Flag salah setting | Rendah | Sedang | Default OFF + double-guard ✅ |
| 3 | Biaya API membengkak | Rendah | Sedang | 1 call/generate, early-return ✅ |
| 4 | Modul gagal → generate brand ikut gagal | Sedang (dependensi API eksternal) | Sedang | try/catch fallback, proven ✅ |
| 5 | Data benchmark tidak real | Tinggi (belum diganti) | Rendah-Sedang | Ditandai jelas, siap diganti kapan saja ⏳ |
| 6 | Originality check tidak redundant di akhir | Rendah | Rendah | Diterima sadar, semua jalur sudah tercakup ✅ |

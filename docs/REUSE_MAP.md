# REUSE_MAP — Agustap Studio Content Intelligence & Faceless Extension

Dibuat 2026-09-01 sesuai PRD "Agustap Studio Content Intelligence & Faceless
Extension" §46 (Phase 0 — Audit, wajib sebelum coding apa pun). Tujuan dokumen
ini: memetakan SETIAP kemampuan yang PRD minta terhadap kode yang SUDAH ADA di
KontenPilot, supaya implementasi berikutnya (OpenCode atau siapa pun) tidak
membangun sistem duplikat — sesuai §40 "NO DUPLICATION RULE" PRD ini sendiri.

Setiap baris di bawah dicek LANGSUNG ke kode (baca file, bukan asumsi dari
nama). Status:

- ✅ **REUSE** — sudah ada, dipakai apa adanya (tinggal isi data/konfigurasi
  untuk Agustap Studio).
- 🟡 **EXTEND** — sudah ada mekanisme yang konsepnya sama/dekat, tapi perlu
  ditambah kemampuan (bukan dibuat ulang dari nol).
- 🔴 **BUILD NEW** — genuinely tidak ada, PRD §6 memang benar ini baru.

---

## Ringkasan

Dari 6 modul yang PRD §6 sebut "genuinely new", **cuma 1 (Inspiration
Analyzer) yang benar-benar baru**. 3 modul sudah 100% tersedia (Pexels
Adapter/Visual Planner, Faceless — karena pipeline video KontenPilot memang
tidak pernah punya kapabilitas talking head sama sekali), dan 2 modul (Content
Transformer, Creator Benchmark) punya mekanisme yang SANGAT dekat secara
konsep, tinggal di-extend menerima sumber input baru (URL/reference eksternal),
bukan dibangun sebagai sistem terpisah.

| Modul PRD (§6) | Status | Evidence |
|---|---|---|
| A. Creator Benchmark Engine | 🟡 EXTEND | `src/lib/ai/competitorAnalysis.ts` + tabel `competitors` |
| B. Inspiration Analyzer | 🔴 BUILD NEW | — |
| C. Content Transformer | 🟡 EXTEND | `src/lib/ai/trendAdaptation.ts` |
| D. Agustap Content DNA | ✅ REUSE | kolom `brands` (lihat tabel di bawah) |
| E. Faceless Strategy Layer | ✅ REUSE (default) | seluruh `src/lib/render/` — tidak pernah ada mode talking head |
| F. Pexels Visual Planner | ✅ REUSE | `deriveBrollKeywords.ts`, `clipSelect.ts`, `matchFootageBank.ts`, `describeFootage.ts` |

---

## Detail per kebutuhan PRD

### §9 Agustap Content DNA → ✅ REUSE, kolom `brands` sudah ada

Tidak perlu tabel `agustap_content_metadata` baru (PRD §37 melarang bikin
tabel baru sebelum membuktikan schema existing tidak cukup — ini kasusnya).
Kolom yang relevan **sudah ada** di tabel `brands`:

```
niche, target_audience, positioning, tone_of_voice, content_pillars,
preferred_topics, prohibited_topics, content_boundaries,
edu_entertainment_ratio, cta_style
```

Aksi: isi kolom-kolom ini untuk brand Agustap Studio (`brand_P2BjJgQoG8hL` di
server render, "agustap studio"), bukan bikin struktur data baru.

### §10-11 Content Pillars & Content Mix → ✅ REUSE / 🟡 EXTEND

`content_pillars` sudah ada di `brands` — isi dengan 8 pillar PRD §10
langsung. `edu_entertainment_ratio` sudah ada tapi cuma 2 sumbu (edukasi vs
entertainment) — PRD §11 minta 3 sumbu (Reach/Authority/Conversion). Perlu
kolom TAMBAHAN kecil (mis. `content_mix_ratio` JSON `{reach, authority,
conversion}`), bukan sistem baru — masih extend tabel `brands` yang sama.

### §12-14 Creator Benchmark Engine → 🟡 EXTEND `competitorAnalysis.ts`

Tabel `competitors` (brand_id, name, notes) dan
`src/lib/ai/competitorAnalysis.ts` **sudah ada** dan sudah dipakai fitur
Competitor Content Gap + SWOT. TAPI (baca langsung docstring
`competitorAnalysis.ts`): sistem ini **sengaja manual-notes-only** — "AI di
sini TIDAK PERNAH diberi akses browsing/API kompetitor apa pun, satu-satunya
sumber fakta kompetitor adalah `competitorNotes` (catatan manual staf)".

Ini BEDA dari kebutuhan PRD §12 (belajar hook pattern/storytelling dari
konten ASLI creator seperti Alex Hormozi dkk, bukan cuma catatan staf tentang
mereka). Extend yang masuk akal: tambah kolom opsional di `competitors` untuk
menyimpan reference URL/transcript per creator, dan tambah mode analisis baru
di `competitorAnalysis.ts` (atau modul sibling) yang menerima raw
content/transcript sebagai input — TETAP pakai tabel `competitors` yang sama,
JANGAN bikin tabel `agustap_creator_benchmarks` terpisah seperti disebut PRD
§37 (itu utk kasus schema existing benar-benar tidak cukup; di sini cukup
extend `competitors` dengan kolom baru).

### §15-18 Content Transformer & Originality Check

**Content Transformer (§17)** → 🟡 EXTEND `trendAdaptation.ts`. Baca
langsung docstring-nya: prinsip "Context Firewall" yang SUDAH ADA di sana
("topik tidak relevan TAPI mekanisme hook/pacing/format-nya tetap bisa
diadaptasi", field `mechanismNote`) adalah **persis** filosofi PRD §17
(extract principles, bukan copy konten). Bedanya cuma sumber input:
`trendAdaptation.ts` sekarang cuma baca data performa brand sendiri +
catatan kompetitor, PRD §15 minta bisa terima reference URL/transcript
eksternal juga. Extend fungsi ini untuk terima sumber baru, jangan bikin
`ContentTransformer` terpisah yang mengulang logic "extract mechanism, bukan
konten" dari nol.

**Originality Check (§18)** → ✅ REUSE penuh. Kolom `projects.similarity_score`
dan `similar_to_project_id` sudah ada dan sudah dipakai untuk deteksi
kemiripan konten. Tinggal panggil mekanisme yang sama untuk hasil transform
Agustap sebelum lanjut ke script, TIDAK perlu sistem originality baru.

### §19 Hook Engine → ✅ REUSE

`projects.hook_type` (kolom sudah ada) + logic hook generation/scoring sudah
berjalan di `src/lib/ai/contentIntelligence.ts` dan
`src/lib/ai/retentionIntelligence.ts`. PRD §19 minta AI hasilkan minimal 3
kandidat hook dgn kategori curiosity/problem/contrarian/dst dan pilih
berdasar clarity/relevance/curiosity/specificity — cek dulu apakah
`contentIntelligence.ts` sudah punya parameter kategori yang sama sebelum
menambah cabang baru; kemungkinan besar cukup pass Agustap Content DNA
sebagai context tambahan ke fungsi yang sudah ada.

### §20 Faceless Engine → ✅ REUSE (memang sudah begitu dari awal)

Dicek ke seluruh `src/lib/render/` — TIDAK ADA satu pun kapabilitas talking
head/avatar/presenter/face-clone di codebase ini. Setiap brand (Pelangi,
Harmoni, Laundry in Bali, Animal Story & Co) SELALU render dari
broll+voiceover+overlay. Artinya "Faceless Strategy Layer" yang PRD minta
BUKAN modul baru yang perlu dibangun — constraint itu sudah 100% terpenuhi
by design di seluruh pipeline existing. Yang perlu cuma memastikan Agustap
Studio TIDAK secara sengaja diberi fitur talking head di masa depan (guard
negatif, bukan fitur positif baru).

### §21-24 Script Generator, Video Generator, Visual Planner → ✅ REUSE

- Script generator: `src/lib/ai/generateContent.ts` sudah ada, PRD §21
  eksplisit minta reuse ini + suntik Agustap DNA sebagai context tambahan.
- Video generator: `src/lib/render/ffmpeg.ts` + `src/lib/pipeline/processProject.ts`
  sudah menerima script+scene+asset+voice+text overlay persis seperti yang
  PRD §22 minta.
- Visual Planner (§23, PRD sebut ini "genuinely new" di §6F): pipeline
  `deriveBrollKeywords.ts` → `matchFootageBank.ts`/Pexels search
  (`pexels.ts`) → `clipSelect.ts` (scoring: relevance/quality/duration, mirip
  persis bobot yang diminta PRD §28) sudah menghasilkan pemetaan
  script→scene→footage requirement→Pexels keyword. Kalau ada gap (mis.
  output belum eksplisit per-scene dengan format seperti contoh PRD §24),
  itu **adapter/formatting kecil di atas pipeline ini**, BUKAN modul
  `AgustapVisualPlanner` yang dibangun dari nol.

### §25-28 Pexels-Only, Adapter, Query Generation, Scoring → ✅ REUSE penuh

`src/lib/assets/pexels.ts` sudah production-grade:
- Video search API sudah terintegrasi (`PEXELS_VIDEO_SEARCH_URL`).
- Anti-repetisi SUDAH ADA (`per_page=8` + pilih acak dari kandidat +
  `excludeUrls` dari `footageVariety.ts`) — ini lebih matang dari yang PRD
  §27 minta (PRD cuma minta beberapa keyword fallback, existing sudah py
  dedup lintas-project berbasis riwayat brand).
- License tracking sudah ada (`pageUrl`, `pexelsVideoId` disimpan ke
  `media_assets.source_url` untuk audit).
- API key sudah server-side only (sesuai §26 requirement) — verifikasi ini
  saat implementasi, tapi pola existing app ini konsisten selalu begitu.

**Tidak perlu bikin `AgustapPexelsAdapter` baru** — brand Agustap Studio
tinggal pakai `pexels.ts`/`clipSelect.ts` apa adanya, sama seperti brand lain.

### §29-33 Asset Management, Content Project, Dashboard, UI → ✅ REUSE

Semua sudah ada dan generik per-brand (`media_assets`, tabel `projects`,
dashboard existing dgn brand switcher). Sesuai PRD §30-33: tambah field
metadata (`content_source`, `creator_inspiration`, `content_angle`,
`faceless_mode` — field terakhir ini bisa dilewati mengingat §20 di atas)
ke `projects` yang sudah ada, tambah entry menu ringan di dashboard —
JANGAN bikin project/dashboard/editor kedua.

### §36 Quality Gate → ✅ REUSE

`src/lib/ai/prePublishQC.ts` sudah ada. Tambahkan check
faceless/originality/Pexels-requirement/audience-relevance sebagai
ekstensi ke fungsi ini (parameter/config tambahan), bukan quality gate
kedua.

---

## Yang genuinely perlu dibangun baru

Hanya **Inspiration Analyzer** (PRD §B/§15-16): modul yang menerima
reference URL/transcript/screenshot, fetch/parse kontennya, dan
mengeluarkan structured principles (hook pattern, angle, problem framing,
pacing, dst — PRD §13). Tidak ditemukan modul setara di codebase manapun.
Ini genuinely modul baru isolated, sesuai §4 keputusan PRD sendiri ("create
isolated module" hanya kalau benar-benar belum ada) — dan hasil modul ini
yang kemudian dikonsumsi oleh extend `trendAdaptation.ts`/
`competitorAnalysis.ts` di atas, bukan pipeline transformasi terpisah.

## Rekomendasi urutan kerja (sesuai prinsip PRD §4)

1. Isi kolom `brands` untuk Agustap Studio (Content DNA, content_pillars) —
   zero-code, murni data.
2. Bangun **Inspiration Analyzer** (satu-satunya modul genuinely baru).
3. Extend `competitorAnalysis.ts` + tabel `competitors` (kolom reference
   URL/transcript opsional) supaya bisa menerima output Inspiration Analyzer.
4. Extend `trendAdaptation.ts` supaya `mechanismNote`-nya juga bisa
   bersumber dari Inspiration Analyzer, bukan cuma data performa sendiri.
5. Adapter/formatting tipis di atas `deriveBrollKeywords.ts`/`clipSelect.ts`
   kalau output per-scene PRD §24 belum persis cocok dgn format existing.
6. Guard `brand === "agustap_studio"` + feature flag
   `AGUSTAP_CONTENT_INTELLIGENCE_ENABLED` (default OFF) membungkus SEMUA
   pemanggilan baru di atas — brand lain harus 0% terpengaruh (test §42/§45
   PRD wajib dijalankan sebelum dianggap selesai).

Dokumen ini BELUM mencakup `ARCHITECTURE_MAP.md`/`CHANGE_MAP.md`/
`RISK_MAP.md` (PRD §46 minta ke-4nya) — dibuat terpisah kalau/ketika
implementasi benar-benar dimulai, supaya CHANGE_MAP mencerminkan diff nyata
per file, bukan rencana di muka.

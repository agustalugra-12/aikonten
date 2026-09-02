# ARCHITECTURE_MAP — Agustap Studio Content Intelligence & Faceless Extension

Dibuat 2026-09-02, PRD §46 (dokumen ke-2 dari 4: REUSE_MAP sudah ada, ini
ARCHITECTURE_MAP). Menjelaskan bagaimana modul-modul di `docs/REUSE_MAP.md`
disusun jadi satu alur, BUKAN rencana — ini state kode yang sudah live.

## Prinsip struktural

Semua kode Agustap-spesifik hidup di satu folder terisolasi
`src/lib/agustap/`, TIDAK bercampur dengan lib generik brand lain
(`src/lib/ai/`, `src/lib/pipeline/`). Kode generik (`autoContent.ts`,
`generateContent.ts`, dst) hanya punya SATU titik masuk ke dunia Agustap:
`applyAgustapStrategyIfActive()`. Kalau modul ini dihapus seluruhnya, brand
lain (Pelangi, Harmoni, Laundry in Bali, Animal Story & Co) 0% terpengaruh —
itu constraint desain PRD §7/§42, bukan aspirasi.

## Alur data (1 klik "⚡ Konten Otomatis" untuk brand Agustap Studio)

```
AutoContentButton.tsx (UI)
  └─ user pilih Inspiration (opsional) dari dropdown
       │  (fetch dari GET /api/brands/[id]/content-inspiration,
       │   hanya inspirasi yg belum dipakai: used=false)
       ▼
POST /api/brands/[id]/auto-content
  { agustapInspirationId?: string }
       │
       ▼
runAutoContent(...) [src/lib/pipeline/autoContent.ts]
  1. resolve `script` (dari suggestContentIdeas ATAU scriptOverride user)
  2. script = await applyAgustapStrategyIfActive(brand, script, inspirationId)
       │        [src/lib/agustap/generationStrategy.ts]
       │
       │  a. isAgustapExtensionActive(brand.knowledgeSite)?
       │     tidak → return script APA ADANYA (no-op, zero query tambahan)
       │
       │  b. SELECT * FROM competitors
       │     WHERE brand_id=? AND benchmark_active=true
       │     → activeBenchmarks: { name, role, profile }[]
       │
       │  c. kalau ada inspirationId:
       │     SELECT * FROM manual_ideas WHERE id=? AND brand_id=?
       │     → parse inspiration_principles JSON
       │
       │  d. activeBenchmarks kosong DAN contentInspiration null
       │     → return script APA ADANYA (§2.7, zero API cost)
       │
       │  e. buildAgustapContentStrategy(brandName, script, dna,
       │       activeBenchmarks, contentInspiration)
       │     → 1x panggilan LLM: gabung Content DNA + benchmark relevan
       │       (self-reported benchmarksUsed[], bukan blend semua) +
       │       prinsip inspirasi (kalau ada) → { concept, benchmarksUsed }
       │
       │  f. kalau strategy berhasil & inspirationId dipakai:
       │     UPDATE manual_ideas SET used=true WHERE id=? (best-effort)
       │
       │  g. try/catch di seluruh (e): gagal apa pun → fallback ke
       │     script ASLI, console.error, TIDAK throw ke pemanggil (§43)
       ▼
  3. matchFootageForScript(brandId, script)   ← TIDAK BERUBAH, generik
  4. processProject(projectId)                ← TIDAK BERUBAH, generik
     (render ffmpeg, TTS, QC, publish — sama persis utk semua brand)
```

## Modul `src/lib/agustap/` (isolated, tidak diimpor brand lain)

| File | Peran | Dipanggil oleh |
|---|---|---|
| `featureFlag.ts` | `isAgustapContentIntelligenceEnabled()`, `isAgustapExtensionActive(knowledgeSite)` — satu-satunya sumber kebenaran flag+brand guard | `generationStrategy.ts`, route API |
| `inspirationAnalyzer.ts` | `analyzeInspiration()` — URL/transcript/summary/screenshot → `InspirationPrinciples` terstruktur (10 field: hook, angle, pacing, dst) | `/api/brands/[id]/content-inspiration` (POST) |
| `contentTransformer.ts` | `transformInspirationToAgustapConcept()` — embed principles+concept, cosine similarity, `getSimilarityTier`, 1x retry kalau tier high/regenerate | dipanggil manual/terpisah, BUKAN di jalur utama (originality check terjadi di dalam `buildAgustapContentStrategy` sendiri via prompt, bukan modul ini — lihat catatan Risk) |
| `creatorBenchmark.ts` | `buildCreatorBenchmarkFromContentUrls()`, `tryDiscoverContentUrlsFromAccount()`, `CREATOR_BENCHMARK_V1_SEED` (6 profil) | `/api/brands/[id]/competitors` (POST) |
| `generationStrategy.ts` | `buildAgustapContentStrategy()` (LLM combiner) + `applyAgustapStrategyIfActive()` (adapter/wiring, titik masuk tunggal ke `autoContent.ts`) | `autoContent.ts` |

## Perluasan tabel existing (bukan tabel baru, sesuai §37)

- `brands` — TIDAK ada kolom baru (Content DNA sudah cukup pakai kolom lama:
  `niche`, `positioning`, `toneOfVoice`, `contentPillars`, dst).
- `competitors` — kolom baru: `accountUrl`, `benchmarkProfile` (JSON
  `CreatorBenchmarkProfile`), `role`, `benchmarkActive` (bool, default
  false), `analyzedContentCount`. Baris lama (brand lain, manual-notes-only)
  semua kolom baru NULL/false — tidak ada migrasi data, backward compatible.
- `manual_ideas` — kolom baru: `sourceUrl`, `inspirationPrinciples` (JSON),
  `creatorName`. Sama, nullable, brand lain tidak terpengaruh.
- Migrasi: `drizzle/0041_curved_steve_rogers.sql` — murni `ALTER TABLE ADD
  COLUMN`, tidak ada `DROP`/`NOT NULL` tanpa default di kolom existing.

## UI

- `Sidebar.tsx` — item nav "Agustap" (ikon Brain) HANYA muncul kalau
  `brand.knowledgeSite === "agustap_studio"`.
- `AgustapIntelligence.tsx` — CRUD Creator Benchmark (tambah/toggle
  aktif/hapus) + Content Inspiration (paste URL → analisis → simpan →
  hapus). Halaman penuh, hanya di-render dari `page.tsx` saat view aktif.
- `AutoContentButton.tsx` — prop `brand?` opsional; brand lain (tidak
  dikirim prop, atau bukan Agustap) perilaku identik 100% dengan sebelum
  perubahan ini (empty POST body, tanpa dropdown).

## Dokumen terkait

`REUSE_MAP.md` (pemetaan kebutuhan PRD vs kode existing) · `CHANGE_MAP.md`
(diff per commit) · `RISK_MAP.md` (titik rawan & mitigasi).

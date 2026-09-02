# CHANGE_MAP — Agustap Studio Content Intelligence & Faceless Extension

Dibuat 2026-09-02, PRD §46 (dokumen ke-3 dari 4). Diff NYATA per commit
(bukan rencana) — sumber kebenaran: `git log --oneline | grep -i agustap`.

| Commit | Fase | File diubah | Ringkas |
|---|---|---|---|
| `e29fa85` | Phase 0 (Audit) | `docs/REUSE_MAP.md` (baru) | Audit reuse-vs-build-new sebelum coding apa pun (§40 No Duplication) |
| `f21fa17` | Phase 1 (Foundation) | `src/lib/agustap/featureFlag.ts` (baru), `scripts/agustap-phase1-content-dna.py` (baru), `scripts/verify-agustap-feature-flag.ts` (baru, 8 test), `.env.example` | `AGUSTAP_CONTENT_INTELLIGENCE_ENABLED` (default false) + `isAgustapExtensionActive()` guard; isi Content DNA brand Agustap di kolom `brands` existing |
| `9ccbaa6` | Phase 2 (Inspiration Analyzer) | `src/lib/agustap/inspirationAnalyzer.ts` (baru), `scripts/verify-agustap-inspiration-analyzer.ts` (baru, 9 test) | Satu-satunya modul genuinely baru (REUSE_MAP): URL/transcript/summary/screenshot → `InspirationPrinciples`; fetch HTTP polos, gagal → `SOURCE_UNAVAILABLE` (bukan mock) |
| `5f7b325` | Phase 3 (Transformer) | `src/lib/agustap/contentTransformer.ts` (baru), `scripts/verify-agustap-content-transformer.ts` (baru, 1 test) | Originality check: embed source+concept, cosine similarity, `getSimilarityTier`, retry sekali kalau tier tinggi |
| `6c97173` | Phase 2 final (Creator Benchmark) | `src/db/schema.ts`, `drizzle/0041_*.sql` + meta, `src/lib/agustap/creatorBenchmark.ts` (baru), `scripts/verify-agustap-creator-benchmark.ts` (baru, 4 test) | Extend tabel `competitors` (bukan tabel baru): `accountUrl`, `benchmarkProfile`, `role`, `benchmarkActive`, `analyzedContentCount`; seed 6 creator V1 |
| `72aeff8` | Wiring pipeline | `src/lib/agustap/generationStrategy.ts` (baru), `src/lib/pipeline/autoContent.ts`, `scripts/verify-agustap-pipeline-wiring.ts` (baru, 4 test) | `applyAgustapStrategyIfActive()` — titik masuk tunggal ke `autoContent.ts`; brand lain 0% terpengaruh (test isolation eksplisit) |
| `1c70ea9` | UI Dashboard | `src/components/dashboard/AgustapIntelligence.tsx` (baru), `Sidebar.tsx`, `page.tsx`, `src/app/api/brands/[id]/competitors/route.ts`, `scripts/agustap-seed-remaining-v1-creators.py` (baru) | UI CRUD Creator Benchmark + Content Inspiration; nav item kondisional; seed 5 creator V1 sisanya |
| `ef745aa` | Consume Inspiration | `generationStrategy.ts`, `autoContent.ts`, `auto-content/route.ts`, `AutoContentButton.tsx`, `scripts/verify-agustap-pipeline-wiring.ts` (+1 test, total 5) | Perbaikan gap: Content Inspiration sebelumnya cuma tersimpan (write-only) — sekarang benar-benar dipilih user & dikonsumsi saat generate; ditandai `used=true` setelah dipakai |

## Yang SENGAJA tidak diubah (deliberate non-change)

- `src/lib/ai/generateContent.ts`, `src/lib/render/ffmpeg.ts`,
  `src/lib/pipeline/processProject.ts` — **tidak disentuh sama sekali**.
  Faceless Strategy Layer (§20 PRD) sudah terpenuhi 100% by design (tidak
  ada mode talking-head di codebase manapun), jadi tidak perlu guard baru.
- `src/lib/ai/prePublishQC.ts` — tidak di-extend. Originality check
  Agustap-spesifik sudah terjadi lebih awal (di `generationStrategy.ts`,
  sebelum render dibuang biaya), jadi duplikasi check di quality gate akhir
  tidak menambah nilai (lihat RISK_MAP untuk alasan lengkap).
- `brands.eduEntertainmentRatio` — sudah kolom teks bebas, cukup diisi
  manual dgn rasio 3-sumbu (Reach/Authority/Conversion) PRD §11, tidak
  perlu kolom JSON baru.

## Statistik total (6 commit implementasi, di luar REUSE_MAP)

- 8 file baru di `src/lib/agustap/` + 1 komponen UI baru
- 6 script verifikasi baru (27 test individual + 1 ditambah di commit
  terakhir = 28 total), 0 file test dihapus/dilewati
- 1 migrasi SQL (`0041_curved_steve_rogers.sql`), pure `ADD COLUMN`
- 0 baris dihapus dari kode brand lain, 0 kolom `NOT NULL` baru tanpa
  default pada tabel existing

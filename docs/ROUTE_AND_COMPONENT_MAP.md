# ROUTE_AND_COMPONENT_MAP.md — Phase 2 & 3 (PRD Stitch UI rebuild)

App KontenPilot = **single-page** (`src/app/page.tsx`) + switch `activeView` client-side
(bukan multi-route Next). Jadi "route" Stitch dipetakan ke **view** existing, TIDAK bikin
route Next baru (PRD §5: jangan bikin route baru cuma demi meniru nama).

## Phase 2 — ROUTE / NAV MAPPING (Stitch sidebar → existing view)

| Stitch nav | activeView existing | Status |
|---|---|---|
| WORKSPACE › Dashboard | `overview` (`DashboardOverview`) | ✅ ada, sudah restyle |
| WORKSPACE › Buat Konten | `buat` (`BuatKonten`) baru | 🟡 ada (wrapper), belum Studio 2-kolom |
| WORKSPACE › Konten | `konten` (`ProjectList`) | ✅ port-persis |
| WORKSPACE › Planner | `rencana` (`ContentPlan`) + `ide` | 🟡 ada, belum restyle Stitch |
| WORKSPACE › Analytics | `laporan` (`WeeklyReport`/`MonthlyReport`/`AnalyticsSummary`) | 🟡 ada, belum restyle |
| SOCIAL CHANNELS › Kanal Terhubung | `SocialAccounts` (kini di dalam view konten) | 🟡 perlu jadi view sendiri; data minim (lihat gap) |
| AI INTELLIGENCE › AI Studio & R&D | `kompetitor` + `agustap` + fatigue/inspirasi | 🟡 tersebar, belum disatukan |
| LIBRARY › Aset & Audio | `footage` (`LibraryFootage`) + `musik` | 🟡 footage ✅ galeri; musik belum |
| SETTINGS › Pengaturan | `pengaturan` (`BrandSettingsSidebar`) | 🟡 ada, belum restyle |

Catatan: nav sidebar baru (Sidebar.tsx) sudah pakai grup Workspace/AI Intelligence/Library/
Settings sesuai Stitch. "Planner" Stitch = gabungan view `rencana`+`ide` existing.

## Phase 3 — COMPONENT MAP (Stitch component → existing logic/API, "UI berubah, engine tetap")

### Layar prioritas: BUAT KONTEN (Stitch §6-19)
| Bagian Stitch | Komponen/logic existing yg DIPAKAI ULANG | Catatan |
|---|---|---|
| Format selector (Video/Carousel/Poster/Caption) | `projects.type` (video|carousel) + `contentFormat` | Poster=carousel/foto; **Caption Only = belum ada pipeline** (gap #1) |
| Prompt console (textarea+counter+chips) | kirim ke `POST /api/brands/[id]/auto-content` (runAutoContent) atau `POST /api/projects` (manual) | inspiration chips ← `daily-ideas` |
| Target kanal (multi-select) | `social-accounts` (tahap publish/schedule) | generate existing tak terima kanal per-generate (gap #5) |
| Tone of voice | `brands.toneOfVoice` (dipakai generateContent) | pilih → simpan/pakai config existing, jangan sistem tone ke-2 |
| Advanced (audiens/bahasa/durasi/CTA) | `brands.targetAudience`, `videoDurationTarget`, `ctaStyle` | mapping field existing |
| Generate button | `runAutoContent` / `projects+process` (async) | **DILARANG setTimeout** (PRD §12/§27) |
| Studio Preview | polling `GET /api/projects/[id]` | data nyata |
| Working Title/Hook + Score | `youtubeMetadata`/`script`; score judul ❌ (gap #2) | jangan fake score |
| Storyboard | `storyboards` tbl + `lib/ai/storyboard.ts` (`StoryboardDialog`) | reuse |
| Footage/B-roll | `clipSelect`/`matchFootageBank`/`deriveBrollKeywords` | JANGAN ubah algoritma (§16) |
| Caption Studio + Salin | `generatedCaption`/`generatedHashtags` | reuse |
| Action toolbar (Edit/Regenerate/Simpan Draft/Jadwalkan) | `retry`, `schedule`, draft = status projects | reuse endpoint existing |

### Layar lain (reuse map ringkas)
- Konten → `ProjectList` (done). Planner → `ContentPlan`/`DailyContentPlanner`. Analytics →
  `AnalyticsSummary`/`WeeklyReport`/`MonthlyReport` + `dashboard-stats`. Kanal → `SocialAccounts`.
  AI Studio → `CompetitorIntelligence`/`FatigueSummary`/`AgustapIntelligence`. Library →
  `LibraryFootage`/`MusicBankDialog`. Settings → `BrandSettingsSidebar`.

## Keputusan mapping yg perlu Agus (di-flag, jangan diarang sendiri)
1. **Caption Only**: backend tak punya pipeline caption-tanpa-media. Opsi: (a) hilangkan format ini dulu, (b) bangun jalur caption-only baru (butuh persetujuan = fitur baru).
2. **Target kanal di Buat Konten**: generate existing tak pakai kanal. Opsi: tampilkan kanal sbg langkah publish/schedule (bukan mempengaruhi generate), atau simpan sbg preferensi.
3. **Score judul /100**: tak ada engine-nya. Opsi: sembunyikan skor, atau pakai idea_score bila kontennya dari ide ber-skor.

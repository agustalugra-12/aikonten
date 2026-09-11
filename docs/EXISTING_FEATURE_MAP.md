# EXISTING_FEATURE_MAP.md — Phase 1 Audit (read-only)

PRD "Stitch-Driven UI + Existing AI Engine Preservation" v1.0. Diaudit 2026-09-11 dari
source live server `202.10.41.72:/home/admin/kontenpilot-ai` (branch `feat/stitch-ui-redesign`).
Tujuan: petakan fungsi existing SEBELUM UI diubah, supaya UI Stitch di-*connect* ke engine
nyata, bukan dibuat ulang. **Stitch = kebenaran UI. KontenPilot existing = kebenaran fungsi.**

Legend status: ✅ ada & dipakai · 🟡 ada sebagian / beda nama (mapping) · ❌ tidak ada di backend (JANGAN dipalsukan).

---

## A. Generation & Pipeline (INTI — jangan diganti/di-mock)

| Fungsi | Lokasi existing | API | DB | Worker/Cron | UI existing | Target Stitch |
|---|---|---|---|---|---|---|
| Auto-generate 1 konten (AI pilih ide + generate) | `lib/pipeline/autoContent.ts` (`runAutoContent`) | `POST /api/brands/[id]/auto-content` | projects, daily_ideas | share lock dgn `cron/auto-generate` | `AutoContentButton` | Buat Konten → tombol Generate (jalur otomatis) |
| Buat manual (skrip/brief/upload) | `POST /api/projects` (insert status `uploaded`) → `POST /api/projects/[id]/process` | projects, media_assets | — | — | `NewProjectDialog` | Buat Konten → mode manual |
| Pipeline proses konten (video & carousel) | `lib/pipeline/processProject.ts` (`processProjectInner`) | `POST /api/projects/[id]/process` | projects, media_assets, storyboards | dipakai auto & manual | (implisit) | Production lifecycle (§20) |
| Retry proses/publish | — | `POST /api/projects/[id]/retry` | projects | — | ProjectList "Coba Lagi" | Konten → aksi |
| Script/brief generation | `lib/ai/contentBrief.ts`, `generateContent.ts` | (dalam pipeline) | projects.script | — | — | Buat Konten → Storyboard/Script |
| Caption + hashtag | `lib/ai/generateContent.ts` | (dalam pipeline) | projects.generatedCaption/generatedHashtags | — | DraftReview | Buat Konten → Caption Studio (§18) |
| Poster/infografis | `lib/ai/posterDesign.ts`, `posterCopy.ts`, `posterQualityCheck.ts` | (dalam pipeline, cabang carousel/foto) | media_assets(final_image) | — | — | format "Poster Feed" |
| Carousel | `processProject.ts` cabang `type==="carousel"` + `generateContent.generateCaptionForImages` | (pipeline) | media_assets | — | — | format "Carousel" |
| Video + footage/B-roll selection | `processProject.ts` cabang video, `clipSelect.ts`, `matchFootageBank.ts`, `deriveBrollKeywords.ts`, `destinationBroll.ts`, `footageVariety.ts` | (pipeline) | footage_bank, media_assets | — | — | format "Reels/Video"; §16 footage kontekstual — JANGAN ubah algoritma |
| Render video (ffmpeg) | `lib/render/ffmpeg.ts`, `transitions.ts`, `frameExtract.ts` | (pipeline) | media_assets(final_video) | ffmpeg proc | — | §33 render regression — jangan sentuh |
| Dubbing/voiceover, transcribe | `lib/ai/dubbing.ts`, `transcribe.ts`, `beatDetect.ts` | (pipeline) | — | — | — | (dalam video) |
| Quality gate / pre-publish QC | `lib/ai/prePublishQC.ts`, `pipeline/qualityChecker.ts`, `posterQualityCheck.ts` | (pipeline) | — | — | — | §34 quality gate |
| Storyboard | `lib/ai/storyboard.ts` | `GET/POST /api/brands/[id]/storyboards` | storyboards | — | `StoryboardDialog` | Buat Konten → Visual Storyboard (§15) |

## B. Ideas / Planner

| Fungsi | Lokasi | API | DB | UI | Target Stitch |
|---|---|---|---|---|---|
| Ide harian (auto) | `lib/ai/researchTopics.ts`, `dailyContentPlanner.ts` | `GET /api/brands/[id]/daily-ideas`, `cron/daily-ideas` | daily_ideas (+ `score`/idea_score, reasoning) | `ContentIdeas`, `DailyContentPlanner` | Buat Konten → inspiration chips; Planner |
| Ide manual (parse) | `lib/ai/manualIdeaParser.ts` | `POST /api/brands/[id]/manual-ideas` | manual_ideas | — | — |
| Rencana konten 30 hari | `lib/ai/contentPlanSuggestions.ts` | `/api/brands/[id]/content-plan`, `/content-plan/suggest` | projects.scheduledFor | `ContentPlan` | Planner (§21) |

## C. Publishing & Channels

| Fungsi | Lokasi | API | DB | Worker | UI | Target Stitch |
|---|---|---|---|---|---|---|
| Akun sosial (list) | — | `GET/POST /api/brands/[id]/social-accounts` | social_accounts (id, platform, publishVia, username) | — | `SocialAccounts` | Kanal Terhubung |
| Connect Meta/YouTube/Buffer | `lib/publish/*` | `/api/auth/{meta,youtube,buffer}/*` | social_accounts | — | dialogs | Kanal Terhubung |
| Publish + schedule | `lib/publish/orchestrate.ts` | `POST /api/projects/[id]/publish`, `/schedule` | publish_logs | `cron/auto-publish` | DraftReview | Lifecycle publish |
| Token health | — | `cron/youtube-token-health` | social_accounts | cron | — | Kanal → status token |
| Notifikasi | `lib/publish/telegram.ts` | (dalam publish) | — | — | — | **Telegram**, BUKAN WhatsApp |

## D. Analytics & Reports

| Fungsi | Lokasi | API | DB | UI | Target Stitch |
|---|---|---|---|---|---|
| Statistik dashboard | — | `GET /api/brands/[id]/dashboard-stats` | projects, publish_logs, llm_usage_log | `DashboardOverview` | Dashboard |
| Analitik / performa | `lib/ai/performanceLearning.ts`, `hashtagTracking.ts` | `GET /api/brands/[id]/analytics`, `cron/daily-analytics` | analytics | `AnalyticsSummary` | Analytics |
| Laporan mingguan/bulanan | `lib/reports/weeklyReportData.ts`, `monthlyStrategicRecommendation.ts` | `/weekly-report(.pdf/.csv)`, `/monthly-report(.pdf/.csv)` | — | `WeeklyReport`,`MonthlyReport` | Analytics → export |
| Biaya AI ($/token) | `lib/ai/openaiClient.ts`, `usageContext.ts` | `GET /api/usage-summary` | llm_usage_log | `UsageSummary` | (pengganti "Kapasitas AI" meter mockup) |

## E. AI Intelligence

| Fungsi | Lokasi | API | DB | UI | Target Stitch |
|---|---|---|---|---|---|
| Content Fatigue | `lib/ai/contentFatigue.ts` | `GET /api/brands/[id]/fatigue` | projects | `FatigueSummary` | AI Studio & R&D |
| Kompetitor | `lib/ai/competitorAnalysis.ts` | `/competitors`, `/competitor-analysis` | competitors | `CompetitorIntelligence` | Kompetitor |
| Inspirasi | `lib/agustap/inspirationAnalyzer.ts` | `/content-inspiration` | — | (Agustap) | Inspirasi |
| Creator Benchmark | `lib/agustap/creatorBenchmark.ts` | 🟡 tidak ada route umum | — | `AgustapIntelligence` (agustap only) | Creator Benchmark |
| Trend radar / adaptation | `lib/ai/trendAdaptation.ts` | `/trend-adaptation` | — | — | Inspirasi/Trend |
| Predictive / audience / retention | `predictivePerformance.ts`, `audienceSegmentation.ts`, `retentionIntelligence.ts` | `/predictive-performance`, `/audience-segmentation` | — | — | AI Studio |

## F. Library

| Fungsi | Lokasi | API | DB | UI | Target Stitch |
|---|---|---|---|---|---|
| Footage bank | — | `/footage-bank`, `/footage-bank/upload-url`, `/footage-categories` | footage_bank (mediaType,fileUrl,posterUrl,description,tags[],durationSeconds) | `LibraryFootage` (baru), `FootageBankDialog` | Library → Footage |
| Music bank | — | `/music-bank`, `/music-bank/upload-url` | music_bank | `MusicBankDialog` | Library → Aset & Audio |

## G. Settings

| Fungsi | Lokasi | DB (brands) | UI | Target Stitch |
|---|---|---|---|---|
| Brand identity/DNA | — | name, description, niche, positioning, contentGoals | `BrandSettingsSidebar` | Settings |
| Tone of voice | (dipakai generateContent) | toneOfVoice | `BrandSettingsSidebar` | Settings → Tone (§10) |
| Negative keywords | — | prohibitedTopics | `BrandSettingsSidebar` | Settings → Kata Terlarang |
| Target audiens | — | targetAudience | `BrandSettingsSidebar` | Settings/Advanced |
| Auto-publish | `cron/auto-publish` | publishMode, autoPublishTimes | `BrandSettingsSidebar` | Settings toggle |
| Poster brand profile / palet | `posterDesign.ts` | posterBrandProfile, allowLogoInAiContent | `BrandSettingsSidebar` | Settings |

---

## GAP / CATATAN MAPPING (untuk sprint Buat Konten & lainnya)

1. **Format Stitch 4 pilihan** (Reels/Video · Carousel · Poster Feed · Caption Only) → backend `projects.type` hanya **video|carousel**. Mapping: Poster Feed = carousel/foto (`contentFormat="foto"` atau `allowAiGeneratedPhotos`); **Caption Only = TIDAK ada pipeline khusus** → butuh keputusan (mapping ke caption-only flow existing? tidak ada) → jangan bikin engine baru diam-diam; tandai & tanya Agus.
2. **Score judul/hook /100 (Stitch §14)** → TIDAK ada scoring judul/hook untuk konten hasil generate. Yang ada: `daily_ideas.score` (skor IDE), `thumbnailScoring.ts` (skor thumbnail). Per PRD §14: **jangan buat fake score** — omit atau pakai idea_score bila relevan.
3. **Studio Preview (Stitch §13-18)** harus tampilkan data NYATA hasil pipeline: title/hook (youtubeMetadata/script), storyboard (tabel storyboards), caption (generatedCaption), media (media_assets). Bukan dummy. Generate = panggil `auto-content` / `projects+process`, BUKAN setTimeout.
4. **Generate = jalur async panjang** (pipeline video bisa menit-an). Studio Preview perlu polling status project (`GET /api/projects/[id]`) — pola sudah ada di DraftReview/refreshProjects.
5. **Kanal target di Buat Konten** → backend generate saat ini tidak menerima daftar kanal per-generate (kanal ditentukan di publish/schedule). Multi-select kanal Stitch = mapping ke tahap publish, atau simpan sbg preferensi — tandai, jangan pura-pura mempengaruhi generate kalau backend tak memakainya.
6. **Fiksi mockup (JANGAN dipasang)**: followers/token-expiry/API-limit/latency/storage-gauge/SOC2/6-user-team/"oleh <user>". Backend single-admin, social_accounts minim field.
7. **Notifikasi = Telegram** (bukan WhatsApp seperti label mockup).
8. **Auto Generate & semua cron** (`auto-generate`, `auto-publish`, `daily-ideas`, `daily-analytics`, `youtube-token-health`) WAJIB tetap jalan — UI tidak menyentuh worker.

## Status UI redesign (sudah dikerjakan pra-PRD, di branch ini)
- ✅ Shell (Sidebar grup nav, header, font Plus Jakarta/Inter/JetBrains, palet surface-container) — global
- ✅ Konten (tabel port-persis, data nyata), Dashboard (chart SVG area+donut nyata), Buat Konten (bungkus mekanisme existing — **belum** layout 2-kolom Studio Stitch §6-19), Library footage (galeri nyata)
- ⏳ Belum: Buat Konten Studio 2-kolom penuh, Planner, Analytics, Kanal, Settings, AI Intelligence per Stitch

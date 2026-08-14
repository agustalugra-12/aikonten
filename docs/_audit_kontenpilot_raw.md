# KontenPilot AI — Architecture & Risk Audit (raw working doc)

Read-only audit. Date: 2026-08-14. Scope: `/root/kontenpilot-ai` (Next.js 16, TypeScript,
SQLite/drizzle-orm/better-sqlite3, no CI). Written for the controller to merge into a
cross-system safety doc alongside PMS and ai-chat-bot audits. Not committed to git.

---

## 1. Architecture

### App shape
Next.js App Router. No separate worker process — everything runs inside the Next.js
server process (systemd-managed `next start`), including video rendering via `execFile`/
`systemd-run --scope` child processes.

### `src/app/api/` routes
- **Auth**: `auth/login`, `auth/logout` — single-admin (Agus only), password hash in
  `.env` (`ADMIN_PASSWORD_HASH_B64`), NOT the `users` table (that table is just an FK
  anchor, see `src/db/schema.ts:3-13`). `auth/buffer/channels`, `auth/meta/{connect,
  callback,select}`, `auth/youtube/{connect,callback}` — OAuth/token flows for social
  platforms.
- **Brands** (`brands/[id]/...`): CRUD, `analytics`, `auto-content` (manual "⚡ Konten
  Otomatis" trigger — thin wrapper over `lib/pipeline/autoContent.ts`), `content-ideas`,
  `daily-ideas`, `dashboard-stats`, `footage-bank` (+ `upload-url`, categories),
  `logo-upload-url`, `manual-ideas`, `music-bank` (+ upload-url), `social-accounts`,
  `storyboards`.
- **Projects** (`projects/[id]/...`): `assets`, `process` (manual trigger →
  `processProject.ts`), `publish` (manual → `orchestrate.ts`), `retry` ("smart retry" —
  publish-only if final assets exist, else full regenerate), `upload-url`.
- **Cron** (`cron/*`, shared-secret auth via `X-Cron-Key`, see below): `auto-generate`,
  `auto-publish`, `daily-ideas`, `youtube-token-health`.
- **Misc**: `media-proxy`, `social-accounts/[id]/channel-profile`, `usage-summary`
  (global AI cost dashboard, not per-brand).

### `src/lib/` organization
- `ai/` (32 files) — all LLM/generation logic: caption/hashtag generation
  (`generateContent.ts`), idea research/scoring (`researchTopics.ts`,
  `dailyContentPlanner.ts`), footage matching/description (`matchFootageBank.ts`,
  `describeFootage.ts`), clip selection heuristics (`clipSelect.ts`), AI Director
  (`aiDirector.ts` — motion/transition/music planning), poster design/QC
  (`posterDesign.ts`, `posterQualityCheck.ts`, `posterCopy.ts`), dubbing/TTS
  (`dubbing.ts`), transcription (`transcribe.ts`, Whisper), fact-check
  (`factCheck.ts`), price validation (`priceValidator.ts`), content-similarity/
  duplicate detection (`contentSimilarity.ts`), YouTube editorial engine
  (`youtubeEditorial.ts`), centralized OpenAI client + cost logging
  (`openaiClient.ts`), fal.ai retry wrapper (`falRetry.ts`), usage-context
  (AsyncLocalStorage-based cost attribution, `usageContext.ts`).
- `render/` (17 files) — ffmpeg-based video assembly: `ffmpeg.ts` (main
  orchestrator — tree-merge, overlay/subtitle burn, loudnorm), `transitions.ts`
  (pure planning: `planTreeMerge`, `computeClipSequencePlan` — no ffmpeg calls,
  testable), `cameraMotion.ts`, `colorGrade.ts`, `subtitleDesign.ts` (ASS
  word-highlight captions), `overlayEngine.ts`, `statOverlay.ts`, `lowerThird.ts`,
  `comparisonBar.ts`, `stickerOverlay.ts`, `subscribeButton.ts`, `lottieOverlay.ts`,
  `imageToClip.ts` (Ken Burns), `frameExtract.ts` (thumbnail from video frame),
  `cloudinary.ts` (legacy path, mostly superseded by local ffmpeg but still used
  for TikTok image resize).
- `pipeline/` — `processProject.ts` (1135 lines, the main per-project
  orchestrator — see §5), `autoContent.ts` (idea → project creation, shared by
  manual "⚡" button and cron), `qualityChecker.ts` (post-render technical QC
  gate).
- `publish/` — `orchestrate.ts` (`publishProject()`, multi-account fan-out,
  idempotent per-account), `buffer.ts`, `bufferAuth.ts` (token + duplicate-post
  detection), `youtube.ts`/`youtubeAuth.ts` (native), `facebook.ts`,
  `instagram.ts`, `telegram.ts` (notification), `metaAuth.ts`, `index.ts`
  (publisher dispatcher), `types.ts`.
- `assets/` — `pexels.ts`, `pixabay.ts`, `broll.ts` (stock footage search).
- `policy/platformPolicy.ts` — YouTube monetization-safety profile scaffolding
  (not yet wired to any real gating — no YouTube channel was connected as of
  2026-08-08 per schema comment; may have changed since Animal Story & Co
  onboarding).

### Database (SQLite, drizzle-orm, `src/db/schema.ts`)
15 tables: `users` (1 seeded row), `brands`, `socialAccounts`, `projects`,
`mediaAssets`, `publishLogs`, `analytics`, `storyboards`, `footageCategories`,
`footageBank`, `musicBank`, `dailyIdeas`, `manualIdeas`, `llmUsageLog`,
`platformPolicies`, `channelProfiles`, `youtubeSeries`.

Unique constraints found: `users.email` (unique), `channelProfiles.socialAccountId`
(unique, one profile per YouTube channel). **That's it** — no other table has a
unique constraint. Notably:
- `projects` has no unique constraint preventing duplicate rows for the same
  idea/brand/date — duplicate-prevention for auto-generate is entirely
  behavioral (via `dailyIdeas.used` flag), not DB-enforced (see §6, top finding).
- `publishLogs` has no unique constraint on `(projectId, socialAccountId)` —
  idempotency for "already published to this account" is enforced by
  application code filtering `status === "success"` in `orchestrate.ts:90-92`,
  not by the schema. A bug that skips this filter could silently double-publish
  to the same account with no DB-level backstop.
- `dailyIdeas` has no unique constraint on `(brandId, date, idea text)` — dedup
  of daily idea batches relies on `getOrGenerateDailyIdeas()` checking for an
  existing row before generating, not a DB constraint.

Migrations: `drizzle/` directory, 29+ generated migrations (`.bak-pre-NNNN`
files in `data/` show manual pre-migration DB backups being taken by hand —
good practice, but manual/ad hoc, not scripted).

### Cron/scheduler mechanism
No queue (no BullMQ/Redis/etc). Systemd timers → shell wrapper
(`scripts/cron/call-endpoint.sh`) → `curl -X POST` to a local
`/api/cron/*` route with header `X-Cron-Key: $CRON_SECRET` (secret read from
`.env` at call time, not baked into the systemd unit file — avoids leaking via
`systemctl cat`). Auth check: `src/lib/cron/verify.ts` — simple shared-secret
compare, no rate limiting, no IP restriction (relies on the endpoint only being
reachable via `localhost:3100`, not exposed publicly — not verified in this
audit whether the port is firewalled from the public internet).

Timers (`scripts/cron/*.timer`):
| Timer | Schedule | Route | Purpose |
|---|---|---|---|
| `kontenpilot-daily-ideas.timer` | 02:00 WIB (=03:00 WITA) | `/api/cron/daily-ideas` | Generate today's idea batch for all brands (idempotent — checks existing rows first) |
| `kontenpilot-auto-generate.timer` | 23:00 WIB | `/api/cron/auto-generate?brandIds=<Pelangi,Laundry>` | Process today's unused ideas → full render, for the "light" batch |
| `kontenpilot-auto-generate-animalstory.timer` | 02:15 WIB | `/api/cron/auto-generate?brandIds=<AnimalStory>` | Same route, "heavy" long-form batch, staggered ~3h15m from the light batch to avoid resource contention |
| `kontenpilot-auto-publish.timer` | every 15 min | `/api/cron/auto-publish` | Per-brand `autoPublishTimes` slot check + partial/failed-publish retry (2h backoff) |
| `kontenpilot-youtube-token-health.timer` | 06:00 WIB (=07:00 WITA) | `/api/cron/youtube-token-health` | Proactively refresh YouTube native OAuth tokens (Google "Testing" app tokens expire hard after 7 days of inactivity) |

`TimeoutStartSec=10800` (3h) on both auto-generate services; `call-endpoint.sh`
uses `curl --max-time 10700`, intentionally just under the systemd timeout
(commit history shows this was raised from 1700s after a real false-failure
incident where curl gave up before the actual (unaborted) server-side work
finished — see §6).

### External APIs
- **OpenAI**: chat.completions (ideas, captions, poster copy, vision/footage
  description, fact-check, similarity embeddings) via centralized
  `openaiClient.ts`; Whisper (transcription, `transcribe.ts`); TTS
  (`gpt-4o-mini-tts`, `dubbing.ts`).
- **fal.ai**: Nano Banana 2 image model — `posterDesign.ts` (poster overlay +
  full AI-generate poster path), via `falRetry.ts` wrapper (3 attempts, 2s/4s/6s
  backoff).
- **Buffer** (GraphQL, `api.buffer.com` — REST v1 API is sunset): social
  publishing for TikTok always, Instagram/Facebook/YouTube optionally
  (`publish/buffer.ts`).
- **YouTube Data API**: native publish path + OAuth (`publish/youtube.ts`,
  `publish/youtubeAuth.ts`) as an alternative to Buffer for YouTube specifically.
- **Meta (Facebook/Instagram) native**: `publish/facebook.ts`,
  `publish/instagram.ts`, `publish/metaAuth.ts` — native Graph API path,
  alternative to Buffer.
- **Pexels / Pixabay**: stock B-roll search (`assets/pexels.ts`,
  `assets/pixabay.ts`), used when brand footage is insufficient or content is
  generic/destination-themed.
- **Telegram**: fire-and-forget publish-result notifications
  (`publish/telegram.ts`).
- **Cloudflare R2** (S3-compatible, via `@aws-sdk/client-s3`): asset storage,
  presigned direct-upload for large raw footage, server-side upload for
  generated assets (`lib/storage.ts`).
- **Tripay**: confirmed **not referenced anywhere** in this codebase (`grep -rn
  "tripay" src/` → zero hits). No cross-contamination with PMS's payment
  provider. Confirmed clean.

---

## 2. Deployment mechanism

Confirmed: **manual, no CI.** `README.md` is still the untouched
`create-next-app` boilerplate — no deploy runbook exists anywhere in the repo.
`package.json` has no deploy script. No GitHub Actions / CI config found.
Deploy is (per tonight's session and the git history) inferred to be: SSH in,
`git pull`, `npm run build`, restart the systemd service on **each of the two
servers separately**.

**Two servers, each with its own local SQLite file** (`DATABASE_PATH=
./data/kontenpilot.db`, `better-sqlite3`, WAL mode — see `src/db/index.ts`).
This is a hard architectural fact, not just an operational one: SQLite is a
local file, so the "old shared VPS" (Pelangi Homestay + Laundry in Bali +
PMS + MongoDB + ai-chat-bot, all sharing one 3.8GB box) and the "new dedicated
VPS" (Animal Story & Co only) run **fully independent databases with no
replication or sync mechanism** (checked — no litestream, no rsync cron, no
sync script anywhere in `scripts/`). Each server therefore has its own:
- `.env` (confirmed different `FFMPEG_MEMORY_MAX`/`FFMPEG_CPU_QUOTA` defaults
  are *designed* to differ per server — see `src/lib/render/ffmpeg.ts:103-119`,
  env-overridable, default `1000M`/`150%` tuned for the old shared box, meant
  to be raised via env on the dedicated box).
- Codebase state (git commit) — must be manually kept in sync.
- `llm_usage_log` / `usage-summary` cost dashboard — **not global across the
  fleet**; Agus checking `/usage-summary` on one server will not see spend on
  the other. Same for Draft Review, dashboard stats, analytics.
- systemd timer schedules — confirmed the `auto-generate` cron already had a
  `brandIds` query-param split *before* tonight's dedicated-VPS migration
  (commit `b974fb7`, 2026-08-12: "insiden nyata hari ini: render Animal Story
  & Co pakai ~3GB RAM di VPS 3.8GB yg sama dgn PMS+MongoDB, sempat bikin
  MongoDB tidak terjangkau" — i.e. this was a stopgap on the *shared* VPS
  before Animal Story & Co got its own dedicated box tonight).

### Drift risk — confirmed, not hypothetical
This is the single structural risk this whole deployment shape creates: **any
fix, migration, or config change now has to be applied twice, by hand, with
nothing that flags divergence.** Concrete evidence this already almost bit
tonight (per the task brief): the timezone/cron setup nearly diverged during
tonight's migration. Additional structural evidence found in this audit:
- `FFMPEG_MEMORY_MAX`/`FFMPEG_CPU_QUOTA` are *intentionally* different per
  server via `.env` — correct by design, but this pattern (behavior
  intentionally forked by untracked, unreviewed `.env` values) is exactly the
  kind of thing that silently drifts wrong (e.g., a future fix that changes
  the *default* in code won't propagate to a server whose `.env` already
  pins the old default explicitly, and no one will notice until a render
  fails or behaves differently between servers).
- Drizzle migrations (`drizzle/` dir, 29+ files) must be run manually on each
  server's DB — nothing enforces both DBs are on the same migration version.
  A schema drift between servers would not error loudly; it would silently
  produce different behavior or crash on the specific server that's behind.
- No shared cost/analytics view — if Agus is checking "am I over budget"
  from the old VPS's dashboard, the new VPS's fal.ai/OpenAI spend (which is
  the *heavier* long-form batch) is invisible from there.

---

## 3. Existing tests

**Confirmed: no test runner installed.** `package.json` scripts: `dev`,
`build`, `start`, `lint` only. `devDependencies` has no `jest`, `vitest`,
`@testing-library/*`, `playwright`, or similar. `npm run lint` exists (ESLint)
but that's static analysis, not behavioral verification.

What exists instead — standalone `npx tsx` scripts under `scripts/`, run
manually and ad hoc:
- `scripts/verify-tree-merge-plan.ts` — from tonight's OOM fix. Verifies
  `planTreeMerge()`/`computeClipSequencePlan()` in `transitions.ts` produce a
  correct merge tree (pure logic, no ffmpeg, no side effects) for a range of
  clip counts. This is the closest thing in the repo to a real unit test, and
  it's the one artifact of tonight's most important fix that has any
  verification at all beyond the live 47-minute render.
- `scripts/regen-narration.ts` — one-off batch remediation script (regenerate
  narration for a specific set of already-broken videos), not a test.
- `scripts/fix-stuck-buffer-posts-2026-08-13.ts` — one-off remediation script
  for a specific incident, not a test.
- `scripts/hash-password.mjs`, `scripts/seed-admin.mjs` — setup utilities.
- `scripts/lottie/rasterize.mjs`, `scripts/lottie/render_lottie.py` — asset
  build tooling, not tests.

**Honest assessment**: automated coverage is effectively zero for anything
except the one pure-logic module (`transitions.ts` tree-merge planning) that
got a verification script written *tonight*, reactively, after the incident.
There is no test for: `processProject.ts` (1135 lines, the entire content
pipeline), `qualityChecker.ts` (the gate that decides publishable vs. reject),
`orchestrate.ts` (publish fan-out/idempotency logic), any cron route, any
ffmpeg filter-chain construction, any external API integration (all three:
OpenAI, fal.ai, Buffer are untested against contract changes). Verification of
correctness for this system currently means: read the code, reason about it,
and validate via a real (paid, costly) end-to-end render/publish in
production. This is itself the top-level finding this audit exists to
surface — not a gap in one area, but the absence of a safety net anywhere in
the highest-cost, highest-blast-radius part of the codebase.

---

## 4. Test gaps — highest-risk specifics

### Render pipeline — other O(N) patterns beyond the fixed merge step
Checked every ffmpeg-calling code path in `src/lib/render/ffmpeg.ts` for the
same class of bug (all-N-inputs-in-one-call memory scaling):

- **Step 1, per-clip normalize** (`ffmpeg.ts:367-392`): one ffmpeg call *per
  clip*, each call has exactly 1 input. This is O(N) in **time** (N sequential
  subprocess invocations) but **not** in memory — each call's memory footprint
  is independent of N. Not a repeat of tonight's bug, but worth naming: render
  wall-clock time for a 60-clip long-form video is bounded below by 60
  sequential ffmpeg spawns, before any merging happens. No batching /
  parallelism here — intentionally sequential (no comment found explaining a
  deliberate memory-safety tradeoff for this specific loop, unlike the
  tree-merge, so this may just be unexamined, not a deliberate design
  decision).
- **Step 2, merge**: tree-merge (tonight's fix), confirmed genuinely O(2
  inputs) per ffmpeg call regardless of N. Verified via
  `scripts/verify-tree-merge-plan.ts`. Good.
- **Step 6, final overlay pass** (`ffmpeg.ts:514-836`, the single biggest
  filter_complex in the codebase): **this is one ffmpeg call with
  potentially many simultaneous inputs** — video, logo (optional), sticker OR
  wow-lottie (optional, mutually exclusive), one PNG per stat-card overlay
  (`validStatOverlays`, can be >1 — no cap found on how many stat overlays
  `extractStatOverlays()` can return per video), bell icon (optional),
  confetti lottie (optional), voiceover audio, music (optional). This is
  **not** driven by clip count N, so it does not reproduce tonight's exact
  bug — but it's architecturally the same *shape* of risk (single ffmpeg
  process holding N simultaneous decoders/filters in memory) just bounded by
  a different, less-obviously-scaling variable: number of stat-card overlays
  per video. `extractStatOverlays()` (`lib/ai/statExtractor.ts`, not fully
  read in this pass) is GPT-driven with no hard cap visible in
  `processProject.ts` on how many stats it can extract from a long narration
  — a long-form documentary script (Animal Story & Co, 5-8 min) with many
  numeric facts could plausibly return more stat overlays than a short-form
  script, which would add more simultaneous PNG inputs to this single ffmpeg
  call. **Not verified to be a real problem** (no incident found), but it is
  the one other place in the render pipeline with un-capped fan-in to a
  single ffmpeg process, and is worth a bounds check given tonight's incident
  was exactly this class of bug once before.
- **Subtitle burning**: not a separate ffmpeg pass — subtitles are burned in
  the same Step 6 call via the `ass` filter on a pre-built `.ass` file. Not
  O(N) itself (the `.ass` file can have arbitrarily many cues without adding
  ffmpeg *inputs*), so this specific concern doesn't reproduce, but it means
  subtitle burning cannot be isolated/retried independently of the whole
  overlay pass except via the "retry_subtitle_only" path in
  `processProject.ts:986-1023`, which re-runs the *entire* Step 6 call (full
  render, not just subtitle re-encode) — confirmed cheaper than a full footage
  re-render but still a full ffmpeg overlay pass, contradicting the code
  comment's own caveat ("retry ini TETAP render ulang... bukan literally
  'tanpa render ulang'").
- **Thumbnail generation**: `extractThumbnailFrame()` (`render/frameExtract.ts`,
  not deeply read) — per the `processProject.ts` comment, this is a cheap
  single-frame extraction from the *already-rendered* final video, not an
  AI-generation call anymore (explicitly de-costed 2026-08-10, "biaya
  thumbnail = 0"). Low risk.
- **Timeout**: single global `FFMPEG_TIMEOUT_MS = 40 * 60 * 1000` (40 min)
  applies uniformly to *every* ffmpeg call in the pipeline — the per-clip
  normalize calls (Step 1, cheap, should finish in seconds) share the same
  40-minute ceiling as the heavy final overlay pass. Not dangerous (a stuck
  per-clip call will still eventually get killed), just imprecise — a
  genuinely-hung normalize call for clip 3 of 60 would burn up to 40 minutes
  before being killed, when it should reasonably take seconds.

### Publish pipeline — retry/idempotency risk
- `orchestrate.ts` publish fan-out is idempotent **per social account**
  (`alreadySucceededAccountIds` filter against `publishLogs`, line 90-92) —
  confirmed this correctly prevents double-publish-to-the-same-account on
  retry (this was the actual fix shipped 2026-08-07 per the schema comment on
  `projects.status = "partial"`).
- Buffer's own known bug: a single `createPost` GraphQL call can, on Buffer's
  side, sometimes result in **two live posts** (not our retry logic — a bug
  in Buffer itself, per `buffer.ts:125-139` comment). Mitigated by
  `checkAndHandleDuplicate()` in `bufferAuth.ts` (fire-and-forget, polls ~3.5
  min later, deletes the extra post) — reasonable mitigation for a
  third-party bug, not evidence of a bug in this codebase.
- Buffer `createPost` "success" only confirms Buffer *accepted* the request,
  not that it actually went live (`orchestrate.ts:207-225`,
  `verifyPublishSucceeded` in `bufferAuth.ts`, fixed 2026-08-13 per commit
  `f2cb3a2`) — background-verified, not blocking, reasonable given Buffer's
  API shape.
- **No lock protecting `publishProject()` from concurrent invocation on the
  same `projectId`.** If the manual "Publikasikan" button were double-clicked,
  or a manual retry raced with the 15-min `auto-publish` cron's retry pass for
  the same project, two concurrent calls could both pass the
  `alreadySucceededAccountIds` check (read-then-act race — nothing prevents
  two reads seeing the same "not yet succeeded" state before either write
  lands) and both attempt to publish to the same not-yet-succeeded account,
  causing an actual double-publish to a live social account. Not confirmed as
  having happened (no incident found in git log for this specific race), but
  structurally present — same shape as the real "duplicate booking" race
  found and fixed in the other two systems tonight (per project memory), just
  not yet found here.

### Auto-generate cron flow — duplicate paid API risk (the concerning one)
Traced idea → project step by step (`cron/auto-generate/route.ts`,
`autoContent.ts`, `processProject.ts`):

1. `getOrGenerateDailyIdeas(brand.id)` — idempotent (checks existing rows for
   today first).
2. `SELECT * FROM dailyIdeas WHERE brandId=? AND date=? AND used=false` — reads
   the full list of unused ideas into `todaysIdeas`.
3. **Sequential** `for` loop over `todaysIdeas`: for each, calls
   `runAutoContent()` (which does the full paid pipeline — OpenAI captions,
   fal.ai poster/image, TTS, Whisper, ffmpeg render — all real cost), and only
   **after** it returns successfully, calls `markDailyIdeaUsed(idea.id)`.

**The gap**: the `SELECT ... WHERE used=false` (step 2) and the `UPDATE
used=true` (after step 3 completes) are not in the same transaction, and
there is **no lock — DB-level or application-level — preventing this cron
route from being invoked twice concurrently** for the same brand. Verified by
grep (`Lock|mutex|advisory|isProcessing|inProgress|BEGIN IMMEDIATE` — zero
hits anywhere in `src/app/api/cron` or `src/lib/pipeline`). In practice this
is currently mitigated only by:
- systemd's own semantics for `Type=oneshot` units — starting a unit that's
  already active is normally a no-op/merged job, which provides *incidental*
  protection against the *same systemd timer* double-firing. This is an
  operational accident of systemd's behavior, not a designed safeguard.
- The two auto-generate timers target disjoint `brandIds`, so they can't
  race each other over the same idea.
- Nothing stops a **manual** trigger (e.g., Agus or an operator running
  `curl` by hand, or `systemctl start kontenpilot-auto-generate.service`
  while the timer-triggered run from the same night is still in flight —
  plausible given tonight's own history of `curl` timing out at 1700s while
  the real work kept running for a full hour, per the `call-endpoint.sh`
  comment) from racing the scheduled run.
- Same weakness applies to `/api/brands/[id]/auto-content` (the manual "⚡"
  button) racing the cron for the same brand — both ultimately call the same
  `runAutoContent()` path and neither locks on `brandId` or `dailyIdeas.id`.

**Impact if it fires**: two concurrent workers reading the same
`used=false` idea would both run the *entire* paid pipeline (OpenAI +
fal.ai + TTS + a full ffmpeg render, each independently costing real money
and CPU) for the same idea, then both attempt `markDailyIdeaUsed` (harmless,
idempotent) — but by then the duplicate cost is already spent, and two nearly
identical `projects` rows exist with no unique constraint to have prevented
it. This is the same class of bug as the "duplicate booking" race fixed
tonight in the other two systems (per project memory:
`project_booking_duplicate_race_condition.md`, fixed with a per-session
`asyncio.Lock`) — not yet found or fixed here. **This is the single highest
concern from this audit** given it directly risks unnecessary
OpenAI/fal.ai spend, and the failure mode (curl timing out while server-side
work keeps running) that would make an operator *plausibly* re-trigger a
run manually is already proven to happen in this exact system (see
`call-endpoint.sh` comment, §2/§6).

Similarly, `/api/projects/[id]/process` and `/api/projects/[id]/retry` have
no per-project lock — a double-click or a manual retry racing an in-flight
cron-triggered `processProject()` call for the same `projectId` would run
the paid pipeline twice concurrently for that project, with the same
duplicate-cost consequence, plus two concurrent ffmpeg renders competing for
the same `FFMPEG_MEMORY_MAX`/`FFMPEG_CPU_QUOTA` cgroup budget (compounding,
not just duplicating, the resource-pressure risk tonight's other two fixes
were about).

---

## 5. Critical business flow — step by step with file:line references

**Daily flow (auto/scheduled path):**

1. **03:00 WITA** — `cron/daily-ideas/route.ts:20-29` → for each brand,
   `getOrGenerateDailyIdeas(brand.id)` (`lib/ai/dailyContentPlanner.ts`, not
   fully read this pass) — GPT-driven idea generation, **paid OpenAI call**,
   idempotent per brand/day.
2. **23:00 or 02:15 WIB** (batch-dependent) —
   `cron/auto-generate/route.ts:41-71` → for each brand in scope, for each
   unused `dailyIdeas` row (sequential, not parallel — deliberate, see
   comment at line 21-24 re: shared-VPS resource pressure): calls
   `runAutoContent()` (`lib/pipeline/autoContent.ts:39`).
3. **Footage matching** — `autoContent.ts:126`, `matchFootageForScript()`
   (`lib/ai/matchFootageBank.ts`) — GPT call to match brand's `footageBank`
   against the idea's script/topic (**paid OpenAI call**). Falls back to
   Pexels/Pixabay stock search (`searchBrollVideo`, **paid-adjacent — API key
   quota, not per-call $ cost**) if no relevant brand footage exists and the
   idea isn't "spesifik" to the property.
4. **Project creation** — `autoContent.ts:271-306`, inserts `projects` row
   (status `"uploaded"`) + `mediaAssets` rows (`type: "raw_footage"`), then
   calls `processProject(projectId)` (`autoContent.ts:308`).
5. **Transcription** (video path only) — `processProject.ts:367-384`,
   `transcribeFootage()` per raw asset (**paid Whisper call**, per-file
   try/catch so one bad file doesn't kill the batch).
6. **Clip selection** — `processProject.ts:390-421`, deterministic heuristic
   scoring (`selectClips`/`scoreSegments` in `clipSelect.ts`), **not AI**, no
   cost.
7. **Caption/hashtag/pillar/angle/keyword generation** —
   `processProject.ts:461-469`, `generateCaptionAndHashtags()`
   (**paid OpenAI call**, one call covers caption+hashtags+pillar+angle+
   keyword+structure template, per the schema comment — batched
   deliberately to avoid extra cost).
8. **B-roll/stock fill** — `processProject.ts:502-560`, `607-649` — Pexels/
   Pixabay search calls (quota-costed) to hit duration budget; then an
   **Auto-Fix Ladder** (`processProject.ts:661-722`, added 2026-08-12) that
   (a) broadens B-roll keywords and retries search once, then (b) if still
   short, accepts a shorter duration if ≥85% of the original minimum
   (`GRACEFUL_DEGRADE_RATIO`), else hard-rejects with a clear error — **this
   is itself a "too strict gate, relaxed after real incidents" pattern**,
   same shape as tonight's 120s tolerance fix, already iterated on
   twice tonight per the code comments (flat +3s margin → proportional 8% →
   15%, still "belum tervalidasi ulang dgn render nyata ke-3" — an explicitly
   *unresolved*, still-being-tuned business rule as of this audit).
9. **TTS/narration** — `processProject.ts:751`, `generateVoiceover()`
   (**paid OpenAI TTS call**) — generated *before* final subtitle timing so
   subtitles can be built from the actual audio (re-transcribed via Whisper,
   **second paid Whisper call**, `processProject.ts:759`).
10. **AI Director** — `processProject.ts:831`, `planEdit()` (**paid OpenAI
    call**, motion/transition/music-mood planning) — falls back to
    deterministic round-robin on failure, does not block render.
11. **Video render** — `processProject.ts:928`, `renderFinalVideo()`
    (`render/ffmpeg.ts`) — CPU-only, no external paid API, but this is the
    step tonight's OOM/timeout fixes targeted. Tree-merge (2-input-per-call),
    40-min timeout, cgroup-scoped memory/CPU (`FFMPEG_MEMORY_MAX`/
    `FFMPEG_CPU_QUOTA`).
12. **Post-render duration gate** — `processProject.ts:952-958` — **hard
    business rule**: `rendered.durationSeconds < effectiveMinDuration -
    POST_RENDER_DURATION_TOLERANCE_SECONDS (120)` → reject, discard the
    already-rendered (already-costed) video. This is the exact gate loosened
    tonight (Agus-approved business decision, was zero-tolerance before).
13. **Quality Checker gate** — `processProject.ts:981-1032`,
    `runVideoQualityChecks()` (`qualityChecker.ts`) — technical-only checks
    (silence, mean volume, black frames, SRT sanity), each classified
    `hard_reject` / `warn` / `retry_subtitle_only`. `retry_subtitle_only`
    triggers one cheap-ish retry (re-transcribe existing audio + **re-run the
    full Step-6 overlay ffmpeg pass**, not literally free per the code's own
    caveat). `hard_reject` → project `status = "failed"`, **this is a second
    hard business gate that discards an already-fully-rendered (already
    fully paid-for) video** — same cost-loss shape as the duration gate, and
    it has its own similarly-tuned thresholds (`SILENCE_WARN_MAX_SECONDS=8`
    hard / `12` warn-ceiling, `MIN_MEAN_VOLUME_DB=-35` hard / `-30` warn,
    `MAX_BLACK_SECONDS=2` hard / `4` warn) that were explicitly loosened once
    already (2026-08-12, "jangan reject, coba perbaiki dulu") but, unlike the
    duration tolerance, **have not been revisited/re-tuned against real
    render data the way the duration margin was tonight** — worth watching
    for the same "too strict, rejects valid expensive work" failure mode.
14. **Publish-or-draft** — `processProject.ts` ends at `status = "ready"`
    (always — auto-publish is a *separate* later step, not inline). If
    `brand.publishMode === "auto"`, the **15-min** `cron/auto-publish` timer
    later finds this project via its `autoPublishTimes` slot logic
    (`cron/auto-publish/route.ts:103-157`) and calls `publishProject()`
    (`orchestrate.ts`) — fan-out to Buffer/YouTube/Meta native per connected
    `socialAccounts`, idempotent per-account. If `publishMode === "draft"`
    (default), it sits in Draft Review for Agus to manually click
    "Publikasikan" (`POST /api/projects/[id]/publish`, not read this pass but
    presumably calls the same `orchestrate.ts` function).

**Paid-API cost-exposure points, summarized**: steps 3 (footage-match GPT),
5 (Whisper x1-N files), 7 (caption GPT), 8 (poster fal.ai, if carousel path),
9 (TTS + second Whisper pass), 10 (AI Director GPT), plus fact-check
(`factCheckCaption`) and similarity-embedding (`checkContentSimilarity`)
calls at both the carousel and video branches — both wrapped in try/catch
that swallows failures without blocking the project (correct fail-open
design for non-critical enrichment), but each is still a real paid call made
once per project with no caller-side idempotency beyond "don't call it
twice within one `processProject()` invocation" — which is exactly the
protection that's missing at the *cron/manual-trigger* level (§4).

---

## 6. Regression-prone points — concrete evidence

1. **No lock on cron/manual-trigger overlap** (detailed in §4) — the top
   finding. No DB advisory lock, no in-memory mutex, no unique constraint
   backstop anywhere in `cron/auto-generate`, `cron/auto-publish`,
   `/api/projects/[id]/process`, `/api/projects/[id]/retry`, or
   `/api/brands/[id]/auto-content`. Protection today is 100% incidental
   (systemd's same-unit dedup + disjoint brandId scheduling), not designed.

2. **Unbounded fan-in to the final ffmpeg overlay call** (§4) — bounded by
   stat-overlay count from GPT extraction, not clip count, so it's a
   different variable than tonight's bug but the same *shape* of risk
   (single ffmpeg process, many simultaneous inputs). No cap found on
   `extractStatOverlays()` output size before it's threaded into
   `renderFinalVideo()`.

3. **Retry-without-true-idempotency for fal.ai** — `falRetry.ts:32-53`,
   3 attempts, and the code's own comment admits uncertainty about whether
   failed attempts are billed by fal.ai ("kita TIDAK PUNYA cara memastikan
   fal.ai benar2 charge percobaan gagal ini atau tidak"). Logged as `$0` by
   convention (honest labeling, not a confirmed-safe assumption) — worth
   periodic reconciliation against the actual fal.ai billing dashboard,
   which the code comment itself flags as the only source of truth.

4. **Config drift between servers is structural, not just possible** —
   `FFMPEG_MEMORY_MAX`/`FFMPEG_CPU_QUOTA` are `.env`-scoped and *intentionally*
   different per server (§2). `DATABASE_PATH` is local-file SQLite, so the
   two servers' data (cost logs, projects, publish history) never
   reconcile. Drizzle migrations must be run by hand on each. No sync/
   replication tooling exists.

5. **`call-endpoint.sh`'s own history is a live example of the timeout-vs-
   real-work mismatch class of bug**: curl was timing out (1700s) while the
   actual server-side batch kept running for up to an hour, producing
   false "failed" signals (fixed 2026-08-11 by raising to 10700s, see
   `call-endpoint.sh` comment). This is the *exact same bug family* as
   tonight's ffmpeg 20-min-too-short timeout — a hardcoded timeout that
   didn't account for legitimately-long real work, discovered reactively via
   a production incident, not by design review. Two independent instances of
   the same failure pattern in one codebase is a signal this class of bug
   (fixed timeouts vs. variable real-world work duration) is worth a
   systematic pass, not just point-fixes as each one is discovered.

6. **Quality Checker thresholds are tuned but not re-validated the way the
   duration gate was tonight** (§5, step 13) — same "reject expensive
   already-rendered work" shape as the bug fixed tonight, last touched
   2026-08-12, not revisited since despite the duration-gate sibling getting
   two rounds of real-data tuning tonight (2026-08-14). Worth checking
   whether any legitimate long-form renders have been silently hard-rejected
   by the silence/volume/black-frame thresholds the way duration was.

7. **Auto-Fix Ladder's `PRE_RENDER_TARGET_SECONDS` margin is explicitly
   unresolved** (`processProject.ts:581-600`) — code comment states the 15%
   margin (raised from flat +3s, then 8%) is "BELUM tervalidasi ulang dgn
   render nyata ke-3" as of the last edit. This is a known-open tuning
   question left in the codebase, not a hidden risk — flagging so it's not
   lost track of.

---

## 7. External API integration points — full list

| API | Triggered by | Cost | Slow-call behavior | Double-call behavior |
|---|---|---|---|---|
| **OpenAI chat.completions** (gpt-4.1-mini/gpt-4.1) | Idea gen, footage match, caption/hashtag/pillar/angle, AI Director, fact-check, similarity embedding | Token-based, logged centrally (`openaiClient.ts`, `llm_usage_log`) | No client-side timeout found in `openaiClient.ts` — relies on SDK/network default; a hang here would hang the whole `processProject()` call for that step | No retry wrapper for chat.completions found (unlike fal.ai) — a failure just throws and (for non-critical steps like fact-check/similarity) is caught and skipped; for critical steps (caption gen) it fails the whole project. No idempotency key sent to OpenAI — a client-side retry (not currently coded) would double-bill. **Cron-level double-trigger (§4) is the real duplicate-cost vector**, not client retry logic, since none exists here. |
| **OpenAI Whisper** | Raw footage transcription, TTS-audio re-transcription for subtitle timing | Per-minute, logged manually (`transcribe.ts`) | Per-file try/catch in `processProject.ts:376-381` — one slow/failing file doesn't block others | Called at most twice per project by design (raw footage once, TTS audio once) — no retry loop found |
| **OpenAI TTS** (`gpt-4o-mini-tts`) | Narration generation, `dubbing.ts` | Estimated $0.015/min audio (community estimate, not official — code admits this) | Chunked at 3800 chars/call (`MAX_CHARS_PER_CALL`) for long-form scripts — multiple sequential calls for one narration, no batching/parallelism found | No retry wrapper found in `dubbing.ts` for the TTS call itself |
| **fal.ai (Nano Banana 2)** | Poster/carousel-cover image generation, full-AI-generate poster path | ~$0.08/image (per code comment, cross-checked against Agus's own playground observation) | `subscribeFalWithRetry` handles this — 3 attempts, 2/4/6s backoff | **Genuine risk**: each retry is a new paid call; billing-on-failure is unconfirmed by fal.ai's API (code says so explicitly). 3x cost exposure on transient failures is a known, accepted tradeoff (documented), not a hidden bug. |
| **Buffer (GraphQL)** | Social publish for TikTok always, IG/FB/YouTube optionally | Not a per-call $ cost (subscription), but has a **daily request quota** (per project memory, ~250/day, previously exhausted) | `verifyPublishSucceeded` background-checks actual publish status async, doesn't block | `checkAndHandleDuplicate` mitigates Buffer's own known double-post bug; app-side idempotency is per-account via `publishLogs.status` check (§4 — has a race window, not airtight) |
| **YouTube Data API (native)** | Direct publish, alternative to Buffer for YouTube | Quota-based (Google API units), not $ | Token refresh (`ensureFreshYoutubeAccessToken`) proactively via daily cron; OAuth "Testing" app tokens hard-expire after 7 days idle — actively monitored | Publish idempotency same as Buffer path (per-account `publishLogs` check) |
| **Meta Graph API (native)** | Direct FB/IG publish, alternative to Buffer | Not $ per call | Not deeply audited this pass | Same idempotency model as above |
| **Pexels / Pixabay** | B-roll search/fill when brand footage insufficient | Free tier API, quota not $ | Search calls are sequential in the top-up loops (`processProject.ts:635-648`, `676-689`) with a bounded `maxAttempts` (gap-based, not unbounded) — explicitly designed to terminate, not an infinite-loop risk | Anti-repeat via `recentlyUsedUrls`/`usedBrollUrls` sets, not a cost concern (free tier) |
| **Cloudflare R2 (S3-compatible)** | All asset storage — raw footage upload (presigned, direct-from-browser), generated asset upload (server-side) | Storage $, not per-call | Not audited (infra-level, out of scope for pipeline risk) | N/A |
| **Telegram** | Publish-result notifications | Free (bot API) | Fire-and-forget, doesn't block | Not idempotency-sensitive (notification only) |
| **Tripay** | **Not used in this codebase** — confirmed via grep, zero references. No cross-contamination with PMS. | — | — | — |

**Highest cost-exposure summary**: fal.ai (explicit 3x-retry cost risk,
documented/accepted) and the **cron/manual-trigger double-processing gap**
(§4, undocumented/unmitigated) are the two real duplicate-paid-API-call
risks in this system. The fal.ai one is a known, accepted tradeoff with
honest logging. The cron-overlap one is not currently guarded at all and is
the single item from this audit most worth fixing before it causes a real
incident, given the near-miss pattern already visible in this system's own
git history (curl timeout vs. real work duration, discovered reactively
twice already for two different timeouts in one session).

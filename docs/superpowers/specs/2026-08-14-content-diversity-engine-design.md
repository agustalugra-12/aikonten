# Content Diversity Engine — Design Spec

**Status:** Draft for review
**Parent initiative:** PRD "AI Content Intelligence & Content Production System v2.0" (58 sections, pasted by Agus 2026-08-14) — this spec covers **Phase 1 only** of a 4-phase breakdown agreed with Agus. The other phases (Competitor Intelligence + SWOT, Analytics/Reporting extension, Learning/Optimization layer) are separate specs, not covered here.
**Applies to:** both KontenPilot deployments — server lama (`/root/kontenpilot-ai`, VPS Pelangi, this machine) and server baru (`admin@202.10.41.72`, VPS agustapstudio.com). Every deploy already ships to both (established pattern, see `docs/superpowers/plans/2026-08-14-render-tree-merge.md`) — no special handling needed beyond the normal deploy flow.

## Why this scope, why first

The parent PRD's own problem statement (§2) is explicit: content feels monotonous — same hooks, same structure, same footage, same angle, repeated too often. Of the PRD's 58 sections, this is the piece that:
- Directly targets the pain Agus described.
- Builds almost entirely on infrastructure that already exists and works (confirmed by direct code reading, not guesswork — see "What already exists" below).
- Needs zero new credentials, zero new third-party integrations, zero new infra (no embeddings service to stand up, no vector DB — reuses the existing OpenAI embedding call already wired for similarity).

Everything else in the parent PRD (Competitor Intelligence, SWOT, full Analytics/Reporting, Learning layer) is either genuinely from-zero or depends on data this phase doesn't produce — those are separate specs, sequenced after this one.

## What already exists (verified by reading the code, not the PRD's assumption of a blank slate)

- **`pickStructureTemplate()`** (`src/lib/ai/generateContent.ts:289`) picks a narrative structure **purely at random** from `VIDEO_STRUCTURE_TEMPLATES` (5 short-form) or `LONG_FORM_STRUCTURE_TEMPLATES` (2 long-form). No history awareness — the same structure can be picked twice in a row by chance. This already covers PRD §16 (Video Structure Engine) in spirit; it's missing the rotation/anti-repetition part (§53).
- **Hook is not a separate concept today** — it's the opening beat embedded inside each structure's `guide` text (e.g. "1) HOOK: 1 kalimat pembuka..."). The model writes it as prose, nothing classifies or tracks what kind of hook was used. PRD §14/15 (Hook Library + Hook Performance Learning) has no equivalent today.
- **Pillar/angle classification already happens** inside the single `generateCaptionAndHashtags()` / `generateCaptionForImages()` LLM call, via `buildClassificationFragment()` (`generateContent.ts:119`) — the same JSON response already returns `pillar` and `angle` (fixed 8-value enum, `CONTENT_ANGLES`), persisted on `projects.pillar` / `projects.angle`. This is the natural, zero-extra-cost place to add hook classification too.
- **Content similarity detection already exists and is live** (`src/lib/ai/contentSimilarity.ts`, `checkContentSimilarity()`): `projects.captionEmbedding` (OpenAI `text-embedding-3-small`, computed once per video project in `processProject.ts`) + `projects.similarityScore` (cosine similarity, 0–100) + `projects.similarToProjectId`. **Already compares against the last 20 video projects** of the same brand (`RECENT_PROJECTS_WINDOW = 20` in that file), taking the **max** score across the window (worst case) — this is more complete than I first assumed when scoping this spec; there is no "compare to last 1 only" gap to close. Deliberately **warning-only** (not blocking) — documented reason in `schema.ts:270-279`: no real data yet to calibrate a safe threshold, and a naive flat threshold blocking generation risks stopping Agus's production pipeline for false positives (explicit precedent cited: `web-pelangi/backend/scripts/seo_agent.py` cannibalization check needed "3 empirical revisions" before its threshold stopped being wrong 88% of the time). This is PRD §38 (Content Similarity Score), already built and working as designed — nothing to change here in this phase.
- **Footage anti-monotony is fully built and is the reference pattern to copy**: `footageVariety.ts` — `RECENT_PROJECTS_WINDOW = 5` (last 5 video projects of the brand), `getRecentlyUsedFootageUrls()` collects recently-used asset URLs to exclude, `getFootageUsageRecency()` + `selectBalancedRealFootage()` sort unused/oldest-last-used first. This is PRD §20 (Footage Diversity Engine), already shipped 2026-08-07.
- **Performance-informed content decisions already exist**: `performanceLearning.ts` syncs real per-post views/engagement rate from Buffer GraphQL (`Post.metrics` — verified live, not assumed) onto `projects.performanceViews` / `performanceEngagementRate`, and `buildPerformanceInsightBlock()` feeds avg-views-per-pillar into next-day idea scoring. This is a working slice of PRD §35 (AI Learning Loop) — noted here because it corrects an earlier survey I gave Agus that called Analytics "100% from scratch"; it isn't, though it's still missing weekly/monthly reports, PDF export, and a dashboard (later phase).

## Scope of this phase

1. **Hook classification** (tracking only, not a constraint on generation).
2. **Structure + hook rotation** — replace pure-random `pickStructureTemplate()` with least-recently-used-weighted selection, mirroring `footageVariety.ts`'s pattern exactly.
3. **Two new deterministic repetition signals** — structure-template repetition and hook-type repetition, computed alongside (not replacing or modifying) the existing embedding-based `checkContentSimilarity()`, which is left untouched.
4. **Bounded auto-regeneration** on high repetition (PRD §54) for the two *new* signals only — caption embedding similarity **stays warning-only** as-is; changing that system's behavior is out of scope here (Agus's own reasoning above for why it's warning-only still applies — no new calibration data appears in this phase).

Out of scope for this phase (explicitly): Competitor Intelligence, SWOT, Content Type Library as a formal 9-category taxonomy (pillars already serve this role per-brand and are out of scope to restructure here), Caption/Hashtag Intelligence variety (§41/42 — separate, smaller follow-up if wanted), Trend Adaptation, Content Fatigue Detection (§39 — needs performance data trends over time, belongs with the Analytics phase), Weekly/Monthly reports, PDF export, dashboard, AI Recommendation Center, Content Experiment Engine, Content Intelligence Score (§36 — a composite score across many signals this phase doesn't fully produce yet).

## Design

### 1. Hook classification

Add `hookType` to the same JSON contract `generateCaptionAndHashtags()` / `generateCaptionForImages()` already return (`pillar`, `angle`, `targetKeyword` live here today) — zero extra LLM calls. Fixed 11-value enum, taken directly from PRD §14 (this list is generic/domain-agnostic on purpose, unlike pillars which are legitimately per-brand):

```
curiosity | problem | contrarian | question | story | data | warning | direct_benefit | mystery | comparison | pattern_interrupt
```

`buildClassificationFragment()` gets one more sentence: `Sertakan juga hookType (WAJIB SALAH SATU PERSIS): "curiosity", "problem", ... - klasifikasi kategori hook/pembuka yang benar-benar dipakai di skrip ini.` Validated the same way `normalizeAngle()` already validates `angle` (reject anything outside the fixed list → `null`, never block generation on a bad classification).

**Schema change:** `projects.hookType: text("hook_type")` — same column style as `projects.pillar` (free TEXT, not a DB-level enum constraint, matching the existing convention immediately above it in `schema.ts`).

### 2. Structure + hook rotation (replaces pure-random selection)

New `src/lib/ai/contentVariety.ts` (parallel to `footageVariety.ts`, not merged into it — different data shape, different table, keeping files focused per this project's own file-size norms):

```ts
const RECENT_PROJECTS_WINDOW = 8; // vs footageVariety's 5 - deliberately larger: the
// template/hook pools here are much smaller (5-7 structures, 11 hook types) than the
// footage pool (dozens-hundreds of assets), so a 5-window would flag repetition too
// eagerly purely from pool exhaustion, not genuine monotony.

export async function getRecentStructureAndHookUsage(brandId: string): Promise<{
  structureCounts: Map<string, number>;
  hookTypeCounts: Map<string, number>;
}> // last N video projects of this brand, ordered by createdAt desc, tally
   // structureTemplate + hookType occurrences (mirrors getFootageUsageRecency's shape)
```

`pickStructureTemplate(target, brandId)` becomes async, weighted by inverse recent-usage count (unused/least-recently-used templates get picked first, matching `selectBalancedRealFootage`'s "oldest-last-used first" ordering) instead of `Math.random()`. Same function also returns which hook types have been used most recently, injected into the LLM prompt as an explicit avoid-list: `"Hook type yang SUDAH sering dipakai belakangan (hindari, cari sudut lain): curiosity (3x), problem (2x)."` — this is a **soft steer via prompt**, not a hard constraint (the model can still pick a repeated type if it's genuinely the best fit; the repetition check in step 3 is the actual backstop).

### 3. Two new deterministic repetition signals

`similarityScore`/`captionEmbedding` machinery (`contentSimilarity.ts`) is untouched by this phase — it already does what it needs to (20-project window, max score). What's new is purely additive, computed from `getRecentStructureAndHookUsage()`'s 8-project window (deliberately smaller than the embedding system's 20 — see the reasoning in §2 above: these pools have only 5-11 possible values each, so a 20-window would make "more than Nx" thresholds meaningless — nearly every value would exceed a low count purely from even rotation over 20 posts):

- `structureTemplate` repeated more than 2x in the window, or `hookType` repeated more than 3x in the window (thresholds chosen to roughly match the pool sizes — 2/7 structures ≈ 29% repeat rate, 3/11 hooks ≈ 27%, both flag before a pattern becomes the dominant one in the window rather than after).

### 4. Bounded auto-regeneration

When either new deterministic signal trips (structure or hook repeated past threshold) — **not** the existing embedding similarity score, which stays warning-only per the reasoning already on record in the schema:

1. Re-call `generateCaptionAndHashtags()` / `generateCaptionForImages()` once more, with an explicit instruction appended: `"Struktur '{name}' dan/atau hook tipe '{type}' sudah terlalu sering dipakai belakangan - WAJIB pilih struktur/hook YANG BEDA dari itu untuk konten ini."` (structure re-pick also happens: `pickStructureTemplate` runs again, now excluding the over-used template from the candidate pool for this retry).
2. **Max 2 regeneration attempts total** — matches the "don't burn API cost on retries" caution already established for this project (see feedback memory on accepting minor defects rather than auto-regenerating polish issues; this is stricter than that case since it's about actual repetition, not cosmetic flaws, but the cost discipline principle still applies). If still flagged after 2 retries, proceed with the last-generated version and log a warning (same pattern as the existing `similarityScore` warning-only path) rather than blocking the pipeline — a brand with a genuinely small pillar/topic pool (e.g. a brand that's only ever "day use homestay" content) will legitimately hit repetition often, and blocking production entirely for that is worse than an occasional repeat.

### Database changes (Drizzle migration)

```ts
// projects table, alongside existing pillar/angle columns:
hookType: text("hook_type"),
```

```ts
structureTemplate: text("structure_template"),
```

Confirmed by reading `processProject.ts` directly (not assumed): `structureTemplate` is already computed and returned from `generateCaptionAndHashtags()`, but currently **discarded** — never written to `projects` in any of the `db.update(projects).set({...})` calls (lines 797-811 persist `pillar`/`angle`/`targetKeyword`/etc. but not `structureTemplate`), and not surfaced in the UI anywhere (`src/app` has zero references to it) despite the field's own comment in `generateContent.ts:174-178` saying it's meant to be informational for Agus. This phase closes that gap as a natural side effect of adding rotation tracking — not a separate fix, the column simply needs to exist for the rotation logic in this spec to read history from.

Both new columns follow the codebase's own established convention (extend `projects` with more classification columns, as already done for `pillar`/`angle`) rather than introducing a new `content_hooks` table as the parent PRD's §50 schema sketch suggested — that table would just be a 1:1 shadow of columns already living on `projects`.

## Testing

- Unit tests for the pure logic: `getRecentStructureAndHookUsage()` tallying, weighted-selection ordering in `pickStructureTemplate`, and the two new repetition thresholds — no LLM/DB calls needed for the threshold math itself (extract as pure functions taking counts, matching this codebase's established pattern of extracting guard logic into pure, independently-testable functions — see `ai-chat-bot`'s `CLAUDE.md` for the sibling convention this repo doesn't yet formally document but already follows informally).
- One live end-to-end check post-implementation: generate a few projects back-to-back for a test brand, confirm `hookType`/`structureTemplate` vary and the regeneration path fires when forced (e.g. by seeding fake recent-history rows).

## Open questions for Agus before this becomes a plan

1. `RECENT_PROJECTS_WINDOW = 8` and the 2x/3x repetition thresholds above are my judgment calls, not yet validated against real data (same honest position the codebase already takes about the embedding-similarity threshold). Fine to ship as a starting point and tune later, or want different numbers now?
2. Should `hookType` also show up anywhere in the UI (e.g. next to `pillar`/`angle` on the project detail view), or is it purely internal bookkeeping for now until the later Reporting phase surfaces it?

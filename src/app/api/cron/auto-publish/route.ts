import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { brands, projects, publishLogs } from "@/db/schema";
import { eq, and, gte, lt, lte, inArray, desc } from "drizzle-orm";
import { nowTimeStringWita, todayDateKeyWita } from "@/lib/ai/researchTopics";
import { publishProject } from "@/lib/publish/orchestrate";
import { planMengizinkanAutoPosting } from "@/lib/billing/planGate";
import { pastikanAkunBolehGenerate } from "@/lib/billing/statusGate";
import { defaultGuardCfg, retryEligibility, scheduledEligibility, applyQuota, defaultCooldownCfg, classifyBufferError, runPublishCycle, type GuardCfg, type CooldownCfg, type PublishOutcome } from "@/lib/publish/guard";
import { makeGateCache, tripBreakerForProject, type BrandGate } from "@/lib/publish/publishGate";
import { assertLedgerReady, LedgerNotReadyError } from "@/lib/publish/ledger";

// Budget & breaker PER TOKEN (feat/publish-guard): publishGate.ts membaca ledger (countCalls30d), cooldown
// PERSISTEN buffer_token_state, dan kuota harian/bulanan per brand. Tidak ada lagi budget dari publish_logs
// maupun cooldown global in-memory. Semua call Buffer dicatat ledger di bufferGraphQL (bufferAuth.ts).
type Gate = (brandId: string) => Promise<BrandGate>;

// Outcome publishProject dari publish_logs TERBARU project (publishProject jarang throw utk error Buffer -
// dia catat per-akun lalu set status). Dipakai runPublishCycle utk deteksi breaker (token/rate).
async function publishOutcomeOf(projectId: string): Promise<PublishOutcome> {
  try {
    await publishProject(projectId);
  } catch (err) {
    return { ok: false, bufferError: String((err as Error)?.message || err) };
  }
  const [row] = await db.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId));
  if (row && (row.status === "published" || row.status === "partial")) return { ok: true };
  const [lastLog] = await db.select({ errorMessage: publishLogs.errorMessage }).from(publishLogs).where(eq(publishLogs.projectId, projectId)).orderBy(desc(publishLogs.createdAt)).limit(1);
  return { ok: false, bufferError: lastLog?.errorMessage ?? null };
}

// Manual Per-Post Scheduling (2026-08-25, PRD §26) - TERPISAH dari loop slot per-brand
// di bawah (itu utk brand.publishMode="auto" recurring, ini utk 1 draft spesifik yang
// Agus jadwalkan manual lewat POST /api/projects/[id]/schedule - apa pun publishMode
// brand-nya). Dicek SETIAP kali cron ini jalan (siklus sama dgn retryPartialPublishes,
// ~10-15 menit, lihat kontenpilot-auto-publish.timer) - toleransi keterlambatan alami
// dari cadence cron itu sendiri, tidak perlu TOLERANCE_MINUTES terpisah spt slot brand.
async function publishScheduledProjects(cfg: GuardCfg, nowMs: number, gate: Gate): Promise<{ published: Array<{ projectId: string; brandId: string }>; review: number; skippedFlag: number; skippedQuota: number; skippedGate: number; failed: number }> {
  const now = new Date();
  const due = await db
    .select()
    .from(projects)
    .where(and(eq(projects.status, "scheduled"), lte(projects.scheduledFor, now)));
  // feat/publish-guard: dalam grace -> kandidat publish; telat JAUH -> TINJAU (karantina skip_auto_publish, jangan
  // burst konten basi); skip_auto_publish -> dilewati.
  const candidates: typeof due = [];
  let review = 0, skippedFlag = 0;
  for (const p of due) {
    const v = scheduledEligibility({ id: p.id, brandId: p.brandId, scheduledForMs: p.scheduledFor ? new Date(p.scheduledFor).getTime() : nowMs, skipAutoPublish: !!p.skipAutoPublish }, nowMs, cfg);
    if (v.action === "publish") candidates.push(p);
    else if (v.action === "skip_flag") skippedFlag++;
    else {
      // Telat jauh -> KARANTINA dari auto-publish via skip_auto_publish=1 (tanpa ubah enum status):
      // keluar dari pemilihan otomatis (scheduledEligibility -> skip_flag di siklus berikut), tetap terlihat
      // di Draft/Review utk ditinjau/di-jadwal-ulang manual. Bukan langsung terbit.
      review++;
      await db.update(projects).set({ skipAutoPublish: true, errorMessage: `Scheduled terlambat > ${Math.round(cfg.scheduledGraceMs / 3600000)} jam — masuk tinjauan, tidak auto-terbit`, updatedAt: new Date() }).where(eq(projects.id, p.id));
    }
  }
  // Gate per token/brand (cooldown persisten, budget ledger, kuota harian/bulanan). Scheduled = publish BARU.
  let skippedGate = 0;
  const gated: typeof candidates = [];
  for (const p of candidates) {
    const g = await gate(p.brandId);
    if (g.allowNew) { gated.push(p); continue; }
    skippedGate++;
    // Tampilkan alasan JELAS di project (teknis Buffer / kuota harian internal - BUKAN kuota paket; kredit tak dipotong).
    if (g.message && p.errorMessage !== g.message) await db.update(projects).set({ errorMessage: g.message }).where(eq(projects.id, p.id));
  }
  const { selected, skippedQuota } = applyQuota(gated.map((p) => ({ id: p.id, brandId: p.brandId })), cfg);
  const selSet = new Set(selected.map((s) => s.id));
  const published: Array<{ projectId: string; brandId: string }> = [];
  let failed = 0;
  for (const p of gated.filter((c) => selSet.has(c.id))) {
    try {
      await publishProject(p.id);
      published.push({ projectId: p.id, brandId: p.brandId });
    } catch (err) {
      failed++;
      console.error(`[cron/auto-publish] gagal publish scheduled project ${p.id}:`, err);
    }
  }
  return { published, review, skippedFlag, skippedQuota: skippedQuota.length, skippedGate, failed };
}

// Retry publish "partial" (2026-08-07, permintaan Agus - "yang berhasil di uploud ke
// tiktok saja sedangkan fb dan ig gagal agar nanti di uploud ulang") - BEDA dari slot
// auto-publish di bawah (itu utk konten BARU yg belum pernah dicoba, cuma jalan kalau
// brand.publishMode="auto"). Retry ini utk publish yg SUDAH dicoba tapi sebagian akun
// gagal (status "partial", lihat orchestrate.ts) - berlaku ke SEMUA brand apa pun
// publishMode-nya (kegagalan platform bukan soal jadwal, itu bug/API sementara yg
// perlu diperbaiki, bukan preferensi jadwal publish). publishProject() SEKARANG
// idempotent per-akun (skip yg sudah "success") jadi aman dipanggil ulang.
//
// Backoff 2 jam (bukan retry tiap 15 menit tiap cron jalan) - supaya kegagalan yg
// masih berlangsung (mis. Buffer API down/rate limit sementara) tidak diulang-ulang
// tiap siklus cron & spam notifikasi Telegram tiap 15 menit, tapi tetap otomatis
// pulih dlm hari yg sama begitu API-nya normal lagi.
const RETRY_BACKOFF_HOURS = 2;

async function retryPartialPublishes(cfg: GuardCfg, nowMs: number, cooldownCfg: CooldownCfg, gate: Gate): Promise<{ retried: Array<{ projectId: string; brandId: string }>; skippedAge: number; skippedFlag: number; skippedQuota: number; skippedGate: number; failed: number; halted: "token_invalid" | "rate_limit" | null; haltedToken: string | null }> {
  const backoffCutoff = new Date(Date.now() - RETRY_BACKOFF_HOURS * 60 * 60 * 1000);
  const toRetry = await db
    .select()
    .from(projects)
    .where(and(eq(projects.status, "partial"), lt(projects.updatedAt, backoffCutoff)));

  // "failed" TOTAL yg SUDAH sempat coba publish (2026-08-07, permintaan Agus - laporan
  // nyata: konten Pelangi/Laundry In Bali sempat "tampil" [assets final SUDAH jadi]
  // lalu "hilang lagi" krn status jatuh ke "failed" - dicek langsung ke publishLogs,
  // penyebabnya BUKAN generate gagal [final_video/final_image SUDAH ada], murni Buffer
  // rate limit kena di SEMUA akun sekaligus [succeededIds.size===0 -> "failed", lihat
  // orchestrate.ts]. Beda dari "failed" krn generate gagal duluan [tidak pernah py
  // publishLogs sama sekali] - itu TETAP tidak di-auto-retry di sini (biar Agus pilih
  // sadar via tombol "Coba Lagi" manual, krn itu re-generate ulang yg ada biayanya).
  const failedWithAttempt = await db
    .select()
    .from(projects)
    .where(and(eq(projects.status, "failed"), lt(projects.updatedAt, backoffCutoff)));
  const failedIds = failedWithAttempt.map((p) => p.id);
  const logsForFailed = failedIds.length
    ? await db.select({ projectId: publishLogs.projectId }).from(publishLogs).where(inArray(publishLogs.projectId, failedIds))
    : [];
  const failedIdsWithPublishAttempt = new Set(logsForFailed.map((l) => l.projectId));
  const toRetryFailed = failedWithAttempt.filter((p) => failedIdsWithPublishAttempt.has(p.id));

  // feat/publish-guard: saring USIA + skip_auto_publish SEBELUM kuota -> konten lama tidak auto-terbit;
  // skip_auto_publish dihormati. Lalu kuota per-brand + total -> backlog besar TIDAK burst dalam 1 siklus.
  let skippedAge = 0, skippedFlag = 0;
  const eligible = [...toRetry, ...toRetryFailed].filter((p) => {
    const v = retryEligibility({ id: p.id, brandId: p.brandId, createdAtMs: new Date(p.createdAt).getTime(), skipAutoPublish: !!p.skipAutoPublish }, nowMs, cfg);
    if (!v.ok) { if (v.reason === "age") skippedAge++; else skippedFlag++; }
    return v.ok;
  });
  eligible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); // utamakan yg lebih baru
  // Gate per token/brand: cooldown persisten, budget ledger (retry berhenti di reserve), kuota harian/bulanan.
  let skippedGate = 0;
  const eligibleAfterDaily: typeof eligible = [];
  for (const e of eligible) { if ((await gate(e.brandId)).allowRetry) eligibleAfterDaily.push(e); else skippedGate++; }
  const brandOf = new Map(eligibleAfterDaily.map((e) => [e.id, e.brandId]));
  const { selected, skippedQuota } = applyQuota(eligibleAfterDaily.map((p) => ({ id: p.id, brandId: p.brandId })), cfg);
  // Circuit breaker: berhenti SEGERA pada token-invalid/rate-limit (jangan storm akun/konten lain).
  const cyc = await runPublishCycle(selected, (id) => publishOutcomeOf(id), { nowMs, cooldownCfg });
  // Cooldown PERSISTEN hanya utk token akun yang gagal (isolasi token; tahan restart).
  const haltedToken = cyc.halted && cyc.haltedAt ? await tripBreakerForProject(cyc.haltedAt, cyc.halted, nowMs, cooldownCfg) : null;
  return {
    retried: cyc.published.map((id) => ({ projectId: id, brandId: brandOf.get(id) ?? "" })),
    skippedAge, skippedFlag, skippedQuota: skippedQuota.length, skippedGate, failed: cyc.failed.length,
    halted: cyc.halted, haltedToken,
  };
}

// Cron #3 - utk brand publishMode="auto", SEBARKAN publish sepanjang hari sesuai berapa
// slot jam yg di-set (2026-08-06, revisi permintaan Agus - "auto publis mau di publis
// jam brapa aja menyesuaikan dengan jumlah konten yang ada").
//
// TIDAK LAGI backfill slot yg kelewat (2026-08-07, permintaan Agus eksplisit - "jika ke
// lewat jamnya biarkan saja nanti aku up sendri" - berlaku sama utk semua brand auto,
// bukan cuma satu). SEBELUM ini `slotsToFill = slotsElapsed - publishedTodayCount` -
// kalau cron sempat berhenti/telat jalan beberapa jam, begitu jalan lagi dia "mengejar"
// SEMUA slot yg kelewat sekaligus (publish beruntun beberapa konten langsung) - itu yg
// Agus MINTA DIHENTIKAN. Sekarang: HANYA slot yg BARU SAJA lewat (dlm TOLERANCE_MINUTES
// dari sekarang) yg dicoba - begitu jendela toleransi itu lewat TANPA ada konten
// ready/publish, slot itu dianggap terlewat SELAMANYA (Agus publish manual sendiri),
// TIDAK PERNAH dicoba lagi di slot-slot berikutnya hari yg sama.
//
// Dipanggil SERING (tiap 10-15 menit, lihat scripts/cron/kontenpilot-auto-publish.timer)
// - TOLERANCE_MINUTES (20) dipilih sedikit lebih lebar dari interval cron itu, supaya 1x
// keterlambatan wajar (cron misfire/restart) tidak langsung dianggap "kelewat", tapi
// tetap jauh dari cukup lebar utk "mengejar" slot dari berjam-jam lalu.
const TOLERANCE_MINUTES = 20;

function timeStringToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export async function POST(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  // Deploy aman: tabel ledger belum dimigrasi -> BERHENTI jelas (503), tidak publish apa pun.
  try {
    assertLedgerReady();
  } catch (e) {
    if (e instanceof LedgerNotReadyError) {
      console.error("[cron/auto-publish]", e.message);
      return NextResponse.json({ ok: false, error: e.message }, { status: 503 });
    }
    throw e;
  }
  const guardCfg = defaultGuardCfg();
  const cooldownCfg = defaultCooldownCfg();
  const nowMs = Date.now();
  const gate = makeGateCache(nowMs);

  const retry = await retryPartialPublishes(guardCfg, nowMs, cooldownCfg, gate);
  // Breaker baru trip -> hentikan siklus ini (jangan coba konten/akun lain); token itu cooldown persisten.
  const scheduled = !retry.halted
    ? await publishScheduledProjects(guardCfg, nowMs, gate)
    : { published: [] as Array<{ projectId: string; brandId: string }>, review: 0, skippedFlag: 0, skippedQuota: 0, skippedGate: 0, failed: 0 };

  const nowWita = nowTimeStringWita();
  const nowMinutes = timeStringToMinutes(nowWita);
  const autoBrands = await db.select().from(brands).where(eq(brands.publishMode, "auto"));
  const results: Array<{ brandId: string; name: string; slot: string; published: number; skipped?: string }> = [];

  // WITA (Asia/Makassar, UTC+8 tetap - tanpa DST) - offset fixed, aman dihitung manual
  // drpd date-fns-tz/dependency baru cuma utk 1 konversi ini.
  const todayKey = todayDateKeyWita();
  const startOfTodayWita = new Date(`${todayKey}T00:00:00+08:00`);

  // Slot publish BARU per-brand: hormati breaker + budget (publish baru diprioritaskan, tapi berhenti juga
  // kalau breaker trip atau budget habis supaya tak ikut menghabiskan limit Buffer).
  let slotHalted: string | null = null;
  for (const brand of (retry.halted ? [] : autoBrands)) {
    if (slotHalted) break;
    const g = await gate(brand.id);
    if (!g.allowNew) {
      results.push({ brandId: brand.id, name: brand.name, slot: "-", published: 0, skipped: `${g.reason}: ${g.message}` });
      continue;
    }
    // Automation dimatikan (2026-11-02) - skip auto-publish slot baru utk brand ini.
    // (retry partial & jadwal manual di atas TIDAK terpengaruh - itu penyelesaian kerja lama.)
    if (brand.automationPaused) {
      results.push({ brandId: brand.id, name: brand.name, slot: "-", published: 0, skipped: "automation dimatikan" });
      continue;
    }
    // (2026-09-30, T2a Fase 2) Gate paket + status saat PUBLISH (bukan cuma saat set mode
    // auto): brand milik akun yg paketnya TIDAK mengizinkan auto-posting, ATAU akunnya
    // sudah "terbatas" (langganan lewat masa tenggang), TIDAK boleh auto-publish walau
    // brand.publishMode masih "auto". Cegah kebocoran: akun turun/kadaluarsa tetap posting.
    if (!(await planMengizinkanAutoPosting(brand.userId))) {
      results.push({ brandId: brand.id, name: brand.name, slot: "-", published: 0, skipped: "paket tidak mengizinkan auto-posting" });
      continue;
    }
    try {
      await pastikanAkunBolehGenerate(brand.userId);
    } catch {
      results.push({ brandId: brand.id, name: brand.name, slot: "-", published: 0, skipped: "akun terbatas (langganan kadaluarsa)" });
      continue;
    }
    const slots: string[] = brand.autoPublishTimes ? JSON.parse(brand.autoPublishTimes) : [];
    // Slot yg BARU SAJA lewat (0 sampai TOLERANCE_MINUTES menit yg lalu) - BUKAN semua
    // slot yg sudah lewat sejak awal hari (itu backfill lama yg sekarang dihindari).
    const recentSlot = slots.find((t) => {
      const diff = nowMinutes - timeStringToMinutes(t);
      return diff >= 0 && diff <= TOLERANCE_MINUTES;
    });
    if (!recentSlot) continue;

    // Cek apakah SUDAH ada yg published SEJAK slot ini mulai (bukan cuma hitung total
    // hari ini) - idempotent, aman dipanggil berkali-kali dlm jendela toleransi yg sama
    // tanpa publish dobel.
    const slotStartWita = new Date(`${todayKey}T${recentSlot}:00+08:00`);
    const alreadyPublishedThisSlot = (
      await db
        .select()
        .from(projects)
        .where(and(eq(projects.brandId, brand.id), eq(projects.status, "published"), gte(projects.updatedAt, slotStartWita)))
    ).length > 0;
    if (alreadyPublishedThisSlot) continue;

    // skipAutoPublish dikecualikan (2026-08-10, lihat catatan lengkap di schema.ts) -
    // project hasil regenerasi manual/batch lama yg SENGAJA diminta Agus "diamkan di
    // draft" - tetap kelihatan di Draft Review, publish MANUAL tetap jalan, cuma tidak
    // pernah kepilih otomatis di sini.
    const [toPublish] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.brandId, brand.id),
          eq(projects.status, "ready"),
          eq(projects.skipAutoPublish, false),
          gte(projects.createdAt, startOfTodayWita)
        )
      )
      .orderBy(projects.createdAt)
      .limit(1);

    if (!toPublish) {
      // Tidak ada konten ready SAAT slot ini - slot dilewati PERMANEN (tidak backfill
      // begitu ada konten baru nanti), sesuai permintaan Agus.
      results.push({ brandId: brand.id, name: brand.name, slot: recentSlot, published: 0, skipped: "tidak ada konten ready" });
      continue;
    }

    const out = await publishOutcomeOf(toPublish.id);
    if (out.ok) {
      results.push({ brandId: brand.id, name: brand.name, slot: recentSlot, published: 1 });
    } else {
      const reason = classifyBufferError(out.bufferError);
      if (reason) {
        // #8 breaker: token invalid / rate limit -> pasang cooldown + HENTIKAN slot loop (jangan coba brand lain).
        await tripBreakerForProject(toPublish.id, reason, nowMs, cooldownCfg);
        slotHalted = reason;
        results.push({ brandId: brand.id, name: brand.name, slot: recentSlot, published: 0, skipped: `breaker:${reason}` });
        break;
      }
      results.push({ brandId: brand.id, name: brand.name, slot: recentSlot, published: 0, skipped: "publish gagal" });
    }
  }

  // feat/publish-guard #3: ringkasan jumlah (dipublish / dilewati-usia / dilewati-kuota / tinjau / gagal).
  const slotPublished = results.reduce((a, r) => a + (r.published || 0), 0);
  const counts = {
    published: retry.retried.length + scheduled.published.length + slotPublished,
    skipped_age: retry.skippedAge,
    skipped_quota: retry.skippedQuota + scheduled.skippedQuota,
    skipped_flag: retry.skippedFlag + scheduled.skippedFlag,
    scheduled_review: scheduled.review,
    failed: retry.failed + scheduled.failed,
    skipped_gate: retry.skippedGate + scheduled.skippedGate,
    halted: retry.halted ?? slotHalted,         // breaker reason (token_invalid/rate_limit) atau null
  };
  console.log("[cron/auto-publish] counts:", JSON.stringify(counts));
  return NextResponse.json({ ok: true, nowWita, counts, results, retriedPartial: retry.retried, publishedScheduled: scheduled.published });
}

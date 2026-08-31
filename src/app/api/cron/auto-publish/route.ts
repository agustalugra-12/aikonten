import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { brands, projects, publishLogs } from "@/db/schema";
import { eq, and, gte, lt, lte, inArray } from "drizzle-orm";
import { nowTimeStringWita, todayDateKeyWita } from "@/lib/ai/researchTopics";
import { publishProject } from "@/lib/publish/orchestrate";

// Manual Per-Post Scheduling (2026-08-25, PRD §26) - TERPISAH dari loop slot per-brand
// di bawah (itu utk brand.publishMode="auto" recurring, ini utk 1 draft spesifik yang
// Agus jadwalkan manual lewat POST /api/projects/[id]/schedule - apa pun publishMode
// brand-nya). Dicek SETIAP kali cron ini jalan (siklus sama dgn retryPartialPublishes,
// ~10-15 menit, lihat kontenpilot-auto-publish.timer) - toleransi keterlambatan alami
// dari cadence cron itu sendiri, tidak perlu TOLERANCE_MINUTES terpisah spt slot brand.
async function publishScheduledProjects(): Promise<Array<{ projectId: string; brandId: string }>> {
  const now = new Date();
  const due = await db
    .select()
    .from(projects)
    .where(and(eq(projects.status, "scheduled"), lte(projects.scheduledFor, now)));
  const published: Array<{ projectId: string; brandId: string }> = [];
  for (const p of due) {
    try {
      await publishProject(p.id);
      published.push({ projectId: p.id, brandId: p.brandId });
    } catch (err) {
      console.error(`[cron/auto-publish] gagal publish scheduled project ${p.id}:`, err);
    }
  }
  return published;
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

async function retryPartialPublishes(): Promise<Array<{ projectId: string; brandId: string }>> {
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

  const retried: Array<{ projectId: string; brandId: string }> = [];
  for (const p of [...toRetry, ...toRetryFailed]) {
    try {
      await publishProject(p.id);
      retried.push({ projectId: p.id, brandId: p.brandId });
    } catch (err) {
      console.error(`[cron/auto-publish] gagal retry project ${p.id}:`, err);
    }
  }
  return retried;
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

  const retriedPartial = await retryPartialPublishes();
  const publishedScheduled = await publishScheduledProjects();

  const nowWita = nowTimeStringWita();
  const nowMinutes = timeStringToMinutes(nowWita);
  const autoBrands = await db.select().from(brands).where(eq(brands.publishMode, "auto"));
  const results: Array<{ brandId: string; name: string; slot: string; published: number; skipped?: string }> = [];

  // WITA (Asia/Makassar, UTC+8 tetap - tanpa DST) - offset fixed, aman dihitung manual
  // drpd date-fns-tz/dependency baru cuma utk 1 konversi ini.
  const todayKey = todayDateKeyWita();
  const startOfTodayWita = new Date(`${todayKey}T00:00:00+08:00`);

  for (const brand of autoBrands) {
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

    try {
      await publishProject(toPublish.id);
      results.push({ brandId: brand.id, name: brand.name, slot: recentSlot, published: 1 });
    } catch (err) {
      console.error(`[cron/auto-publish] gagal publish project ${toPublish.id} brand ${brand.name}:`, err);
      results.push({ brandId: brand.id, name: brand.name, slot: recentSlot, published: 0, skipped: "publish gagal" });
    }
  }

  return NextResponse.json({ ok: true, nowWita, results, retriedPartial, publishedScheduled });
}

import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { brands, projects } from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { nowTimeStringWita, todayDateKeyWita } from "@/lib/ai/researchTopics";
import { publishProject } from "@/lib/publish/orchestrate";

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

    const [toPublish] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.brandId, brand.id), eq(projects.status, "ready"), gte(projects.createdAt, startOfTodayWita)))
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

  return NextResponse.json({ ok: true, nowWita, results });
}

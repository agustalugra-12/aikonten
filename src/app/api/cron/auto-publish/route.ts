import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { brands, projects } from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { nowTimeStringWita, todayDateKeyWita } from "@/lib/ai/researchTopics";
import { publishProject } from "@/lib/publish/orchestrate";

// Cron #3 - utk brand publishMode="auto", SEBARKAN publish sepanjang hari sesuai berapa
// slot jam yg di-set (2026-08-06, revisi permintaan Agus - "auto publis mau di publis
// jam brapa aja menyesuaikan dengan jumlah konten yang ada"). SEBELUM ini cuma 1 jam -
// begitu lewat, SEMUA project "ready" hari itu langsung diterbitkan sekaligus (numpuk 1
// waktu, kelihatan spam di sosmed). Sekarang: tiap slot jam yg SUDAH LEWAT & belum
// "dipakai" hari ini menerbitkan TEPAT 1 konten (bukan semua) - jadi kalau Agus set 5
// slot jam & py 5 konten ready, tersebar rapi ke 5 waktu berbeda; kalau konten LEBIH
// BANYAK dari jumlah slot, sisanya nunggu slot besok (bukan dipaksa terbit semua di
// slot terakhir) - Agus disarankan (lihat BrandSettingsSidebar) set jumlah slot kira2
// sama dgn target harian brand itu.
//
// Dipanggil SERING (tiap 10-15 menit, lihat scripts/cron/kontenpilot-auto-publish.timer)
// - BUKAN 1x/hari - krn tiap brand boleh py slot jam BEDA-BEDA & PALING BANYAK slot,
// jadwal tunggal per-hari tidak cukup fleksibel. Idempotent - "slot sudah dipakai"
// dihitung dari JUMLAH project yg SUDAH published hari ini (bukan flag terpisah), jadi
// aman dipanggil berkali-kali tanpa publish dobel: begitu jumlah published >= jumlah
// slot yg lewat, tidak ada lagi yg diterbitkan sampai slot berikutnya lewat.
export async function POST(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const nowWita = nowTimeStringWita();
  const autoBrands = await db.select().from(brands).where(eq(brands.publishMode, "auto"));
  const results: Array<{ brandId: string; name: string; published: number; failed: number }> = [];

  // WITA (Asia/Makassar, UTC+8 tetap - tanpa DST) - offset fixed, aman dihitung manual
  // drpd date-fns-tz/dependency baru cuma utk 1 konversi ini.
  const startOfTodayWita = new Date(`${todayDateKeyWita()}T00:00:00+08:00`);

  for (const brand of autoBrands) {
    const slots: string[] = brand.autoPublishTimes ? JSON.parse(brand.autoPublishTimes) : [];
    const slotsElapsed = slots.filter((t) => t <= nowWita).length;
    if (slotsElapsed === 0) continue;

    const publishedTodayCount = (
      await db
        .select()
        .from(projects)
        .where(and(eq(projects.brandId, brand.id), eq(projects.status, "published"), gte(projects.updatedAt, startOfTodayWita)))
    ).length;
    const slotsToFill = slotsElapsed - publishedTodayCount;
    if (slotsToFill <= 0) continue;

    const readyProjects = await db
      .select()
      .from(projects)
      .where(and(eq(projects.brandId, brand.id), eq(projects.status, "ready"), gte(projects.createdAt, startOfTodayWita)))
      .orderBy(projects.createdAt);
    const toPublish = readyProjects.slice(0, slotsToFill);

    let published = 0;
    let failed = 0;
    for (const project of toPublish) {
      try {
        await publishProject(project.id);
        published++;
      } catch (err) {
        console.error(`[cron/auto-publish] gagal publish project ${project.id} brand ${brand.name}:`, err);
        failed++;
      }
    }
    if (toPublish.length > 0) {
      results.push({ brandId: brand.id, name: brand.name, published, failed });
    }
  }

  return NextResponse.json({ ok: true, nowWita, results });
}

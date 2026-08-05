import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { brands, projects } from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { nowTimeStringWita, todayDateKeyWita } from "@/lib/ai/researchTopics";
import { publishProject } from "@/lib/publish/orchestrate";

// Cron #3 - utk brand publishMode="auto" yg JAM auto-publish-nya (WITA) SUDAH TERLEWATI
// (2026-08-06, permintaan Agus - "hasil generate akan diam di draft sampai jam yang
// ditentukan tiba sistem auto publis"). Dipanggil SERING (tiap 10-15 menit, lihat
// scripts/cron/kontenpilot-auto-publish.timer) - BUKAN 1x/hari - krn tiap brand boleh
// py jam auto-publish BEDA-BEDA, jadwal tunggal per-hari tidak cukup fleksibel utk itu.
// Idempotent secara alami - project yg SUDAH "published" tidak lagi masuk query
// status="ready", jadi aman kepanggil berkali-kali tanpa publish dobel.
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
    if (!brand.autoPublishTime || nowWita < brand.autoPublishTime) continue;

    const readyProjects = await db
      .select()
      .from(projects)
      .where(and(eq(projects.brandId, brand.id), eq(projects.status, "ready"), gte(projects.createdAt, startOfTodayWita)));

    let published = 0;
    let failed = 0;
    for (const project of readyProjects) {
      try {
        await publishProject(project.id);
        published++;
      } catch (err) {
        console.error(`[cron/auto-publish] gagal publish project ${project.id} brand ${brand.name}:`, err);
        failed++;
      }
    }
    if (readyProjects.length > 0) {
      results.push({ brandId: brand.id, name: brand.name, published, failed });
    }
  }

  return NextResponse.json({ ok: true, nowWita, results });
}

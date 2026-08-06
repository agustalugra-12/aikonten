import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { brands, dailyIdeas } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrGenerateDailyIdeas, markDailyIdeaUsed } from "@/lib/ai/dailyContentPlanner";
import { todayDateKeyWita } from "@/lib/ai/researchTopics";
import { runAutoContent } from "@/lib/pipeline/autoContent";

// Cron #2 - SEMUA brand, bukan cuma publishMode="auto" (2026-08-06, revisi permintaan
// Agus - "ketika owner buat setting 5 vidio 5 foto ini akan disiapkan idenya di rencana
// konten hari ini dan di jalankan secara otomatis"). SEBELUMNYA dibatasi publishMode=
// "auto" saja (mental model lama: draft = generate MAUPUN publish manual keduanya) -
// direvisi: draft/auto SEKARANG cuma ngatur tahap PUBLISH (lihat cron/auto-publish),
// GENERATE kontennya sendiri otomatis utk SEMUA brand sesuai target harian yg brand itu
// set (dailyVideoCount/dailySinglePhotoCount/dailyCarouselCount) - brand publishMode=
// "draft" hasilnya nongkrong di draft utk Agus review manual sebelum publish, brand
// publishMode="auto" hasilnya jg nongkrong "ready" dulu sampai autoPublishTimes-nya tiba
// (lihat auto-publish) - beda cuma di ujung (siapa yg klik publish), bukan di generate.
//
// SEKUENSIAL (bukan Promise.all paralel) SENGAJA - tiap render video/generate poster py
// beberapa panggilan API berbayar (OpenAI/fal.ai) + kerja CPU (ffmpeg) - jalan paralel utk
// SEMUA ide sekaligus bisa membebani VPS ini scr bersamaan (VPS yg sama jg jalankan PMS,
// AI Chat Bot, website publik). 1 ide gagal TIDAK menghentikan yg lain (try/catch per ide).
export async function POST(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const allBrands = await db.select().from(brands);
  const results: Array<{ brandId: string; name: string; generated: number; failed: number }> = [];

  for (const brand of allBrands) {
    await getOrGenerateDailyIdeas(brand.id); // idempotent - pastikan ide hari ini ada dulu
    const today = todayDateKeyWita();
    const todaysIdeas = await db
      .select()
      .from(dailyIdeas)
      .where(and(eq(dailyIdeas.brandId, brand.id), eq(dailyIdeas.date, today), eq(dailyIdeas.used, false)));

    let generated = 0;
    let failed = 0;
    for (const idea of todaysIdeas) {
      try {
        await runAutoContent(brand.id, idea.idea);
        await markDailyIdeaUsed(idea.id);
        generated++;
      } catch (err) {
        console.error(`[cron/auto-generate] gagal proses ide "${idea.idea.slice(0, 60)}..." brand ${brand.name}:`, err);
        failed++;
      }
    }
    results.push({ brandId: brand.id, name: brand.name, generated, failed });
  }

  return NextResponse.json({ ok: true, results });
}

import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { brands, dailyIdeas } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrGenerateDailyIdeas, markDailyIdeaUsed } from "@/lib/ai/dailyContentPlanner";
import { todayDateKeyWita } from "@/lib/ai/researchTopics";
import { runAutoContent } from "@/lib/pipeline/autoContent";
import { tryAcquireLock, releaseLock, brandAutoContentLockKey } from "@/lib/concurrency/locks";

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

  // Filter brandIds opsional (2026-08-12, permintaan Agus langsung - "pelangi dan laundry
  // jam 11 malam saja dan animal story jam 2.15 pagi, jeda yang aman") - insiden nyata hari
  // ini: render Animal Story & Co (long-form, banyak klip) pakai ~3GB RAM di VPS 3.8GB yg
  // sama dgn PMS+MongoDB, sempat bikin MongoDB tidak terjangkau (PMS ikut down). Batch
  // besar (Animal Story & Co, long-form berat) sekarang dipisah jamnya dari batch ringan
  // (Pelangi/Laundry, short-form) via 2 timer terpisah yg panggil endpoint SAMA ini dgn
  // query param brandIds beda (lihat scripts/cron/) - jeda ~3 jam supaya beban CPU/memori
  // tidak saling tumpuk. Tidak diisi (dipanggil manual/lama) = SEMUA brand, perilaku lama
  // tetap jalan apa adanya, backward-compatible.
  const brandIdsParam = req.nextUrl.searchParams.get("brandIds");
  const onlyBrandIds = brandIdsParam ? brandIdsParam.split(",").filter(Boolean) : null;

  const allBrandsRaw = await db.select().from(brands);
  const allBrands = onlyBrandIds ? allBrandsRaw.filter((b) => onlyBrandIds.includes(b.id)) : allBrandsRaw;
  const results: Array<{ brandId: string; name: string; generated: number; failed: number; skipped?: string }> = [];

  for (const brand of allBrands) {
    // Lock per-brand (2026-08-14, temuan #1 Lampiran D ENGINEERING_SAFETY.md / audit
    // kontenpilot §4/§6) - TIDAK ADA proteksi sebelumnya thd route ini dipanggil
    // BARENGAN (manual curl/systemctl start sementara run terjadwal masih jalan - lihat
    // riwayat call-endpoint.sh, curl timeout 1700dtk sementara kerja server tetap jalan
    // 1 jam penuh, skenario yg PLAUSIBLE mendorong operator re-trigger manual). Lock
    // dipegang utk SELURUH loop ide brand ini (bukan per-idea) - kalau invocation KEDUA
    // dtg utk brand yg SUDAH dipegang, SKIP BERSIH brand itu (log + catat di results,
    // TIDAK error-kan seluruh request) drpd jalankan pipeline berbayar (OpenAI+fal.ai+
    // TTS+ffmpeg) dobel utk ide yg sama. Key SAMA dipakai tombol manual "⚡" (lihat
    // brands/[id]/auto-content/route.ts) via brandAutoContentLockKey() - keduanya saling
    // block juga, bukan cuma dobel-cron.
    const lockKey = brandAutoContentLockKey(brand.id);
    if (!tryAcquireLock(lockKey)) {
      console.warn(`[cron/auto-generate] brand "${brand.name}" (${brand.id}) sedang diproses oleh proses lain - skip run ini, bukan dobel proses.`);
      results.push({ brandId: brand.id, name: brand.name, generated: 0, failed: 0, skipped: "brand sedang diproses proses lain" });
      continue;
    }

    try {
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
          // Threading contentType asli ide (2026-08-06, fix bug "video tidak ada malah
          // foto semua") - lihat catatan lengkap di autoContent.ts runAutoContent().
          await runAutoContent(
            brand.id, idea.idea, idea.contentType ?? undefined, idea.contentFormat ?? undefined,
            idea.youtubeSeriesId ?? undefined, idea.youtubeMetadata ?? undefined, idea.pillar ?? undefined
          );
          await markDailyIdeaUsed(idea.id);
          generated++;
        } catch (err) {
          console.error(`[cron/auto-generate] gagal proses ide "${idea.idea.slice(0, 60)}..." brand ${brand.name}:`, err);
          failed++;
        }
      }
      results.push({ brandId: brand.id, name: brand.name, generated, failed });
    } finally {
      releaseLock(lockKey);
    }
  }

  return NextResponse.json({ ok: true, results });
}

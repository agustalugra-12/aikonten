import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { brands, projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateCaptionAndHashtags, type BrandIdentityFields } from "@/lib/ai/generateContent";
import { runWithUsageContext } from "@/lib/ai/usageContext";
import { newId } from "@/lib/ids";

// Caption Only (2026-09-12, PRD - format ke-4 Buat Konten Stitch, jalur BARU disetujui
// Agus). REUSE engine caption existing (generateCaptionAndHashtags) - BUKAN mesin baru,
// BUKAN mock. Menghasilkan caption+hashtag dari prompt tanpa media/pipeline video/render.
// Ephemeral: dikembalikan ke UI utk disalin (belum dipersistensikan sbg project krn
// projects.type cuma video|carousel - persistensi caption-only = follow-up bila perlu).
// Cost tetap tercatat via runWithUsageContext (tidak kehilangan observability).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const body = await req.json().catch(() => ({}));
  const script = body?.script;
  if (typeof script !== "string" || script.trim().length < 3) {
    return NextResponse.json({ error: "script (prompt) wajib diisi" }, { status: 400 });
  }

  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });

  // Simpan-langsung (2026-09-12) - caption SUDAH dibuat di UI, tinggal disimpan sbg draft
  // tanpa regenerate (hemat biaya LLM). Buat project type "caption" ready+skipAutoPublish.
  if (body?.persist === true && typeof body.caption === "string" && body.caption.trim()) {
    const projectId = newId("proj");
    const now = new Date();
    await db.insert(projects).values({
      id: projectId,
      brandId,
      type: "caption",
      status: "ready",
      skipAutoPublish: true,
      script: script.trim(),
      generatedCaption: body.caption,
      generatedHashtags: JSON.stringify(Array.isArray(body.hashtags) ? body.hashtags : []),
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ ok: true, caption: body.caption, hashtags: body.hashtags || [], projectId });
  }

  const identity: BrandIdentityFields = {
    niche: brand.niche,
    targetAudience: brand.targetAudience,
    positioning: brand.positioning,
    contentGoals: brand.contentGoals,
    toneOfVoice: brand.toneOfVoice,
    preferredTopics: brand.preferredTopics,
    prohibitedTopics: brand.prohibitedTopics,
    contentBoundaries: brand.contentBoundaries,
    eduEntertainmentRatio: brand.eduEntertainmentRatio,
    ctaStyle: brand.ctaStyle,
  };

  try {
    const result = await runWithUsageContext({ brandId, projectId: undefined }, () =>
      generateCaptionAndHashtags(
        brand.name,
        script.trim(),
        "", // tanpa klip/media
        brand.knowledgeSite,
        brand.manualKnowledge,
        60,
        brand.contentPillars,
        brandId,
        [], [], [], [], [],
        identity
      )
    );
    // Persist opsional (2026-09-12) - simpan sbg project type "caption" supaya muncul
    // di Konten/DraftReview & bisa dijadwalkan/dipublish (teks) lewat alur existing.
    // status "ready" + skipAutoPublish=true: tampil utk review, TIDAK auto-fire lewat
    // cron slot - user publish/jadwal manual (reuse /publish & /schedule).
    let projectId: string | null = null;
    if (body?.persist === true) {
      projectId = newId("proj");
      const now = new Date();
      await db.insert(projects).values({
        id: projectId,
        brandId,
        type: "caption",
        status: "ready",
        skipAutoPublish: true,
        script: script.trim(),
        generatedCaption: result.caption,
        generatedHashtags: JSON.stringify(result.hashtags),
        createdAt: now,
        updatedAt: now,
      });
    }
    return NextResponse.json({ ok: true, caption: result.caption, hashtags: result.hashtags, projectId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message || "Gagal membuat caption" }, { status: 500 });
  }
}

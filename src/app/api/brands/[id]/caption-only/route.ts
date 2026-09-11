import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateCaptionAndHashtags, type BrandIdentityFields } from "@/lib/ai/generateContent";
import { runWithUsageContext } from "@/lib/ai/usageContext";

// Caption Only (2026-09-12, PRD - format ke-4 Buat Konten Stitch, jalur BARU disetujui
// Agus). REUSE engine caption existing (generateCaptionAndHashtags) - BUKAN mesin baru,
// BUKAN mock. Menghasilkan caption+hashtag dari prompt tanpa media/pipeline video/render.
// Ephemeral: dikembalikan ke UI utk disalin (belum dipersistensikan sbg project krn
// projects.type cuma video|carousel - persistensi caption-only = follow-up bila perlu).
// Cost tetap tercatat via runWithUsageContext (tidak kehilangan observability).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const { script } = await req.json().catch(() => ({}));
  if (typeof script !== "string" || script.trim().length < 3) {
    return NextResponse.json({ error: "script (prompt) wajib diisi" }, { status: 400 });
  }

  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });

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
    return NextResponse.json({ ok: true, caption: result.caption, hashtags: result.hashtags });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message || "Gagal membuat caption" }, { status: 500 });
  }
}

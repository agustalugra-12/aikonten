import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { manualIdeas } from "@/db/schema";
import { and, eq, isNotNull, desc } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { analyzeInspiration } from "@/lib/agustap/inspirationAnalyzer";

// Content Inspiration (PRD Agustap Studio §2.1.B, §2.13, §2.16, 2026-09-02) -
// REUSE tabel `manual_ideas` existing (docs/REUSE_MAP.md) - source="agustap_content_inspiration"
// jadi penanda row ini beda dari excel-import biasa, `used` reuse semantik "sudah
// dipakai generate atau belum" (§2.1.B "dapat dipilih kembali").
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const rows = await db
    .select()
    .from(manualIdeas)
    .where(and(eq(manualIdeas.brandId, brandId), isNotNull(manualIdeas.inspirationPrinciples)))
    .orderBy(desc(manualIdeas.createdAt));
  return NextResponse.json({ inspirations: rows });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const body = await req.json();
  const { referenceUrl, transcript, summary, screenshotDescription, creatorName, userNote } = body as {
    referenceUrl?: string;
    transcript?: string;
    summary?: string;
    screenshotDescription?: string;
    creatorName?: string;
    userNote?: string;
  };

  const result = await analyzeInspiration({ referenceUrl, transcript, summary, screenshotDescription, creatorName, userNote });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, detail: result.detail }, { status: 422 });
  }

  const now = new Date();
  const row = {
    id: newId("insp"),
    brandId,
    idea: result.principles.topic || result.principles.angle || `Inspirasi dari ${referenceUrl || "input manual"}`,
    source: "agustap_content_inspiration",
    used: false,
    createdAt: now,
    sourceUrl: referenceUrl || null,
    inspirationPrinciples: JSON.stringify(result.principles),
    creatorName: creatorName || null,
  };
  await db.insert(manualIdeas).values(row);
  return NextResponse.json({ inspiration: row, sourceUsed: result.sourceUsed });
}

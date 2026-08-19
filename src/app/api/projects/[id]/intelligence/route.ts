import { NextRequest, NextResponse } from "next/server";
import { calculateContentIntelligence } from "@/lib/ai/contentIntelligence";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const project = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!project.length) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const p = project[0];
    const result = await calculateContentIntelligence(p.brandId, {
      pillar: p.pillar,
      hookType: p.hookType,
      structureTemplate: p.structureTemplate,
      similarityScore: p.similarityScore,
      generatedCaption: p.generatedCaption,
      contentType: p.contentTypeId,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { calculateContentIntelligence } from "@/lib/ai/contentIntelligence";
import { getUserId, getOwnedProject } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  try {
    const p = await getOwnedProject(userId, id);
    if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const result = await calculateContentIntelligence(p.brandId, {
      pillar: p.pillar,
      hookType: p.hookType,
      structureTemplate: p.structureTemplate,
      similarityScore: p.similarityScore,
      generatedCaption: p.generatedCaption,
      contentType: p.contentTypeId,
      script: p.script,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

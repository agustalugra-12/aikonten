import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mediaAssets, publishLogs, projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runPrePublishQC } from "@/lib/ai/prePublishQC";
import { getUserId, getOwnedProject } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  const project = await getOwnedProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  const assets = await db.select().from(mediaAssets).where(eq(mediaAssets.projectId, id));
  return NextResponse.json({ ...project, assets });
}

// Tolak/hapus draft (2026-08-04, permintaan Agus - dipakai DraftReview.tsx kalau
// hasil AI tidak dipakai). Hapus baris terkait dulu (media_assets/publish_logs) sblm
// project-nya sendiri - schema tidak pakai FK cascade.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  if (!(await getOwnedProject(userId, id))) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  await db.delete(publishLogs).where(eq(publishLogs.projectId, id));
  await db.delete(mediaAssets).where(eq(mediaAssets.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
  return NextResponse.json({ ok: true });
}

// Pre-Publishing QC (PRD §37) - quality check sebelum publish
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  const project = await getOwnedProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  const result = await runPrePublishQC(project.brandId, {
    id: project.id,
    generatedCaption: project.generatedCaption,
    generatedHashtags: project.generatedHashtags,
    similarityScore: project.similarityScore,
    pillar: project.pillar,
    retentionRisks: project.retentionRisks,
    factCheckConfidence: project.factCheckConfidence,
    factCheckFlags: project.factCheckFlags,
  });
  return NextResponse.json(result);
}

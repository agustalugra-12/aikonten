import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mediaAssets, publishLogs, projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runPrePublishQC } from "@/lib/ai/prePublishQC";
import { getUserId, getOwnedProject } from "@/lib/session";

// Edit teks di Studio preview (2026-10-05, Fase A - permintaan Agus) - owner ubah
// judul(script)/caption/hashtag tanpa re-generate. Hanya field TEKS; aset tak disentuh.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  if (!(await getOwnedProject(userId, id))) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  if (typeof body.script === "string") update.script = body.script;
  if (typeof body.generatedCaption === "string") update.generatedCaption = body.generatedCaption;
  if ("generatedHashtags" in body) {
    const h = body.generatedHashtags;
    const arr = Array.isArray(h)
      ? h.filter((x: unknown): x is string => typeof x === "string")
      : typeof h === "string"
        ? h.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean)
        : [];
    update.generatedHashtags = JSON.stringify(arr);
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Tidak ada field untuk diubah" }, { status: 400 });
  }
  update.updatedAt = new Date();
  await db.update(projects).set(update).where(eq(projects.id, id));
  const [updated] = await db.select().from(projects).where(eq(projects.id, id));
  return NextResponse.json(updated);
}

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

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, mediaAssets, publishLogs } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  const assets = await db.select().from(mediaAssets).where(eq(mediaAssets.projectId, id));
  return NextResponse.json({ ...project, assets });
}

// Tolak/hapus draft (2026-08-04, permintaan Agus - dipakai DraftReview.tsx kalau
// hasil AI tidak dipakai). Hapus baris terkait dulu (media_assets/publish_logs) sblm
// project-nya sendiri - schema tidak pakai FK cascade.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  await db.delete(publishLogs).where(eq(publishLogs.projectId, id));
  await db.delete(mediaAssets).where(eq(mediaAssets.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
  return NextResponse.json({ ok: true });
}

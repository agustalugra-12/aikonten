import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, mediaAssets } from "@/db/schema";
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

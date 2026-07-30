import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createPresignedUploadUrl, buildAssetKey } from "@/lib/storage";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { filename, contentType } = await req.json();
  if (typeof filename !== "string" || !filename) {
    return NextResponse.json({ error: "filename wajib diisi" }, { status: 400 });
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }

  const key = buildAssetKey(project.brandId, project.id, filename);
  const { uploadUrl, publicUrl } = await createPresignedUploadUrl(
    key,
    contentType || "application/octet-stream"
  );

  return NextResponse.json({ uploadUrl, publicUrl });
}

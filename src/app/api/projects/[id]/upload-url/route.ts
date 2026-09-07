import { NextRequest, NextResponse } from "next/server";
import { createPresignedUploadUrl, buildAssetKey } from "@/lib/storage";
import { getUserId, getOwnedProject } from "@/lib/session";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  const { filename, contentType } = await req.json();
  if (typeof filename !== "string" || !filename) {
    return NextResponse.json({ error: "filename wajib diisi" }, { status: 400 });
  }

  const project = await getOwnedProject(userId, id);
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

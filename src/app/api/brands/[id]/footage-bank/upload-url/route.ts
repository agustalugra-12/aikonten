import { NextRequest, NextResponse } from "next/server";
import { createPresignedUploadUrl, buildAssetKey } from "@/lib/storage";

// Sama persis pola presign upload project (lihat /api/projects/[id]/upload-url) -
// bedanya keynya pakai "bank" sbg pengganti projectId krn footage bank milik BRAND,
// bukan 1 project.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const { filename, contentType } = await req.json();
  if (typeof filename !== "string" || !filename) {
    return NextResponse.json({ error: "filename wajib diisi" }, { status: 400 });
  }

  const key = buildAssetKey(brandId, "bank", filename);
  const { uploadUrl, publicUrl } = await createPresignedUploadUrl(key, contentType || "application/octet-stream");
  return NextResponse.json({ uploadUrl, publicUrl });
}

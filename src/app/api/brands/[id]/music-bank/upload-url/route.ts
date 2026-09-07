import { NextRequest, NextResponse } from "next/server";
import { createPresignedUploadUrl, buildAssetKey } from "@/lib/storage";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Sama pola persis footage-bank/upload-url (lihat file itu) - "bank" sbg pengganti
// projectId krn Music Bank milik BRAND, bukan 1 project.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const { filename, contentType } = await req.json();
  if (typeof filename !== "string" || !filename) {
    return NextResponse.json({ error: "filename wajib diisi" }, { status: 400 });
  }

  const key = buildAssetKey(brandId, "music-bank", filename);
  const { uploadUrl, publicUrl } = await createPresignedUploadUrl(key, contentType || "application/octet-stream");
  return NextResponse.json({ uploadUrl, publicUrl });
}

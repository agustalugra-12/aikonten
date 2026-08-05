import { NextRequest, NextResponse } from "next/server";
import { createPresignedUploadUrl, buildAssetKey } from "@/lib/storage";

// Presign upload logo brand (2026-08-05, permintaan Agus) - pola SAMA PERSIS dgn
// footage-bank/upload-url (key pakai "logo" sbg pengganti projectId, milik BRAND bukan
// 1 project). Setelah PUT sukses, publicUrl-nya disimpan via PATCH /api/brands/[id].
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const { filename, contentType } = await req.json();
  if (typeof filename !== "string" || !filename) {
    return NextResponse.json({ error: "filename wajib diisi" }, { status: 400 });
  }

  const key = buildAssetKey(brandId, "logo", filename);
  const { uploadUrl, publicUrl } = await createPresignedUploadUrl(key, contentType || "application/octet-stream");
  return NextResponse.json({ uploadUrl, publicUrl });
}

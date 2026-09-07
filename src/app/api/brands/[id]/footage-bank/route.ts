import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { footageBank } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { describeFootage } from "@/lib/ai/describeFootage";
import { extractVideoFrame } from "@/lib/render/cloudinary";
import { getUserId, getOwnedBrand } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const rows = await db
    .select()
    .from(footageBank)
    .where(eq(footageBank.brandId, brandId))
    .orderBy(desc(footageBank.createdAt));
  return NextResponse.json(rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) })));
}

// "Footage Bank" (lihat memory proyek) - daftarkan 1 file yg SUDAH diupload (lewat
// upload-url di atas) ke bank brand ini, lalu AI otomatis deskripsikan+tag isinya -
// Agus TIDAK perlu ketik deskripsi manual.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const { fileUrl, mediaType, durationSeconds, categoryId } = await req.json();

  if (typeof fileUrl !== "string" || !fileUrl) {
    return NextResponse.json({ error: "fileUrl wajib diisi" }, { status: 400 });
  }
  if (mediaType !== "video" && mediaType !== "image") {
    return NextResponse.json({ error: "mediaType harus 'video' atau 'image'" }, { status: 400 });
  }
  if (categoryId !== undefined && categoryId !== null && typeof categoryId !== "string") {
    return NextResponse.json({ error: "categoryId harus string atau null" }, { status: 400 });
  }

  try {
    // Video butuh 1 frame dulu (AI tidak bisa "lihat" video langsung) - foto langsung
    // dianalisis apa adanya. Frame ini SEKARANG disimpan sbg posterUrl (2026-08-06,
    // laporan Agus "vidio berputar terus" di Bank Footage) - dulu cuma dipakai sekali
    // utk analisis AI vision lalu dibuang, sekarang di-reuse sbg <video poster> di UI
    // supaya thumbnail tampil instan tanpa perlu browser fetch file video asli (bisa
    // 40-90MB) - lihat FootageBankDialog.tsx.
    const imageForAnalysis = mediaType === "video" ? await extractVideoFrame(fileUrl, 1) : fileUrl;
    const { description, tags } = await describeFootage(imageForAnalysis);

    const row = {
      id: newId("bank"),
      brandId,
      mediaType: mediaType as "video" | "image",
      fileUrl,
      description,
      tags: JSON.stringify(tags),
      durationSeconds: durationSeconds ?? null,
      categoryId: categoryId ?? null,
      posterUrl: mediaType === "video" ? imageForAnalysis : null,
      createdAt: new Date(),
    };
    await db.insert(footageBank).values(row);
    return NextResponse.json({ ...row, tags }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

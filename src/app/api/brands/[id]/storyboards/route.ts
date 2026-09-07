import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { storyboards } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { generateStoryboard } from "@/lib/ai/storyboard";
import { newId } from "@/lib/ids";
import { getUserId, getOwnedBrand } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const rows = await db
    .select()
    .from(storyboards)
    .where(eq(storyboards.brandId, brandId))
    .orderBy(desc(storyboards.createdAt));
  return NextResponse.json(
    rows.map((r) => ({ ...r, scenes: JSON.parse(r.scenes) }))
  );
}

// "Storyboard Engine" - shot list PRA-produksi (lihat memory proyek), TIDAK terhubung
// ke pipeline upload/process project yg sudah ada - Agus generate ini SEBELUM syuting,
// baca sbg panduan, baru upload footage asli spt biasa lewat "+ Konten Baru".
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  const { script } = await req.json();
  if (typeof script !== "string" || !script.trim()) {
    return NextResponse.json({ error: "Skrip/topik wajib diisi" }, { status: 400 });
  }

  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  try {
    const scenes = await generateStoryboard(script, brand.name);
    const row = {
      id: newId("storyboard"),
      brandId,
      script,
      scenes: JSON.stringify(scenes),
      createdAt: new Date(),
    };
    await db.insert(storyboards).values(row);
    return NextResponse.json({ ...row, scenes }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

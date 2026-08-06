import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { footageCategories, footageBank } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  const { name } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name wajib diisi" }, { status: 400 });
  }
  await db.update(footageCategories).set({ name: name.trim() }).where(eq(footageCategories.id, categoryId));
  const [updated] = await db.select().from(footageCategories).where(eq(footageCategories.id, categoryId));
  if (!updated) return NextResponse.json({ error: "Kategori tidak ditemukan" }, { status: 404 });
  return NextResponse.json(updated);
}

// Hapus kategori - footage yg tadinya pakai kategori ini DILEPAS (category_id -> null),
// BUKAN ikut terhapus (footage-nya tetap ada di bank, cuma jadi "belum dikategorikan"
// lagi) - hapus kategori seharusnya tidak pernah menghilangkan footage asli Agus.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  await db.update(footageBank).set({ categoryId: null }).where(eq(footageBank.categoryId, categoryId));
  await db.delete(footageCategories).where(eq(footageCategories.id, categoryId));
  return NextResponse.json({ ok: true });
}

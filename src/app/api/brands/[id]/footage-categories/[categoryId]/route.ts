import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { footageCategories, footageBank } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserId, getOwnedBrand } from "@/lib/session";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; categoryId: string }> }) {
  const userId = getUserId(req);
  const { id: brandId, categoryId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const { name } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name wajib diisi" }, { status: 400 });
  }
  const [existing] = await db.select({ id: footageCategories.id }).from(footageCategories).where(and(eq(footageCategories.id, categoryId), eq(footageCategories.brandId, brandId)));
  if (!existing) return NextResponse.json({ error: "Kategori tidak ditemukan" }, { status: 404 });
  await db.update(footageCategories).set({ name: name.trim() }).where(eq(footageCategories.id, categoryId));
  const [updated] = await db.select().from(footageCategories).where(eq(footageCategories.id, categoryId));
  return NextResponse.json(updated);
}

// Hapus kategori - footage yg tadinya pakai kategori ini DILEPAS (category_id -> null),
// BUKAN ikut terhapus (footage-nya tetap ada di bank, cuma jadi "belum dikategorikan"
// lagi) - hapus kategori seharusnya tidak pernah menghilangkan footage asli.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; categoryId: string }> }) {
  const userId = getUserId(req);
  const { id: brandId, categoryId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const [existing] = await db.select({ id: footageCategories.id }).from(footageCategories).where(and(eq(footageCategories.id, categoryId), eq(footageCategories.brandId, brandId)));
  if (!existing) return NextResponse.json({ error: "Kategori tidak ditemukan" }, { status: 404 });
  await db.update(footageBank).set({ categoryId: null }).where(eq(footageBank.categoryId, categoryId));
  await db.delete(footageCategories).where(eq(footageCategories.id, categoryId));
  return NextResponse.json({ ok: true });
}

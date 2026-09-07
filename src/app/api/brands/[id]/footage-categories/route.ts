import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { footageCategories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Kategori Footage Bank manual per-brand (2026-08-06, permintaan Agus - "taman halaman,
// kamar, dapur, dan lainnya"). Lihat schema.ts footageCategories utk alasan lengkap.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const rows = await db
    .select()
    .from(footageCategories)
    .where(eq(footageCategories.brandId, brandId));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const { name } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name wajib diisi" }, { status: 400 });
  }

  const row = {
    id: newId("cat"),
    brandId,
    name: name.trim(),
    createdAt: new Date(),
  };
  await db.insert(footageCategories).values(row);
  return NextResponse.json(row, { status: 201 });
}

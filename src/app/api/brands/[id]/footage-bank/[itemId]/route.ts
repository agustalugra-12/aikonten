import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { footageBank } from "@/db/schema";
import { eq } from "drizzle-orm";

// Assign/lepas kategori manual per item footage (2026-08-06, permintaan Agus - lihat
// schema.ts footageCategories). categoryId: null = "belum dikategorikan".
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const { categoryId } = await req.json();
  if (categoryId !== null && typeof categoryId !== "string") {
    return NextResponse.json({ error: "categoryId harus string atau null" }, { status: 400 });
  }
  await db.update(footageBank).set({ categoryId }).where(eq(footageBank.id, itemId));
  const [updated] = await db.select().from(footageBank).where(eq(footageBank.id, itemId));
  if (!updated) return NextResponse.json({ error: "Footage tidak ditemukan" }, { status: 404 });
  return NextResponse.json({ ...updated, tags: JSON.parse(updated.tags) });
}

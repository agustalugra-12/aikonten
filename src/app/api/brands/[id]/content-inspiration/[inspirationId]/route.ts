import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { manualIdeas } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Isolasi (2026-09-07, Fase 1 Alur D) - manualIdeas TIDAK punya userId langsung,
// kepemilikan lewat brandId (params.id) -> getOwnedBrand, DAN inspirationId yang
// diminta HARUS milik brandId itu (bukan milik brand lain).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; inspirationId: string }> }) {
  const userId = getUserId(req);
  const { id: brandId, inspirationId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const [existing] = await db.select({ id: manualIdeas.id }).from(manualIdeas).where(and(eq(manualIdeas.id, inspirationId), eq(manualIdeas.brandId, brandId)));
  if (!existing) {
    return NextResponse.json({ error: "Inspirasi tidak ditemukan" }, { status: 404 });
  }
  await db.delete(manualIdeas).where(eq(manualIdeas.id, inspirationId));
  return NextResponse.json({ ok: true });
}

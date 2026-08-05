import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { eq } from "drizzle-orm";

// Update brand - dipakai skrng khusus utk simpan logoUrl (2026-08-05, permintaan Agus)
// setelah upload logo sukses (lihat logo-upload-url/route.ts + BrandLogoDialog.tsx).
// PATCH (bukan PUT) - update sebagian field, konsisten dgn pola REST project lain.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { logoUrl } = await req.json();
  if (logoUrl !== null && typeof logoUrl !== "string") {
    return NextResponse.json({ error: "logoUrl harus string atau null" }, { status: 400 });
  }

  const [existing] = await db.select().from(brands).where(eq(brands.id, id));
  if (!existing) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  await db.update(brands).set({ logoUrl }).where(eq(brands.id, id));
  const [updated] = await db.select().from(brands).where(eq(brands.id, id));
  return NextResponse.json(updated);
}

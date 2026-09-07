import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { musicBank } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { deleteObject, keyFromPublicUrl } from "@/lib/storage";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Hapus track dari Music Bank - sama pola gagal-lunak dgn footage-bank DELETE (hapus
// file storage gagal TIDAK menghalangi hapus record DB).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const userId = getUserId(req);
  const { id: brandId, itemId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const [item] = await db.select().from(musicBank).where(and(eq(musicBank.id, itemId), eq(musicBank.brandId, brandId)));
  if (!item) return NextResponse.json({ error: "Track tidak ditemukan" }, { status: 404 });

  const key = keyFromPublicUrl(item.fileUrl);
  if (key) {
    try {
      await deleteObject(key);
    } catch (err) {
      console.error(`[music-bank DELETE] gagal hapus file storage utk ${itemId}:`, err);
    }
  }
  await db.delete(musicBank).where(eq(musicBank.id, itemId));
  return NextResponse.json({ ok: true });
}

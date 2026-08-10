import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { musicBank } from "@/db/schema";
import { eq } from "drizzle-orm";
import { deleteObject, keyFromPublicUrl } from "@/lib/storage";

// Hapus track dari Music Bank - sama pola gagal-lunak dgn footage-bank DELETE (hapus
// file storage gagal TIDAK menghalangi hapus record DB).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const [item] = await db.select().from(musicBank).where(eq(musicBank.id, itemId));
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

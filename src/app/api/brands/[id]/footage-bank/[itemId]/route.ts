import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { footageBank } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { deleteObject, keyFromPublicUrl } from "@/lib/storage";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Isolasi (2026-09-07, Fase 1 Alur D) - versi LAMA (repo asal) tidak cek brand SAMA
// SEKALI di sini (signature bahkan tidak ambil params.id) - fork INI wajib pastikan
// itemId yang diminta BENAR milik brand yang dimiliki userId yang login.

// Assign/lepas kategori manual per item footage (2026-08-06, permintaan Agus - lihat
// schema.ts footageCategories). categoryId: null = "belum dikategorikan".
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const userId = getUserId(req);
  const { id: brandId, itemId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const { categoryId } = await req.json();
  if (categoryId !== null && typeof categoryId !== "string") {
    return NextResponse.json({ error: "categoryId harus string atau null" }, { status: 400 });
  }
  const [existing] = await db.select({ id: footageBank.id }).from(footageBank).where(and(eq(footageBank.id, itemId), eq(footageBank.brandId, brandId)));
  if (!existing) return NextResponse.json({ error: "Footage tidak ditemukan" }, { status: 404 });
  await db.update(footageBank).set({ categoryId }).where(eq(footageBank.id, itemId));
  const [updated] = await db.select().from(footageBank).where(eq(footageBank.id, itemId));
  return NextResponse.json({ ...updated, tags: JSON.parse(updated!.tags) });
}

// Hapus footage dari bank (2026-08-06, permintaan Agus - "berikan fitur hapus footage
// juga", sebelumnya cuma bisa hapus KATEGORI, item footage individual tidak bisa dihapus
// sama sekali). Hapus record DB + file asli di R2. Poster JPG di Cloudinary (khusus item
// video) SENGAJA tidak ikut dihapus - biaya storage kecil, tidak sepadan kompleksitas
// tambahan integrasi Cloudinary delete API di sini.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const userId = getUserId(req);
  const { id: brandId, itemId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const [item] = await db.select().from(footageBank).where(and(eq(footageBank.id, itemId), eq(footageBank.brandId, brandId)));
  if (!item) return NextResponse.json({ error: "Footage tidak ditemukan" }, { status: 404 });

  const key = keyFromPublicUrl(item.fileUrl);
  if (key) {
    try {
      await deleteObject(key);
    } catch (err) {
      // Gagal hapus file storage TIDAK menghalangi hapus record DB (2026-08-06) - lebih
      // baik record hilang dari daftar (yg Agus lihat & minta) drpd macet krn 1 file
      // storage bermasalah, sama filosofi gagal-lunak yg dipakai di seluruh app ini.
      console.error(`[footage-bank DELETE] gagal hapus file storage utk ${itemId}:`, err);
    }
  }
  await db.delete(footageBank).where(eq(footageBank.id, itemId));
  return NextResponse.json({ ok: true });
}

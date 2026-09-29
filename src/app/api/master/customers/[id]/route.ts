import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";

// Aksi admin atas 1 pelanggan (2026-09-30) - saat ini: ubah status akun (suspend /
// aktifkan kembali). Hanya admin. Status akun ("aktif" = normal, selain itu = nonaktif/
// disuspend) BEDA dari status langganan (berlangganan/kadaluarsa yang dihitung dari
// periodeBerakhir) - ini kontrol manual admin untuk memblokir akun bermasalah tanpa
// menyentuh paket/kreditnya.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminOrNull(req);
  if (!admin) {
    return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json();

  const [target] = await db.select().from(users).where(eq(users.id, id));
  if (!target) {
    return NextResponse.json({ error: "Pelanggan tidak ditemukan" }, { status: 404 });
  }

  // Blokir/aktifkan akun (T6) - TERPISAH dari status langganan (aktif/masa_tenggang/
  // terbatas yg dikelola cron). true = suspend, false = aktifkan. Digerbangi statusGate.
  if (typeof body.diblokir !== "boolean") {
    return NextResponse.json({ error: "field 'diblokir' (boolean) wajib" }, { status: 400 });
  }

  await db.update(users).set({ diblokirAdmin: body.diblokir }).where(eq(users.id, id));
  return NextResponse.json({ ok: true });
}

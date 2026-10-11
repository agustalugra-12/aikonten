import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";

// Admin batalkan / lanjutkan langganan pelanggan dari Master Dashboard (2026-10-11).
// Model prepaid SAMA dgn /api/account/cancel: "batal" = tidak diperpanjang, AKSES TETAP
// sampai periodeBerakhir (cron check-expiry menurunkan status saat lewat). Body
// { resume: true } untuk melanjutkan lagi. Tidak mengubah periode/kredit. Hanya admin.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminOrNull(req);
  if (!admin) return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const dibatalkan = body.resume === true ? false : true;
  const [target] = await db.select().from(users).where(eq(users.id, id));
  if (!target) return NextResponse.json({ error: "Pelanggan tidak ditemukan" }, { status: 404 });
  await db.update(users).set({ langgananDibatalkan: dibatalkan }).where(eq(users.id, id));
  return NextResponse.json({ ok: true, langgananDibatalkan: dibatalkan });
}

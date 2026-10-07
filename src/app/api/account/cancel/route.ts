import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserId } from "@/lib/session";

// Batalkan / lanjutkan langganan (2026-10-07, #2). Model PREPAID: "batal" = tak akan
// perpanjang; AKSES TETAP sampai periodeBerakhir (cron check-expiry yg menurunkan status
// saat lewat). POST {resume:true} utk lanjutkan lagi. Tidak mengubah periode/kredit.
export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  const body = await req.json().catch(() => ({}));
  const dibatalkan = body.resume === true ? false : true;
  await db.update(users).set({ langgananDibatalkan: dibatalkan }).where(eq(users.id, userId));
  return NextResponse.json({ ok: true, langgananDibatalkan: dibatalkan });
}

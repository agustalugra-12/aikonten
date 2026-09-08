import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, and, lt } from "drizzle-orm";

// Cron harian - transisi status akun sesuai `periodeBerakhir` (2026-09-08, Fase 1 Alur C,
// keputusan Agus eksplisit "opsi B": masa tenggang dulu, BUKAN full lock langsung).
//
// aktif -> masa_tenggang: begitu periodeBerakhir lewat. Masih boleh generate konten
// (lihat billing/statusGate.ts) - cuma peringatan, tagihan belum lunas tapi belum
// diblokir fungsional sama sekali.
// masa_tenggang -> terbatas: begitu masa tenggang (GRACE_HARI) JUGA lewat. Baru di sini
// generate konten baru diblokir - baca/download konten lama TETAP boleh (tidak ada
// perubahan di route baca mana pun).
//
// GRACE_HARI = 3 SENGAJA PLACEHOLDER (belum ada keputusan Agus soal lama masa tenggang) -
// sama semangat dgn CREDIT_COST_GENERATE di credits.ts, gampang diganti 1 tempat.
const GRACE_HARI = 3;

export async function POST(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const batasGrace = new Date(now.getTime() - GRACE_HARI * 24 * 60 * 60 * 1000);

  // aktif -> masa_tenggang
  const keMasaTenggang = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.status, "aktif"), lt(users.periodeBerakhir, now)));
  for (const u of keMasaTenggang) {
    await db.update(users).set({ status: "masa_tenggang" }).where(eq(users.id, u.id));
  }

  // masa_tenggang -> terbatas (periodeBerakhir + GRACE_HARI sudah lewat)
  const keTerbatas = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.status, "masa_tenggang"), lt(users.periodeBerakhir, batasGrace)));
  for (const u of keTerbatas) {
    await db.update(users).set({ status: "terbatas" }).where(eq(users.id, u.id));
  }

  return NextResponse.json({
    ok: true,
    ke_masa_tenggang: keMasaTenggang.length,
    ke_terbatas: keTerbatas.length,
  });
}

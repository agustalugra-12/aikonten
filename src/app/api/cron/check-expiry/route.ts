import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { notifExpiry } from "@/lib/billing/notify";

// Cron harian - transisi status akun sesuai `periodeBerakhir` (2026-09-08, Fase 1 Alur C,
// keputusan Agus eksplisit "opsi B": masa tenggang dulu, BUKAN full lock langsung).
//
// aktif -> masa_tenggang: begitu periodeBerakhir lewat. Masih boleh generate konten
// (lihat billing/statusGate.ts) - cuma peringatan, tagihan belum lunas tapi belum
// diblokir fungsional sama sekali.
// masa_tenggang -> terbatas: begitu masa tenggang (GRACE_HARI) JUGA lewat. Baru di sini
// generate konten baru diblokir - baca/download konten lama TETAP boleh.
//
// 2026-10-11 (#2): kirim ringkasan transisi ke owner via Telegram (notifExpiry) + timer
// systemd aikonten-saas-check-expiry (sebelumnya route ini ADA tapi tak pernah dipanggil).
const GRACE_HARI = 3;
const label = (u: { nama: string | null; namaBisnis: string | null; email: string }) => u.nama || u.namaBisnis || u.email;

export async function POST(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const batasGrace = new Date(now.getTime() - GRACE_HARI * 24 * 60 * 60 * 1000);
  const kol = { id: users.id, email: users.email, nama: users.nama, namaBisnis: users.namaBisnis };

  // aktif -> masa_tenggang
  const keMasaTenggang = await db.select(kol).from(users)
    .where(and(eq(users.status, "aktif"), lt(users.periodeBerakhir, now)));
  for (const u of keMasaTenggang) {
    await db.update(users).set({ status: "masa_tenggang" }).where(eq(users.id, u.id));
  }

  // masa_tenggang -> terbatas (periodeBerakhir + GRACE_HARI sudah lewat)
  const keTerbatas = await db.select(kol).from(users)
    .where(and(eq(users.status, "masa_tenggang"), lt(users.periodeBerakhir, batasGrace)));
  for (const u of keTerbatas) {
    await db.update(users).set({ status: "terbatas" }).where(eq(users.id, u.id));
  }

  await notifExpiry(keMasaTenggang.map(label), keTerbatas.map(label));

  return NextResponse.json({
    ok: true,
    ke_masa_tenggang: keMasaTenggang.length,
    ke_terbatas: keTerbatas.length,
  });
}

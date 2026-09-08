import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, plans, creditTransactions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getUserId } from "@/lib/session";

// Saldo kredit akun sendiri (2026-09-08, Fase 1 Alur B) - PENGGANTI usage-summary yang
// dimatikan (410) di fork ini. Beda mendasar: usage-summary lama balikin biaya USD ASLI
// gabungan semua brand ke siapa pun yang login (benar utk single-admin, TAPI kontradiksi
// keputusan bisnis PRD §09 - pelanggan SaaS TIDAK PERNAH lihat biaya asli, cuma kredit).
// Route ini HANYA baca saldoKredit + riwayat creditTransactions milik userId yang login
// sendiri (angka kredit abstrak, bukan USD apa pun) - tidak ada input, read-only murni.
export async function GET(req: NextRequest) {
  const userId = getUserId(req);

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    return NextResponse.json({ error: "Akun tidak ditemukan" }, { status: 404 });
  }

  const plan = user.planId
    ? (await db.select().from(plans).where(eq(plans.id, user.planId)))[0] ?? null
    : null;

  const riwayat = await db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(20);

  return NextResponse.json({
    saldoKredit: user.saldoKredit,
    status: user.status,
    periodeBerakhir: user.periodeBerakhir,
    plan: plan ? { nama: plan.nama, kreditBulanan: plan.kreditBulanan, izinAutoPosting: plan.izinAutoPosting, maxBrand: plan.maxBrand } : null,
    riwayat: riwayat.map((r) => ({
      jumlah: r.jumlah, alasan: r.alasan, saldoSetelah: r.saldoSetelah, createdAt: r.createdAt,
    })),
  });
}

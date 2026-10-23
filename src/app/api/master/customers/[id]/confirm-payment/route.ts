import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { billingLog } from "@/db/schema";
import { and, eq, desc, isNotNull } from "drizzle-orm";
import { getAdminOrNull } from "@/lib/admin";
import { aktivasiPaketSetelahBayar } from "@/lib/billing/activation";
import { catatAudit } from "@/lib/audit";

// Konfirmasi pembayaran MANUAL oleh admin dari Master Dashboard (2026-10-11) - UI pengganti
// scripts/confirm-payment.ts sampai gateway (Duitku) tersambung. Admin verifikasi transfer
// masuk (mutasi BCA) lalu klik "Konfirmasi bayar": cari tagihan PAKET pending terbaru milik
// pelanggan (planId tidak null -> bukan top-up), aktivasi via aktivasiPaketSetelahBayar()
// (idempotent, fungsi SAMA yang dipanggil webhook gateway nanti). Hanya admin (getAdminOrNull).
// Body opsional { billingLogId } untuk menargetkan tagihan spesifik.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminOrNull(req);
  if (!admin) return NextResponse.json({ error: "Akses khusus admin" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  let billId: string | undefined = typeof body?.billingLogId === "string" ? body.billingLogId : undefined;

  if (!billId) {
    const [pending] = await db
      .select()
      .from(billingLog)
      .where(and(eq(billingLog.userId, id), eq(billingLog.status, "pending"), isNotNull(billingLog.planId)))
      .orderBy(desc(billingLog.createdAt))
      .limit(1);
    if (!pending) {
      return NextResponse.json({ error: "Tidak ada tagihan paket pending untuk pelanggan ini" }, { status: 404 });
    }
    billId = pending.id;
  }

  try {
    await aktivasiPaketSetelahBayar(billId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Gagal aktivasi paket" }, { status: 400 });
  }
  await catatAudit({ adminEmail: admin.email, aksi: "konfirmasi_bayar", targetUserId: id, detail: `billingLogId=${billId}` });
  return NextResponse.json({ ok: true, billingLogId: billId });
}

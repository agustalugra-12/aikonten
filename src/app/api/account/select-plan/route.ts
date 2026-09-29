import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { plans, billingLog, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserId } from "@/lib/session";
import { newId } from "@/lib/ids";
import { createTransaction, duitkuConfigured } from "@/lib/billing/duitku";

// Pilih paket + checkout (2026-09-08 Fase 1; 2026-09-30 T3: sambung Duitku). Membuat
// tagihan billingLog "pending", lalu:
//  - kalau Duitku terkonfigurasi: buat transaksi gateway (merchantOrderId = billingLog.id),
//    simpan reference ke gatewayRef, kembalikan paymentUrl utk redirect pelanggan.
//  - kalau belum (dev/staging tanpa kredensial): degrade ke "pending" (aktivasi manual
//    lewat scripts/confirm-payment.ts). Kode SAMA, cuma beda apakah ada paymentUrl.
// Aktivasi paket TIDAK terjadi di sini - hanya lewat webhook terverifikasi (anti curang).
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://aikonten.agustapstudio.com";

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  const { planId } = await req.json();
  if (typeof planId !== "string" || !planId) {
    return NextResponse.json({ error: "planId wajib diisi" }, { status: 400 });
  }

  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan || !plan.aktif) {
    return NextResponse.json({ error: "Paket tidak ditemukan" }, { status: 404 });
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    return NextResponse.json({ error: "Akun tidak ditemukan" }, { status: 404 });
  }

  const id = newId("bill");
  await db.insert(billingLog).values({
    id,
    userId,
    planId: plan.id,
    jumlahBayarIdr: plan.hargaBulananIdr,
    status: "pending",
    gatewayRef: null,
    createdAt: new Date(),
  });

  if (duitkuConfigured()) {
    try {
      const tx = await createTransaction({
        merchantOrderId: id,
        paymentAmount: plan.hargaBulananIdr,
        productDetails: `Paket ${plan.nama} - AI Konten`,
        email: user.email,
        customerName: user.namaBisnis ?? user.email,
        callbackUrl: `${APP_BASE_URL}/api/webhooks/payment`,
        returnUrl: `${APP_BASE_URL}/pilih-paket/sukses?bill=${id}`,
      });
      await db.update(billingLog).set({ gatewayRef: tx.reference }).where(eq(billingLog.id, id));
      return NextResponse.json(
        { ok: true, billingLogId: id, paymentUrl: tx.paymentUrl, jumlahBayarIdr: plan.hargaBulananIdr },
        { status: 201 },
      );
    } catch (err) {
      console.error("[select-plan] gagal buat transaksi Duitku:", err);
      return NextResponse.json(
        { error: "Gagal membuat transaksi pembayaran. Coba lagi sebentar." },
        { status: 502 },
      );
    }
  }

  // Belum ada gateway - degrade ke manual (pending). Frontend tampilkan "menunggu konfirmasi".
  return NextResponse.json(
    { ok: true, billingLogId: id, status: "pending", jumlahBayarIdr: plan.hargaBulananIdr },
    { status: 201 },
  );
}

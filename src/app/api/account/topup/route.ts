import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { billingLog, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserId } from "@/lib/session";
import { newId } from "@/lib/ids";
import { getTopupPack } from "@/lib/billing/topupPacks";
import { createTransaction, duitkuConfigured } from "@/lib/billing/duitku";

// Checkout top-up kredit (2026-09-30, T5). Mirip select-plan tapi: hasil sukses = tambah
// kredit (isiUlangKredit di webhook), BUKAN set paket. Harga & kredit diambil dari
// TOPUP_PACKS di server (jangan percaya angka dari klien - klien cuma kirim packId).
// billingLog.jenis="topup" supaya webhook tahu memproses sbg top-up, bukan aktivasi paket.
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://aikonten.agustapstudio.com";

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  const { packId } = await req.json();

  const pack = getTopupPack(typeof packId === "string" ? packId : "");
  if (!pack) {
    return NextResponse.json({ error: "Paket top-up tidak ditemukan" }, { status: 404 });
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    return NextResponse.json({ error: "Akun tidak ditemukan" }, { status: 404 });
  }

  const id = newId("bill");
  await db.insert(billingLog).values({
    id,
    userId,
    planId: null,
    jenis: "topup",
    kreditTopup: pack.kredit,
    jumlahBayarIdr: pack.hargaIdr,
    status: "pending",
    gatewayRef: null,
    createdAt: new Date(),
  });

  if (duitkuConfigured()) {
    try {
      const tx = await createTransaction({
        merchantOrderId: id,
        paymentAmount: pack.hargaIdr,
        productDetails: `Top-up ${pack.nama} - AI Konten`,
        email: user.email,
        customerName: user.namaBisnis ?? user.email,
        callbackUrl: `${APP_BASE_URL}/api/webhooks/payment`,
        returnUrl: `${APP_BASE_URL}/kredit?topup=selesai`,
      });
      await db.update(billingLog).set({ gatewayRef: tx.reference }).where(eq(billingLog.id, id));
      return NextResponse.json({ ok: true, paymentUrl: tx.paymentUrl }, { status: 201 });
    } catch (err) {
      console.error("[topup] gagal buat transaksi Duitku:", err);
      return NextResponse.json({ error: "Gagal membuat transaksi. Coba lagi." }, { status: 502 });
    }
  }

  return NextResponse.json({ ok: true, status: "pending", billingLogId: id }, { status: 201 });
}

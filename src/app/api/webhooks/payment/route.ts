import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { billingLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyCallbackSignature } from "@/lib/billing/duitku";
import { aktivasiPaketSetelahBayar } from "@/lib/billing/activation";
import { isiUlangKredit } from "@/lib/billing/credits";

// Webhook callback Duitku (2026-09-30, T3). DIKECUALIKAN dari gate sesi + injeksi x-user-id
// di proxy.ts (gateway tak punya cookie login). PENGAMAN UTAMA: verifikasi signature dulu -
// hanya callback dgn signature cocok (dihitung pakai apiKey RAHASIA kita) yang boleh memicu
// aktivasi paket. aktivasiPaketSetelahBayar() idempotent -> aman kalau Duitku kirim callback
// berkali-kali. merchantOrderId yang kita set = billingLog.id, jadi lookup langsung by id.
//
// Duitku mengirim callback sbg application/x-www-form-urlencoded (bukan JSON).
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "payload tidak valid" }, { status: 400 });
  }
  const merchantOrderId = String(form.get("merchantOrderId") ?? "");
  const amount = String(form.get("amount") ?? "");
  const signature = String(form.get("signature") ?? "");
  const resultCode = String(form.get("resultCode") ?? "");
  const reference = String(form.get("reference") ?? "");

  // 1. Verifikasi signature - tolak (401) kalau tidak cocok. Cegah aktivasi palsu.
  if (!merchantOrderId || !verifyCallbackSignature({ merchantOrderId, amount, signature })) {
    return NextResponse.json({ error: "signature tidak valid" }, { status: 401 });
  }

  // 2. Cari tagihan.
  const [log] = await db.select().from(billingLog).where(eq(billingLog.id, merchantOrderId));
  if (!log) {
    return NextResponse.json({ error: "tagihan tidak ditemukan" }, { status: 404 });
  }

  // 3. Proses sesuai hasil pembayaran. resultCode "00" = sukses (settlement).
  if (resultCode === "00") {
    if (log.status === "sukses") {
      return NextResponse.json({ ok: true }); // idempotent - sudah diproses (paket/topup)
    }
    if (reference && !log.gatewayRef) {
      await db.update(billingLog).set({ gatewayRef: reference }).where(eq(billingLog.id, log.id));
    }
    if (log.jenis === "topup") {
      // Top-up: tambah kredit + tandai sukses (guard status di atas jaga idempotensi callback dobel).
      await isiUlangKredit(log.userId, log.kreditTopup ?? 0, `top-up ${log.kreditTopup ?? 0} kredit`);
      await db.update(billingLog).set({ status: "sukses" }).where(eq(billingLog.id, log.id));
    } else {
      await aktivasiPaketSetelahBayar(log.id); // idempotent
    }
  } else if (log.status === "pending") {
    // Gagal/expire/batal - tandai gagal (jangan timpa yang sudah "sukses").
    await db.update(billingLog).set({ status: "gagal" }).where(eq(billingLog.id, log.id));
  }

  // 4. Balas 200 cepat (Duitku menganggap callback diterima).
  return NextResponse.json({ ok: true });
}

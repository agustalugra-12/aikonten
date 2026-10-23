import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { billingLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyTripayCallback } from "@/lib/billing/tripay";
import { aktivasiPaketSetelahBayar } from "@/lib/billing/activation";
import { isiUlangKredit } from "@/lib/billing/credits";

// Webhook callback Tripay (2026-10-23). DIKECUALIKAN dari gate sesi + injeksi x-user-id di
// proxy.ts (prefix /api/webhooks/ - gateway tak punya cookie). PENGAMAN UTAMA: verifikasi
// signature (HMAC-SHA256 body mentah pakai private key) SEBELUM proses apa pun. merchant_ref
// yang di-set saat buat transaksi = billingLog.id -> lookup by id. aktivasiPaketSetelahBayar()
// & isiUlangKredit() idempotent -> aman kalau Tripay retry (maks 3x). WAJIB balas {"success":true}.
export async function POST(req: NextRequest) {
  // Body MENTAH utk signature (JSON.parse sesudahnya - jangan re-serialize sebelum verifikasi).
  const raw = await req.text();
  const signature = req.headers.get("x-callback-signature") ?? "";
  const event = req.headers.get("x-callback-event") ?? "";

  if (event !== "payment_status") {
    return NextResponse.json({ success: false, error: "event tidak didukung" }, { status: 400 });
  }
  if (!verifyTripayCallback(raw, signature)) {
    return NextResponse.json({ success: false, error: "signature tidak valid" }, { status: 401 });
  }

  let payload: { merchant_ref?: string; status?: string; reference?: string };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ success: false, error: "payload tidak valid" }, { status: 400 });
  }
  const merchantRef = String(payload.merchant_ref ?? "");
  const status = String(payload.status ?? "");
  const reference = String(payload.reference ?? "");

  const [log] = await db.select().from(billingLog).where(eq(billingLog.id, merchantRef));
  if (!log) {
    return NextResponse.json({ success: false, error: "tagihan tidak ditemukan" }, { status: 404 });
  }

  if (status === "PAID") {
    if (log.status === "sukses") {
      return NextResponse.json({ success: true }); // idempotent - sudah diproses
    }
    if (reference && !log.gatewayRef) {
      await db.update(billingLog).set({ gatewayRef: reference }).where(eq(billingLog.id, log.id));
    }
    if (log.jenis === "topup") {
      await isiUlangKredit(log.userId, log.kreditTopup ?? 0, `top-up ${log.kreditTopup ?? 0} kredit`);
      await db.update(billingLog).set({ status: "sukses" }).where(eq(billingLog.id, log.id));
    } else {
      await aktivasiPaketSetelahBayar(log.id); // idempotent
    }
  } else if (log.status === "pending") {
    // FAILED / EXPIRED / REFUND - tandai gagal (jangan timpa yang sudah sukses).
    await db.update(billingLog).set({ status: "gagal" }).where(eq(billingLog.id, log.id));
  }

  return NextResponse.json({ success: true });
}

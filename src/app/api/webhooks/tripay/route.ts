import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { billingLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyTripayCallback } from "@/lib/billing/tripay";
import { prosesPembayaranSukses } from "@/lib/billing/activation";

// Webhook callback Tripay (2026-10-23). DIKECUALIKAN dari gate sesi + injeksi x-user-id di
// proxy.ts (prefix /api/webhooks/ - gateway tak punya cookie). PENGAMAN UTAMA: verifikasi
// signature (HMAC-SHA256 body mentah pakai private key) SEBELUM proses apa pun. merchant_ref
// yang di-set saat buat transaksi = billingLog.id -> lookup by id.
// (2026-11-06 P0) prosesPembayaranSukses ATOMIK + EXACTLY-ONCE (kunci ref_billing_id) -> aman
// kalau Tripay retry (maks 3x) TANPA bergantung status "sukses" saja, dan bisa self-heal tagihan
// sukses-tanpa-kredit. WAJIB balas {"success":true}.
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
    if (reference && !log.gatewayRef) {
      await db.update(billingLog).set({ gatewayRef: reference }).where(eq(billingLog.id, log.id));
    }
    await prosesPembayaranSukses(log.id); // atomik + exactly-once (ref) + self-heal
  } else if (log.status === "pending") {
    // FAILED / EXPIRED / REFUND - tandai gagal (jangan timpa yang sudah sukses).
    await db.update(billingLog).set({ status: "gagal" }).where(eq(billingLog.id, log.id));
  }

  return NextResponse.json({ success: true });
}

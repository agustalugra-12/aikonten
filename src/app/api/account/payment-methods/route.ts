import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { getPaymentMethods, duitkuConfigured } from "@/lib/billing/duitku";

// Daftar metode pembayaran Duitku utk nominal tertentu (2026-10-23, #1). Dipanggil frontend
// SEBELUM select-plan/topup krn paymentMethod WAJIB di inquiry. Kalau gateway belum aktif
// (duitkuConfigured=false) balikin list kosong -> frontend fallback ke manual BCA.
export async function GET(req: NextRequest) {
  getUserId(req); // pastikan login (lempar kalau tak ada sesi)
  if (!duitkuConfigured()) return NextResponse.json({ methods: [] });
  const amount = Number(new URL(req.url).searchParams.get("amount") || "0");
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount tidak valid" }, { status: 400 });
  }
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const datetime = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  try {
    const methods = await getPaymentMethods(amount, datetime);
    return NextResponse.json({ methods });
  } catch (e) {
    console.error("[payment-methods] gagal:", e);
    return NextResponse.json({ error: "Gagal memuat metode pembayaran" }, { status: 502 });
  }
}

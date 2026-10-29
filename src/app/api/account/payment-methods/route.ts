import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { getPaymentMethods, duitkuConfigured } from "@/lib/billing/duitku";
import { getPaymentChannels, tripayCreateReady } from "@/lib/billing/tripay";

// Daftar metode pembayaran utk nominal tertentu (dipanggil frontend SEBELUM select-plan/topup
// krn paymentMethod WAJIB). Bentuk balikan {paymentMethod,paymentName,paymentImage,totalFee}
// SAMA utk Duitku & Tripay -> UI picker (kredit/pilih-paket) tak perlu tahu gateway-nya.
// Gateway belum aktif -> methods: [] -> frontend fallback ke manual BCA.
export async function GET(req: NextRequest) {
  getUserId(req); // pastikan login (lempar kalau tak ada sesi)
  const amount = Number(new URL(req.url).searchParams.get("amount") || "0");
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount tidak valid" }, { status: 400 });
  }

  // Tripay (2026-10-29) - aktif kalau PAYMENT_PROVIDER=tripay & kredensial lengkap.
  if (process.env.PAYMENT_PROVIDER === "tripay" && tripayCreateReady()) {
    try {
      const methods = await getPaymentChannels(amount);
      return NextResponse.json({ methods });
    } catch (e) {
      console.error("[payment-methods] Tripay gagal:", e);
      return NextResponse.json({ error: "Gagal memuat metode pembayaran" }, { status: 502 });
    }
  }

  if (!duitkuConfigured()) return NextResponse.json({ methods: [] });
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

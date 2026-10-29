import crypto from "crypto";

// Klien Tripay (gateway, alternatif/pengganti Duitku). Kredensial dari .env (jangan hardcode).
// - verifyTripayCallback: validasi webhook (HMAC-SHA256 RAW body pakai PRIVATE KEY). Hanya butuh
//   private key.
// - createTransaction (2026-10-29): buat "closed transaction" -> checkout_url utk redirect
//   pelanggan + reference (disimpan ke billingLog.gatewayRef). merchant_ref = billingLog.id
//   (pola SAMA Duitku; webhooks/tripay lookup by id). Butuh merchant_code + api_key + private_key.
// Signature closed-transaction (docs tripay.co.id): HMAC-SHA256(merchant_code + merchant_ref +
// amount, private_key) hex. callback_url diatur di dashboard Tripay (bukan di body).
const TRIPAY_PRIVATE_KEY = process.env.TRIPAY_PRIVATE_KEY ?? "";
const TRIPAY_API_KEY = process.env.TRIPAY_API_KEY ?? "";
const TRIPAY_MERCHANT_CODE = process.env.TRIPAY_MERCHANT_CODE ?? "";
const TRIPAY_MODE = process.env.TRIPAY_MODE ?? "sandbox";

const BASE_URL = TRIPAY_MODE === "production" ? "https://tripay.co.id/api" : "https://tripay.co.id/api-sandbox";

// Callback verify cukup private key (perilaku lama, dipakai webhooks/tripay).
export function tripayConfigured(): boolean {
  return TRIPAY_PRIVATE_KEY.length > 0;
}

// createTransaction butuh ketiga kredensial.
export function tripayCreateReady(): boolean {
  return TRIPAY_PRIVATE_KEY.length > 0 && TRIPAY_API_KEY.length > 0 && TRIPAY_MERCHANT_CODE.length > 0;
}

// Verifikasi signature callback (body MENTAH, jangan re-serialize) - pengaman utama anti aktivasi palsu.
export function verifyTripayCallback(rawBody: string, signature: string): boolean {
  if (!tripayConfigured()) return false;
  const expected = crypto.createHmac("sha256", TRIPAY_PRIVATE_KEY).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Signature WAJIB saat create: HMAC-SHA256(merchant_code + merchant_ref + amount, private_key).
export function transactionSignature(merchantRef: string, amount: number): string {
  return crypto.createHmac("sha256", TRIPAY_PRIVATE_KEY).update(TRIPAY_MERCHANT_CODE + merchantRef + String(amount)).digest("hex");
}

// Channel pembayaran utk picker UI (2026-10-29). Dinormalisasi ke bentuk SAMA dgn Duitku
// ({paymentMethod,paymentName,paymentImage,totalFee}) supaya UI checkout (kredit/pilih-paket)
// tak perlu diubah. totalFee = biaya yg ditanggung pelanggan utk `amount` ini.
export type PaymentChannel = { paymentMethod: string; paymentName: string; paymentImage: string; totalFee: string };

export async function getPaymentChannels(amount: number): Promise<PaymentChannel[]> {
  if (!tripayCreateReady()) {
    throw new Error("Tripay belum dikonfigurasi (kredensial kosong)");
  }
  const res = await fetch(`${BASE_URL}/merchant/payment-channel`, {
    headers: { Authorization: `Bearer ${TRIPAY_API_KEY}` },
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean; message?: string;
    data?: Array<{ code?: string; name?: string; icon_url?: string; active?: boolean; fee_customer?: { flat?: number; percent?: number } }>;
  };
  if (!res.ok || !data.success || !Array.isArray(data.data)) {
    throw new Error(`Tripay payment-channel gagal: ${res.status} ${data.message ?? JSON.stringify(data).slice(0, 150)}`);
  }
  return data.data
    .filter((c) => c.active && typeof c.code === "string" && typeof c.name === "string")
    .map((c) => {
      const flat = c.fee_customer?.flat ?? 0;
      const percent = c.fee_customer?.percent ?? 0;
      const fee = Math.round(flat + (percent / 100) * amount);
      return { paymentMethod: c.code as string, paymentName: c.name as string, paymentImage: c.icon_url ?? "", totalFee: String(fee) };
    });
}

export type TripayTxResult = { paymentUrl: string; reference: string; merchantOrderId: string };

// Buat transaksi (closed payment). Melempar Error kalau kredensial kosong / Tripay menolak -
// pemanggil balas 502 & biarkan billingLog tetap pending. `method` = kode channel Tripay (mis.
// "QRIS", "BRIVA"); default "QRIS" (universal) kalau UI belum mengirim channel Tripay.
export async function createTransaction(opts: {
  merchantOrderId: string;
  paymentAmount: number;
  productDetails: string;
  email: string;
  method?: string;
  customerName?: string;
  returnUrl: string;
  expiryPeriodMinutes?: number;
}): Promise<TripayTxResult> {
  if (!tripayCreateReady()) {
    throw new Error("Tripay belum dikonfigurasi (TRIPAY_MERCHANT_CODE/TRIPAY_API_KEY/TRIPAY_PRIVATE_KEY kosong)");
  }
  const amount = Math.round(opts.paymentAmount);
  const body = {
    method: opts.method && opts.method.length > 0 ? opts.method : "QRIS",
    merchant_ref: opts.merchantOrderId,
    amount,
    customer_name: opts.customerName ?? opts.email,
    customer_email: opts.email,
    order_items: [{ name: opts.productDetails, price: amount, quantity: 1 }],
    return_url: opts.returnUrl,
    expired_time: Math.floor(Date.now() / 1000) + (opts.expiryPeriodMinutes ?? 60) * 60,
    signature: transactionSignature(opts.merchantOrderId, amount),
  };
  const res = await fetch(`${BASE_URL}/transaction/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TRIPAY_API_KEY}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; data?: { reference?: string; checkout_url?: string } };
  if (!res.ok || !data.success || !data.data?.checkout_url) {
    throw new Error(`Tripay create gagal: ${res.status} ${data.message ?? JSON.stringify(data).slice(0, 200)}`);
  }
  return { paymentUrl: data.data.checkout_url, reference: data.data.reference ?? "", merchantOrderId: opts.merchantOrderId };
}

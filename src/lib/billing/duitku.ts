import crypto from "crypto";

// Klien Duitku (2026-09-30, T3 Fase 2) - payment gateway pilihan Agus. Semua kredensial
// dari .env (jangan hardcode). Dua operasi yang dipakai:
//   1. createTransaction (inquiry v2): buat transaksi -> dapat paymentUrl utk redirect
//      pelanggan + reference Duitku (disimpan ke billingLog.gatewayRef).
//   2. verifyCallbackSignature: validasi webhook Duitku sebelum aktivasi (anti aktivasi palsu).
//
// Referensi signature (dokumentasi Duitku):
//   - inquiry:  md5(merchantCode + merchantOrderId + paymentAmount + apiKey)
//   - callback: md5(merchantCode + amount + merchantOrderId + apiKey)
// resultCode "00" = sukses (settlement) di callback.
//
// Mode: DUITKU_ENV=sandbox|production menentukan base URL. Kredensial kosong = klien tetap
// meng-compile & fungsi signature tetap bisa diuji offline; hanya createTransaction (network)
// yang butuh kredensial asli saat benar-benar dipanggil ke server Duitku.

const DUITKU_MERCHANT_CODE = process.env.DUITKU_MERCHANT_CODE ?? "";
const DUITKU_API_KEY = process.env.DUITKU_API_KEY ?? "";
const DUITKU_ENV = process.env.DUITKU_ENV ?? "sandbox";

const BASE_URL =
  DUITKU_ENV === "production"
    ? "https://passport.duitku.com/webapi/api/merchant"
    : "https://sandbox.duitku.com/webapi/api/merchant";

function md5(s: string): string {
  return crypto.createHash("md5").update(s).digest("hex");
}

export function duitkuConfigured(): boolean {
  return DUITKU_MERCHANT_CODE.length > 0 && DUITKU_API_KEY.length > 0;
}

export function merchantCode(): string {
  return DUITKU_MERCHANT_CODE;
}

// Signature yang WAJIB dikirim saat inquiry (create transaction).
export function inquirySignature(merchantOrderId: string, paymentAmount: number): string {
  return md5(DUITKU_MERCHANT_CODE + merchantOrderId + String(paymentAmount) + DUITKU_API_KEY);
}

// Signature yang DIHARAPKAN dari callback Duitku - dibandingkan dgn yang dikirim gateway.
export function callbackSignature(merchantOrderId: string, amount: string): string {
  return md5(DUITKU_MERCHANT_CODE + amount + merchantOrderId + DUITKU_API_KEY);
}

// Verifikasi signature callback. PENGAMAN UTAMA: hanya callback dengan signature cocok
// (dihitung pakai apiKey rahasia kita) yang boleh memicu aktivasi paket/kredit.
export function verifyCallbackSignature(params: {
  merchantOrderId: string;
  amount: string;
  signature: string;
}): boolean {
  if (!duitkuConfigured()) return false;
  const expected = callbackSignature(params.merchantOrderId, params.amount);
  // timing-safe compare (hex string sama panjang - md5 selalu 32 char).
  const a = Buffer.from(expected);
  const b = Buffer.from(params.signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type DuitkuMethod = { paymentMethod: string; paymentName: string; paymentImage: string; totalFee: string };

// Signature getpaymentmethod BEDA dari inquiry: HMAC-SHA256(merchantcode+amount+datetime, apiKey)
// hex lowercase (lihat docs.duitku.com - SHA256 polos sudah obsolete). datetime: yyyy-MM-dd HH:mm:ss.
function hmac256(msg: string): string {
  return crypto.createHmac("sha256", DUITKU_API_KEY).update(msg).digest("hex");
}

// Ambil daftar metode pembayaran aktif utk nominal tertentu (dipanggil sebelum inquiry, krn
// paymentMethod WAJIB di /v2/inquiry). Melempar Error kalau kredensial kosong / Duitku menolak.
export async function getPaymentMethods(amount: number, datetime: string): Promise<DuitkuMethod[]> {
  if (!duitkuConfigured()) {
    throw new Error("Duitku belum dikonfigurasi (DUITKU_MERCHANT_CODE/DUITKU_API_KEY kosong)");
  }
  const amt = String(amount);
  const body = {
    merchantcode: DUITKU_MERCHANT_CODE,
    amount: amt,
    datetime,
    signature: hmac256(DUITKU_MERCHANT_CODE + amt + datetime),
  };
  const res = await fetch(`${BASE_URL}/paymentmethod/getpaymentmethod`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.responseCode !== "00" || !Array.isArray(data.paymentFee)) {
    throw new Error(`Duitku getpaymentmethod gagal: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.paymentFee as DuitkuMethod[];
}

export type DuitkuTxResult = {
  paymentUrl: string;
  reference: string;
  merchantOrderId: string;
};

// Buat transaksi (inquiry v2). Melempar Error kalau kredensial belum di-set atau Duitku
// menolak - pemanggil menangani (mis. balas 502 + biarkan billingLog tetap pending).
export async function createTransaction(opts: {
  merchantOrderId: string;
  paymentAmount: number;
  productDetails: string;
  paymentMethod: string;
  email: string;
  customerName?: string;
  callbackUrl: string;
  returnUrl: string;
  expiryPeriodMinutes?: number;
}): Promise<DuitkuTxResult> {
  if (!duitkuConfigured()) {
    throw new Error("Duitku belum dikonfigurasi (DUITKU_MERCHANT_CODE/DUITKU_API_KEY kosong)");
  }
  const body = {
    merchantCode: DUITKU_MERCHANT_CODE,
    paymentAmount: opts.paymentAmount,
    merchantOrderId: opts.merchantOrderId,
    paymentMethod: opts.paymentMethod,
    productDetails: opts.productDetails,
    email: opts.email,
    customerVaName: opts.customerName ?? opts.email,
    callbackUrl: opts.callbackUrl,
    returnUrl: opts.returnUrl,
    signature: inquirySignature(opts.merchantOrderId, opts.paymentAmount),
    expiryPeriod: opts.expiryPeriodMinutes ?? 60,
  };
  const res = await fetch(`${BASE_URL}/v2/inquiry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.paymentUrl) {
    throw new Error(`Duitku inquiry gagal: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return {
    paymentUrl: data.paymentUrl,
    reference: data.reference,
    merchantOrderId: opts.merchantOrderId,
  };
}

import crypto from "crypto";

// Klien Tripay - saat ini HANYA verifikasi callback (2026-10-23). Tripay = gateway alternatif
// (selain Duitku). Callback-nya: HMAC-SHA256 dari RAW JSON body mentah pakai PRIVATE KEY
// merchant sbg secret, dikirim di header X-Callback-Signature (lihat tripay.co.id/developer).
// Kredensial dari .env (jangan hardcode). createTransaction belum dibangun (webhook-only
// sesuai permintaan) - begitu dipakai, set merchant_ref = billingLog.id (pola sama Duitku).
const TRIPAY_PRIVATE_KEY = process.env.TRIPAY_PRIVATE_KEY ?? "";

export function tripayConfigured(): boolean {
  return TRIPAY_PRIVATE_KEY.length > 0;
}

// Verifikasi signature callback. PENGAMAN UTAMA: signature dihitung dari body MENTAH (bukan
// hasil re-serialize JSON - beda spasi = beda hash), pakai private key rahasia kita. Hanya
// callback dgn signature cocok yang boleh memicu aktivasi paket/kredit.
export function verifyTripayCallback(rawBody: string, signature: string): boolean {
  if (!tripayConfigured()) return false;
  const expected = crypto.createHmac("sha256", TRIPAY_PRIVATE_KEY).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

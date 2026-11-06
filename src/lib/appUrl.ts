// URL dasar aplikasi (2026-11-06, billing-hardening P1.5). SATU sumber kebenaran untuk
// membangun redirect_uri OAuth & tautan email. UTAMAKAN APP_BASE_URL = domain produk LIVE
// (aikonten.agustapstudio.com). APP_URL dibiarkan sbg fallback lama SAJA: pernah menunjuk
// domain MATI (aimarketing.pelangihomestay.com, HTTP 000 per audit 2026-11-06) sehingga
// redirect_uri OAuth YouTube/Meta rusak. Jangan baca process.env.APP_URL langsung lagi.
export function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ||
    process.env.APP_URL ||
    "https://aikonten.agustapstudio.com"
  ).replace(/\/+$/, "");
}

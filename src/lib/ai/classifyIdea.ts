// Klasifikasi ide konten: SPESIFIK properti (fasilitas/harga/kamar) vs UMUM (2026-08-04,
// permintaan Agus - diskusi soal fallback Pexels ketika Bank Footage tidak punya footage
// yg cocok utk sebuah ide). Keputusan final Agus: Pexels (stok video generik) HANYA boleh
// dipakai sbg fallback utk ide UMUM (mis. tips wisata sekitar) - ide yg menyebut hal
// SPESIFIK soal properti (harga kamar, fasilitas, day use, dst) WAJIB pakai footage asli
// Pelangi/Harmoni, TIDAK BOLEH Pexels sama sekali (walau videonya jadi tidak bisa
// digenerate) - supaya klaim harga/fasilitas TIDAK PERNAH ditempel di footage generik yg
// bukan properti sungguhan (risiko menyesatkan penonton).
// CATATAN: sengaja TIDAK memasukkan "homestay"/"villa" (nama jenis properti) di sini -
// kata itu wajar muncul bahkan di ide UMUM (mis. "tips wisata sekitar homestay"), jadi
// kalau dimasukkan nyaris SEMUA ide akan salah kena klasifikasi "spesifik" (bug nyata
// ditemukan lewat tes: "Tips liburan santai di sekitar homestay pas weekend" - ide jelas
// umum - salah kena true krn kata "homestay"). Daftar di bawah HARUS kata yg benar2
// menandakan detail harga/fasilitas/kamar spesifik, bukan sekadar nama properti.
const KEYWORD_SPESIFIK_PROPERTI = [
  "harga", "rp", "tarif", "kamar", "cottage", "standard", "day use", "day-use",
  "menginap", "fasilitas", "sarapan", "wifi", "check-in", "checkin", "check in",
  "checkout", "check-out", "booking", "promo", "diskon", "kolam",
  "ac ", "kamar mandi", "extra bed",
];

// `knowledgeSite` (2026-08-06, bug nyata - laporan Agus soal fallback Pexels utk brand
// baru "laundry in bali", bisnis laundry TIDAK terkait Pelangi/Harmoni sama sekali).
// Proteksi ini SENGAJA dibuat khusus utk brand properti (harga kamar/fasilitas Pelangi/
// Harmoni WAJIB footage asli, tidak boleh stok generik) - kalau brand-nya BUKAN properti
// sama sekali (knowledgeSite null, lihat pelangiKnowledge.ts), tidak ada risiko klaim
// harga/fasilitas PROPERTI ketempel footage generik - proteksi ini jadi tidak relevan &
// JUSTRU jadi bug: skrip laundry yg sah-sah saja sebut "harga cuci sepatu" salah kena
// blokir Pexels krn kata "harga"/"rp" ada di daftar, padahal tidak ada properti yg
// dipertaruhkan sama sekali.
export function isIdeSpesifikProperti(script: string, knowledgeSite?: string | null): boolean {
  if (!knowledgeSite) return false;
  const lower = script.toLowerCase();
  return KEYWORD_SPESIFIK_PROPERTI.some((kw) => lower.includes(kw));
}

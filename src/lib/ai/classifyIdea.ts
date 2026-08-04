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

export function isIdeSpesifikProperti(script: string): boolean {
  const lower = script.toLowerCase();
  return KEYWORD_SPESIFIK_PROPERTI.some((kw) => lower.includes(kw));
}

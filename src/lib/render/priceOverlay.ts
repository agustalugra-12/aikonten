// Deteksi harga untuk Price Overlay (animasi harga, 2026-10-29). MURNI, tanpa GPT: ambil
// kecocokan "Rp..." PERTAMA dari teks (skrip/narasi) → dipakai sbg value kartu statOverlay
// beranimasi. null kalau tak ada harga (kartu tak ditampilkan). Contoh: "Rp150.000/malam" ->
// "Rp150.000"; "Rp 150.000" -> "Rp150.000"; "Rp150rb" -> "Rp150rb".
export function extractPrice(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/Rp\s?\d[\d.,]*\s?(?:rb|ribu|jt|juta|k)?\b/i);
  if (!m) return null;
  const v = m[0]
    .replace(/\s+/g, "") // "Rp 150.000" -> "Rp150.000"
    .replace(/[.,]+$/, "") // buang pemisah di ujung ("Rp150.000." -> "Rp150.000")
    .replace(/^rp/i, "Rp"); // konsistenkan awalan
  return v;
}

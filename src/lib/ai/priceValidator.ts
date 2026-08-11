// Price Source of Truth - Anti-Hallucination Gate (2026-08-11, permintaan Agus - bug
// nyata: poster "laundry in bali" menampilkan "Rp100.000"/"50K" padahal harga itu TIDAK
// ADA di daftar harga resmi brand [harga asli: Rp5.000-11.000/kg, Rp20.000-35.000/item].
// BEDA dari factCheckCaption (factCheck.ts) - itu SENGAJA warning-only (skor GPT, fuzzy,
// perlu kalibrasi thd berbagai jenis klaim faktual). Validator INI khusus SATU jenis
// klaim (nominal Rupiah), murni deterministik (regex + cocokkan ANGKA, BUKAN GPT) -
// tidak ada abu-abu "cocok atau tidak" spt fact-check umum, jadi AMAN di-hard-enforce
// (strip) tanpa risiko kalibrasi yg bikin factCheckCaption sengaja warning-only.
//
// Dipakai di SEMUA jalur yg py klaim harga (posterCopy.ts, generateContent.ts caption/
// promoText/thumbnailText via processProject.ts) - SATU sumber kebenaran, bukan
// duplikat logic per tempat.
export type PriceValidationResult = { valid: boolean; invalidPrices: string[] };

// Match HANYA angka yg py penanda mata uang eksplisit ("Rp..." atau akhiran "rb"/
// "ribu"/"k") - SENGAJA tidak match angka polos berkoma-ribuan tanpa penanda (mis.
// "20.000 langkah", "300.000 penonton") supaya tidak salah tandai angka NON-harga
// sbg klaim harga (false positive) - konsisten dgn instruksi prompt generateContent.ts/
// posterCopy.ts yg SEMUANYA sudah diminta pakai format "Rp..."/"...K" utk harga.
const PRICE_PATTERN = /rp\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:rb|ribu|k)\b/gi;

function normalizeToDigits(raw: string): string {
  const hasThousandSuffix = /\b(rb|ribu|k)\b/i.test(raw) && !/rp/i.test(raw);
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return hasThousandSuffix ? `${digits}000` : digits;
}

function officialPriceDigitSet(officialKnowledge: string | null | undefined): Set<string> {
  const matches = (officialKnowledge || "").match(PRICE_PATTERN) || [];
  const set = new Set<string>();
  for (const m of matches) {
    const d = normalizeToDigits(m);
    if (d) set.add(d);
  }
  return set;
}

// Cek SEMUA klaim harga di `text` PERSIS cocok (angka, bukan cuma "mirip"/keyword) dgn
// salah satu harga di `officialKnowledge` - officialKnowledge kosong/null = TIDAK ADA
// sumber resmi, jadi SETIAP klaim harga otomatis invalid (tidak ada yg bisa
// dibandingkan, "tidak tahu" TIDAK SAMA dgn "aman").
export function validatePriceClaims(text: string, officialKnowledge: string | null | undefined): PriceValidationResult {
  const matches = text.match(PRICE_PATTERN) || [];
  if (matches.length === 0) return { valid: true, invalidPrices: [] };
  const officialDigits = officialPriceDigitSet(officialKnowledge);
  const invalidPrices: string[] = [];
  for (const raw of matches) {
    const digits = normalizeToDigits(raw);
    if (!digits || !officialDigits.has(digits)) invalidPrices.push(raw.trim());
  }
  return { valid: invalidPrices.length === 0, invalidPrices };
}

// Buang klaim harga yg TIDAK resmi dari teks (2026-08-11) - dipilih drpd regenerate GPT
// penuh (biaya+waktu 2x lipat) krn ini murni operasi deterministik string, hasilnya
// SELALU aman (hilang info harga, TIDAK PERNAH salah info harga) - selaras rekomendasi
// "regenerate tanpa harga ATAU gunakan harga resmi" (kedua opsi itu SAMA hasil akhirnya:
// tidak ada nominal palsu yg tayang). Harga yg PERSIS cocok dgn daftar resmi dibiarkan.
export function stripInvalidPrices(text: string, officialKnowledge: string | null | undefined): string {
  const officialDigits = officialPriceDigitSet(officialKnowledge);
  return text
    .replace(PRICE_PATTERN, (raw) => {
      const digits = normalizeToDigits(raw);
      return digits && officialDigits.has(digits) ? raw : "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?])/g, "$1")
    .trim();
}

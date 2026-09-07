import { parseBrollKeywordVariants, parseBrollKeywordArray, pickBrollKeyword } from "../src/lib/ai/deriveBrollKeywords";

// Verifikasi anti-monoton B-roll (2026-09-07, laporan Agus - "footage jangan monoton",
// dikerjakan sbg versi AMAN dari "per-scene footage" - lihat catatan lengkap di
// deriveBrollKeywords.ts kenapa scene-alignment presisi TIDAK dikerjakan [risiko ke
// sistem render yang sudah stabil], diganti rotasi antar beberapa varian keyword.

let failed = false;

function assertEqual<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL: ${msg} - got ${a}, expected ${e}`);
    failed = true;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// parseBrollKeywordVariants (jalur deriveBrollKeywordsFromScript - teks baris per baris)
assertEqual(
  parseBrollKeywordVariants("owl flying night hunting\nowl perched watching prey"),
  ["owl flying night hunting", "owl perched watching prey"],
  "parseBrollKeywordVariants: 2 baris valid dipisah benar"
);
assertEqual(
  parseBrollKeywordVariants("1. owl flying night\n- owl perched watching"),
  ["owl flying night", "owl perched watching"],
  "parseBrollKeywordVariants: bullet/numbering di awal baris dibuang"
);
assertEqual(parseBrollKeywordVariants(""), ["nature scenery"], "parseBrollKeywordVariants: kosong -> fallback netral");
assertEqual(parseBrollKeywordVariants("   \n  \n"), ["nature scenery"], "parseBrollKeywordVariants: cuma whitespace -> fallback netral");

// parseBrollKeywordArray (jalur generateContent.ts - JSON array dari 1 panggilan gabungan)
assertEqual(
  parseBrollKeywordArray(["tropical garden", "homestay pool"]),
  ["tropical garden", "homestay pool"],
  "parseBrollKeywordArray: array string valid dipakai apa adanya"
);
assertEqual(parseBrollKeywordArray(null), [], "parseBrollKeywordArray: null -> array kosong");
assertEqual(parseBrollKeywordArray("tropical garden"), [], "parseBrollKeywordArray: string polos (format lama) -> array kosong, bukan crash");
assertEqual(parseBrollKeywordArray(["ok", 123, "  ", "trim me  "]), ["ok", "trim me"], "parseBrollKeywordArray: buang non-string & string kosong, trim whitespace");

// pickBrollKeyword (rotasi round-robin per iterasi loop top-up)
assertEqual(pickBrollKeyword(["a", "b", "c"], 0), "a", "pickBrollKeyword: index 0 -> variant pertama");
assertEqual(pickBrollKeyword(["a", "b", "c"], 1), "b", "pickBrollKeyword: index 1 -> variant kedua");
assertEqual(pickBrollKeyword(["a", "b", "c"], 3), "a", "pickBrollKeyword: index 3 (lebih besar dari jumlah variant) -> putar balik ke pertama");
assertEqual(pickBrollKeyword(["a", "b", "c"], 100), "b", "pickBrollKeyword: index besar (loop top-up panjang) -> tetap aman via modulo");
assertEqual(pickBrollKeyword([], 0), "nature scenery", "pickBrollKeyword: array kosong -> fallback netral, bukan crash");

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}

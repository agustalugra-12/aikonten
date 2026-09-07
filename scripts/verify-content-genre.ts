import { parseContentGenre } from "../src/lib/ai/researchTopics";

// Verifikasi Content Genre-Aware Scoring (2026-09-07, audit "AI Konten Fase 7-10" §7.8 -
// "tidak semua konten pakai formula sama"). PURE LOGIC saja (parseContentGenre) - bobot
// penilaian genre-aware sendiri ada di dalam prompt scoring (suggestScoredContentIdeas),
// tidak bisa diverifikasi tanpa panggilan API beneran, jadi yang diuji di sini cuma
// jaring pengaman kode: hasil AI di luar 4 pilihan HARUS jatuh ke "other", bukan crash
// atau nilai sembarangan.

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

assertEqual(parseContentGenre("educational"), "educational", "genre valid 'educational' dipakai apa adanya");
assertEqual(parseContentGenre("entertainment"), "entertainment", "genre valid 'entertainment' dipakai apa adanya");
assertEqual(parseContentGenre("storytelling"), "storytelling", "genre valid 'storytelling' dipakai apa adanya");
assertEqual(parseContentGenre("other"), "other", "genre valid 'other' dipakai apa adanya");
assertEqual(parseContentGenre("comedy"), "other", "genre di luar 4 pilihan -> fallback 'other'");
assertEqual(parseContentGenre(undefined), "other", "field hilang total -> fallback 'other'");
assertEqual(parseContentGenre(null), "other", "null -> fallback 'other'");
assertEqual(parseContentGenre(123), "other", "tipe salah (number) -> fallback 'other', tidak crash");

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}

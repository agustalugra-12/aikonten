import { DIMENSION_WEIGHTS, clampScore } from "../src/lib/ai/contentIntelligence";

// Verifikasi Content Intelligence Score (Task Plan 2) - MURNI cek weight math + clampScore,
// TIDAK memanggil AI beneran (no API cost). judgeCreativeQuality() sendiri tidak diimpor
// langsung krn dia panggil OpenAI - fallback try/catch-nya sudah cukup jelas dari kode
// (return heuristicFallback apa adanya kalau caption/script kosong ATAU exception).

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

{
  const total = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
  assertEqual(Math.round(total * 100) / 100, 1.0, "weights: 6 dimensi (productionQuality dihapus) total 1.0");
}
{
  assertEqual(DIMENSION_WEIGHTS.contentDiversity, 0.25, "weights: contentDiversity naik 0.20->0.25 (nampung bekas productionQuality)");
}
{
  assertEqual("productionQuality" in DIMENSION_WEIGHTS, false, "weights: productionQuality sudah tidak ada");
}
{
  assertEqual(clampScore(150, 50), 100, "clampScore: >100 dipotong ke 100");
  assertEqual(clampScore(-10, 50), 0, "clampScore: <0 dipotong ke 0");
  assertEqual(clampScore("bukan angka", 50), 50, "clampScore: non-number fallback ke default");
  assertEqual(clampScore(undefined, 50), 50, "clampScore: undefined (AI gagal parse) fallback ke default");
  assertEqual(clampScore(72, 50), 72, "clampScore: angka valid dipakai apa adanya");
}

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}

// Verifikasi isNonRetryableFinishReason (2026-09-06, geminiImage.ts) - klasifier yang
// menentukan apakah generateImageWithGemini harus nyerah cepat (penolakan konten,
// input sama pasti ditolak lagi) vs tetap retry (kegagalan transien lain). Pengganti
// verify-fal-retry.ts (migrasi fal.ai -> Gemini API langsung).
// Jalankan: npx tsx scripts/verify-gemini-image-retry.ts

import { isNonRetryableFinishReason } from "../src/lib/ai/geminiImage";

let failed = false;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed = true;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

assert(isNonRetryableFinishReason("SAFETY"), "SAFETY -> true (nyerah cepat)");
assert(isNonRetryableFinishReason("IMAGE_SAFETY"), "IMAGE_SAFETY -> true (nyerah cepat)");
assert(isNonRetryableFinishReason("PROHIBITED_CONTENT"), "PROHIBITED_CONTENT -> true (nyerah cepat)");
assert(isNonRetryableFinishReason("BLOCKLIST"), "BLOCKLIST -> true (nyerah cepat)");
assert(isNonRetryableFinishReason("SPII"), "SPII -> true (nyerah cepat)");
assert(isNonRetryableFinishReason("RECITATION"), "RECITATION -> true (nyerah cepat)");
assert(!isNonRetryableFinishReason("STOP"), "STOP -> false (sukses normal, bukan penolakan)");
assert(!isNonRetryableFinishReason("OTHER"), "OTHER -> false (tetap retry, bukan penolakan konten spesifik)");
assert(!isNonRetryableFinishReason(undefined), "undefined -> false (tidak crash)");

if (failed) {
  console.error("\nADA YANG GAGAL");
  process.exit(1);
}
console.log("\nSEMUA LOLOS");

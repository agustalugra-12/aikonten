// Verifikasi shouldForceAiOverMatchedPhoto (2026-08-25, permintaan Agus - Laundry in Bali
// poster/carousel 90% full-AI walau ada foto asli match). Jalankan: npx tsx scripts/verify-laundry-ai-bias.ts

import { shouldForceAiOverMatchedPhoto, LAUNDRY_IN_BALI_BRAND_ID } from "../src/lib/pipeline/autoContent";

let failed = false;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed = true;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

assert(
  shouldForceAiOverMatchedPhoto(LAUNDRY_IN_BALI_BRAND_ID, true, () => 0.0),
  "Laundry in Bali, allowAi=true, rng=0.0 (di bawah 90%) -> force AI (true)"
);
assert(
  shouldForceAiOverMatchedPhoto(LAUNDRY_IN_BALI_BRAND_ID, true, () => 0.89),
  "Laundry in Bali, rng=0.89 (89% < 90%) -> force AI (true)"
);
assert(
  !shouldForceAiOverMatchedPhoto(LAUNDRY_IN_BALI_BRAND_ID, true, () => 0.95),
  "Laundry in Bali, rng=0.95 (95% >= 90%) -> pakai foto asli (false) - 10% kasus"
);
assert(
  !shouldForceAiOverMatchedPhoto(LAUNDRY_IN_BALI_BRAND_ID, false, () => 0.0),
  "Laundry in Bali TAPI allowAiGeneratedPhotos=false -> tidak pernah force (false)"
);
assert(
  !shouldForceAiOverMatchedPhoto("brand_j4nZcwImZsFy", true, () => 0.0),
  "Brand LAIN (Pelangi) walau rng=0.0 -> tidak pernah force (false), perilaku lama tidak berubah"
);

if (failed) {
  console.error("\nADA YANG GAGAL");
  process.exit(1);
}
console.log("\nSEMUA LOLOS");

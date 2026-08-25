// Verifikasi isContentPolicyViolation (2026-08-25, falRetry.ts) - klasifier yang
// menentukan apakah subscribeFalWithRetry harus nyerah cepat (422 content_policy_
// violation, input sama pasti ditolak lagi) vs tetap retry (kegagalan transien lain).
// Jalankan: npx tsx scripts/verify-fal-retry.ts

import { isContentPolicyViolation } from "../src/lib/ai/falRetry";

let failed = false;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed = true;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// Bentuk error nyata dari log Aug 24/25 (fal-ai/nano-banana-2/edit, ApiError body.detail).
const realContentPolicyErr = {
  status: 422,
  body: { detail: [{ type: "content_policy_violation", msg: "The content could not be processed..." }] },
};
assert(isContentPolicyViolation(realContentPolicyErr), "422 + content_policy_violation di body -> true (nyerah cepat)");

assert(!isContentPolicyViolation({ status: 422, body: { detail: "field X invalid" } }), "422 tanpa content_policy_violation -> false (tetap retry, validasi biasa)");
assert(!isContentPolicyViolation(new Error("fetch failed")), "network error biasa -> false (tetap retry)");
assert(!isContentPolicyViolation({ status: 500, body: {} }), "500 server error -> false (tetap retry)");
assert(!isContentPolicyViolation(null), "null -> false (tidak crash)");
assert(!isContentPolicyViolation(undefined), "undefined -> false (tidak crash)");

if (failed) {
  console.error("\nADA YANG GAGAL");
  process.exit(1);
}
console.log("\nSEMUA LOLOS");

// Verification gate Phase 2 (Creator Benchmark) - PRD Agustap Studio §2.1.A, §2.12.
// Fast-path saja (URL tidak valid/tidak bisa diakses) - tidak butuh network/API key
// nyata utk lolos gate ini (semua analyzeInspiration di baliknya balik
// SOURCE_UNAVAILABLE sebelum panggil OpenAI, lihat verify-agustap-inspiration-
// analyzer.ts).
//
// Jalankan dengan: npx --yes tsx scripts/verify-agustap-creator-benchmark.ts

import {
  buildCreatorBenchmarkFromContentUrls,
  tryDiscoverContentUrlsFromAccount,
  CREATOR_BENCHMARK_V1_SEED,
} from "../src/lib/agustap/creatorBenchmark";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("Running Agustap Creator Benchmark verification gate\n");

  const discovered = await tryDiscoverContentUrlsFromAccount("bukan-url-valid");
  check(
    "tryDiscoverContentUrlsFromAccount: URL akun tidak valid -> array kosong (§2.12 fallback), tidak crash",
    Array.isArray(discovered) && discovered.length === 0
  );

  const result = await buildCreatorBenchmarkFromContentUrls(
    ["bukan-url-valid-1", "bukan-url-valid-2"],
    "Test Creator"
  );
  check(
    "buildCreatorBenchmarkFromContentUrls: semua link tidak bisa diakses -> NO_CONTENT_ANALYZED (zero API cost)",
    !result.ok && result.error === "NO_CONTENT_ANALYZED"
  );

  const emptyResult = await buildCreatorBenchmarkFromContentUrls([], "Test Creator");
  check(
    "buildCreatorBenchmarkFromContentUrls: array kosong -> NO_CONTENT_ANALYZED, tidak crash",
    !emptyResult.ok && emptyResult.error === "NO_CONTENT_ANALYZED"
  );

  check(
    "CREATOR_BENCHMARK_V1_SEED: 6 creator sesuai PRD §2.9",
    CREATOR_BENCHMARK_V1_SEED.length === 6 &&
      CREATOR_BENCHMARK_V1_SEED.every((c) => c.name.trim().length > 0 && c.role.trim().length > 0)
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

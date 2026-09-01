// Verification gate Phase 1 Foundation - PRD Agustap Studio §45 "Feature Flag
// Safety": FLAG=OFF -> tidak ada Agustap behavior apa pun; FLAG=ON + brand=Agustap
// -> aktif; FLAG=ON + brand!=Agustap -> TETAP tidak aktif (brand isolation §42).
//
// Jalankan dengan: npx --yes tsx scripts/verify-agustap-feature-flag.ts

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

async function withEnv<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED;
  if (value === undefined) delete process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED;
  else process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED;
    else process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED = prev;
  }
}

async function main() {
  console.log("Running Agustap feature-flag verification gate\n");

  await withEnv(undefined, async () => {
    // Reset module cache tiap skenario supaya baca process.env fresh (fungsi baca
    // langsung tiap panggilan, tapi tetap re-import utk konsistensi gaya file lain).
    delete require.cache[require.resolve("../src/lib/agustap/featureFlag")];
    const { isAgustapContentIntelligenceEnabled, isAgustapExtensionActive } = await import(
      "../src/lib/agustap/featureFlag"
    );
    check("FLAG tidak di-set -> isAgustapContentIntelligenceEnabled() false", !isAgustapContentIntelligenceEnabled());
    check("FLAG tidak di-set + brand Agustap -> tetap tidak aktif", !isAgustapExtensionActive("agustap_studio"));
  });

  await withEnv("false", async () => {
    delete require.cache[require.resolve("../src/lib/agustap/featureFlag")];
    const { isAgustapContentIntelligenceEnabled, isAgustapExtensionActive } = await import(
      "../src/lib/agustap/featureFlag"
    );
    check("FLAG=false -> disabled", !isAgustapContentIntelligenceEnabled());
    check("FLAG=false + brand Agustap -> tetap tidak aktif", !isAgustapExtensionActive("agustap_studio"));
  });

  await withEnv("true", async () => {
    delete require.cache[require.resolve("../src/lib/agustap/featureFlag")];
    const { isAgustapContentIntelligenceEnabled, isAgustapExtensionActive } = await import(
      "../src/lib/agustap/featureFlag"
    );
    check("FLAG=true -> enabled", isAgustapContentIntelligenceEnabled());
    check(
      "FLAG=true + brand Agustap Studio -> AKTIF",
      isAgustapExtensionActive("agustap_studio")
    );
    check(
      "FLAG=true + brand LAIN (mis. pelangi) -> TETAP TIDAK aktif (brand isolation §42)",
      !isAgustapExtensionActive("pelangi")
    );
    check(
      "FLAG=true + brand null/kosong -> TETAP TIDAK aktif",
      !isAgustapExtensionActive(null) && !isAgustapExtensionActive(undefined) && !isAgustapExtensionActive("")
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

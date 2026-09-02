// Verification gate - wiring src/lib/pipeline/autoContent.ts <-> Agustap
// Generation Strategy (2026-09-02). PALING PENTING: brand lain (knowledgeSite !=
// "agustap_studio") HARUS dapat `script` PERSIS SAMA kembali, TANPA query DB
// tambahan/panggilan API apa pun (§42 Brand Isolation) - regresi di sini berarti
// SEMUA brand lain (Pelangi, Laundry in Bali, Animal Story) ikut terdampak.
//
// Jalankan dengan: npx --yes tsx scripts/verify-agustap-pipeline-wiring.ts

import { applyAgustapStrategyIfActive } from "../src/lib/agustap/generationStrategy";

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

function fakeBrand(overrides: Record<string, unknown>) {
  return {
    id: "brand_fake_test_only",
    name: "Fake Brand",
    positioning: null,
    toneOfVoice: null,
    targetAudience: null,
    knowledgeSite: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function main() {
  console.log("Running Agustap pipeline wiring verification gate\n");

  const originalScript = "Ide konten asli dari suggestContentIdeas - JANGAN diubah";

  await (async () => {
    const prev = process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED;
    process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED = "true";
    try {
      const resultPelangi = await applyAgustapStrategyIfActive(
        fakeBrand({ knowledgeSite: "pelangi" }),
        originalScript
      );
      check(
        "Brand LAIN (knowledgeSite='pelangi') + flag ON -> script TIDAK BERUBAH (brand isolation §42)",
        resultPelangi === originalScript
      );

      const resultNull = await applyAgustapStrategyIfActive(fakeBrand({ knowledgeSite: null }), originalScript);
      check(
        "Brand tanpa knowledgeSite + flag ON -> script TIDAK BERUBAH",
        resultNull === originalScript
      );
    } finally {
      if (prev === undefined) delete process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED;
      else process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED = prev;
    }
  })();

  await (async () => {
    const prev = process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED;
    delete process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED; // default OFF
    try {
      const result = await applyAgustapStrategyIfActive(
        fakeBrand({ knowledgeSite: "agustap_studio" }),
        originalScript
      );
      check(
        "Brand Agustap Studio TAPI flag default OFF -> script TIDAK BERUBAH (§45)",
        result === originalScript
      );
    } finally {
      if (prev === undefined) delete process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED;
      else process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED = prev;
    }
  })();

  await (async () => {
    const prev = process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED;
    process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED = "true";
    try {
      // brand.id palsu -> query competitors pasti 0 baris -> §2.7 zero benchmark
      // aktif -> script tidak berubah, TANPA panggil OpenAI sama sekali.
      const result = await applyAgustapStrategyIfActive(
        fakeBrand({ id: "brand_tidak_pernah_ada_xyz", knowledgeSite: "agustap_studio" }),
        originalScript
      );
      check(
        "Brand Agustap + flag ON tapi 0 benchmark aktif -> script TIDAK BERUBAH (§2.7, zero API cost)",
        result === originalScript
      );
    } finally {
      if (prev === undefined) delete process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED;
      else process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED = prev;
    }
  })();

  await (async () => {
    const prev = process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED;
    process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED = "true";
    try {
      // inspirationId palsu (tidak pernah ada di manual_ideas) + 0 benchmark aktif ->
      // contentInspiration tetap null (query balik kosong) -> §2.7 -> script tidak
      // berubah, TANPA panggil OpenAI (zero cost, tidak crash walau id ngawur).
      const result = await applyAgustapStrategyIfActive(
        fakeBrand({ id: "brand_tidak_pernah_ada_xyz", knowledgeSite: "agustap_studio" }),
        originalScript,
        "insp_tidak_pernah_ada_xyz"
      );
      check(
        "Brand Agustap + inspirationId tidak valid/tidak ada + 0 benchmark -> script TIDAK BERUBAH, tidak crash (§2.19)",
        result === originalScript
      );
    } finally {
      if (prev === undefined) delete process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED;
      else process.env.AGUSTAP_CONTENT_INTELLIGENCE_ENABLED = prev;
    }
  })();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

// Verification gate Phase 3 - PRD Agustap Studio §17-18. Cuma tes fast-path yang
// TIDAK butuh network/API key nyata (principles kosong -> null, zero cost). Alur
// penuh (LLM transform + embedding originality check) butuh API key OpenAI asli -
// diverifikasi manual/live saat wiring end-to-end, bukan di gate unit ini.
//
// Jalankan dengan: npx --yes tsx scripts/verify-agustap-content-transformer.ts

import { transformInspirationToAgustapConcept } from "../src/lib/agustap/contentTransformer";
import type { InspirationPrinciples } from "../src/lib/agustap/inspirationAnalyzer";

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

const EMPTY_PRINCIPLES: InspirationPrinciples = {
  hookPattern: "",
  topic: "",
  angle: "",
  problemFraming: "",
  curiosityMechanism: "",
  storytellingStructure: "",
  pacing: "",
  educationalStructure: "",
  ctaPattern: "",
  psychology: "",
};

async function main() {
  console.log("Running Agustap Content Transformer verification gate\n");

  const result = await transformInspirationToAgustapConcept(
    "Agustap Studio",
    { positioning: "-", toneOfVoice: "-", targetAudience: "-" },
    EMPTY_PRINCIPLES
  );
  check(
    "transformInspirationToAgustapConcept: principles kosong total -> null (zero API cost, tidak crash)",
    result === null
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

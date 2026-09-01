// Verification gate - PRD Agustap Studio §2.7 "Content Inspiration sebagai
// optional input": kalau tidak ada benchmark aktif MAUPUN inspiration, modul ini
// TIDAK boleh memanggil OpenAI sama sekali (caller pakai existing generator apa
// adanya) - zero cost, tidak butuh network/API key nyata.
//
// Jalankan dengan: npx --yes tsx scripts/verify-agustap-generation-strategy.ts

import { buildAgustapContentStrategy } from "../src/lib/agustap/generationStrategy";

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
  console.log("Running Agustap Generation Strategy verification gate\n");

  const result = await buildAgustapContentStrategy(
    "Agustap Studio",
    "Kenapa konten UMKM sepi?",
    { positioning: "-", toneOfVoice: "-", targetAudience: "-" },
    [],
    null
  );
  check(
    "buildAgustapContentStrategy: 0 benchmark aktif + tanpa inspiration -> null (§2.7, zero API cost)",
    result === null
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

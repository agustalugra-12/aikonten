import { generateAudienceSegmentation, SEGMENT_RECOMMENDATION_LABELS } from "../src/lib/ai/audienceSegmentation";
import type { MonthlyReportData } from "../src/lib/reports/monthlyReportData";

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

function assertTrue(actual: boolean, msg: string) {
  assertEqual(actual, true, msg);
}

async function main() {
  // Guard: < 5 konten -> EMPTY_RESULT, TIDAK memanggil OpenAI sama sekali (tidak butuh
  // OPENAI_API_KEY utk lolos cek ini - kalau ini gagal krn error API key, berarti guard-nya
  // tidak dicek duluan sebelum panggil client).
  const sedikit: MonthlyReportData = {
    windowDays: 30, totalContent: 3, totalViews: 3000, avgEngagementRate: 2,
    bestContent: null, worstContent: null,
    byPillar: [], byContentType: [], byHookType: [], byStructure: [],
  };
  const result = await generateAudienceSegmentation("Brand Test", sedikit);
  assertEqual(result.segments, [], "guard <5 konten: segments kosong (tanpa panggil OpenAI)");
  assertEqual(result.totalAnalyzed, 0, "guard <5 konten: totalAnalyzed 0");
  assertTrue(!/seklarserasi/i.test(result.summary), "bug bahasa 2026-08-20 (kata rusak 'seklarserasi') sudah tidak ada di summary");

  // Bug bahasa 2026-08-20 lainnya: label rekomendasi "maintain" sempat jadi kata ngaco
  // "Pawalai" (model gratisan yang rusak) - pastikan sudah jadi bahasa Indonesia yang benar.
  assertEqual(SEGMENT_RECOMMENDATION_LABELS.maintain, "Pertahankan", "label rekomendasi 'maintain' = 'Pertahankan' (bukan 'Pawalai')");

  if (failed) {
    console.error("\n=== ADA YANG GAGAL ===");
    process.exit(1);
  } else {
    console.log("\n=== SEMUA PASS ===");
  }
}

main();

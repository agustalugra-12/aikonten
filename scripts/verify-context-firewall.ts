import { filterTrendsForContextFirewall, type TrendOpportunity } from "../src/lib/ai/trendAdaptation";

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

function trend(overrides: Partial<TrendOpportunity>): TrendOpportunity {
  return {
    trend: "t", relevanceScore: 50, competitorUsage: "none", audienceRelevance: "medium",
    recommendation: "monitor", trendStage: "emerging", reasoning: "r", mechanismNote: null,
    ...overrides,
  };
}

{
  const result = filterTrendsForContextFirewall([
    trend({ trend: "A", recommendation: "ignore", mechanismNote: null }),
    trend({ trend: "B", recommendation: "ignore", mechanismNote: "hook curiosity reusable" }),
    trend({ trend: "C", recommendation: "act_now", reasoning: "views tinggi" }),
    trend({ trend: "D", recommendation: "monitor", reasoning: "cukup relevan", mechanismNote: "pacing cepat" }),
  ]);
  assertEqual(result.length, 3, "firewall: tren genuinely irrelevant (A) dibuang, sisanya 3 lolos");
  assertEqual(result[0], "hook curiosity reusable", "firewall: B pakai mechanismNote (bukan topik mentah)");
  assertEqual(result[1], "C - views tinggi", "firewall: C (act_now, tanpa mechanismNote) pakai trend - reasoning");
  assertEqual(result[2], "pacing cepat", "firewall: D pakai mechanismNote walau recommendation bukan ignore");
}
{
  assertEqual(filterTrendsForContextFirewall([]), [], "firewall: array kosong -> kosong");
}

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}

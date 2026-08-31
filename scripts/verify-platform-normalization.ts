import { tallyPlatformPerformance, classifyPlatformPerformance } from "../src/lib/ai/platformNormalization";

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

// tallyPlatformPerformance
{
  const perf = tallyPlatformPerformance([
    { platform: "tiktok", views: 1000 },
    { platform: "tiktok", views: 2000 },
    { platform: "instagram", views: 100 },
    { platform: "instagram", views: null },
  ]);
  assertEqual(perf.get("tiktok"), { avgViews: 1500, count: 2 }, "tally: tiktok avg 1500, count 2");
  assertEqual(perf.get("instagram"), { avgViews: 100, count: 1 }, "tally: instagram null view diabaikan, avg 100 count 1");
}

// classifyPlatformPerformance
{
  const baseline = { avgViews: 1000, count: 5 };
  assertEqual(classifyPlatformPerformance(1600, baseline), { multiplier: 1.6, tier: "winner" }, "classify: 1.6x baseline -> winner");
  assertEqual(classifyPlatformPerformance(400, baseline), { multiplier: 0.4, tier: "underperformer" }, "classify: 0.4x baseline -> underperformer");
  assertEqual(classifyPlatformPerformance(1000, baseline), { multiplier: 1, tier: "average" }, "classify: 1.0x baseline -> average");
  assertEqual(classifyPlatformPerformance(1500, baseline), { multiplier: 1.5, tier: "winner" }, "classify: tepat 1.5x -> winner (boundary inclusive)");
  assertEqual(classifyPlatformPerformance(500, baseline), { multiplier: 0.5, tier: "underperformer" }, "classify: tepat 0.5x -> underperformer (boundary inclusive)");
}
{
  // count < 3 (MINIMUM_HISTORY) - jangan pernah klaim winner/underperformer dari sample kecil
  assertEqual(
    classifyPlatformPerformance(5000, { avgViews: 1000, count: 2 }),
    { multiplier: null, tier: "baseline_building" },
    "classify: baseline count<3 -> baseline_building walau views jauh lebih tinggi"
  );
  assertEqual(
    classifyPlatformPerformance(1000, undefined),
    { multiplier: null, tier: "baseline_building" },
    "classify: platform belum pernah ada baseline sama sekali -> baseline_building"
  );
}

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}

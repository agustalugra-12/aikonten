import { tallyMediumPerformance, classifyIdeaExperimentTier } from "../src/lib/ai/contentVariety";

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

// tallyMediumPerformance
{
  const perf = tallyMediumPerformance([
    { type: "video", views: 1000 },
    { type: "video", views: 2000 },
    { type: "carousel", views: 500 },
    { type: "carousel", views: null },
  ]);
  assertEqual(perf.get("video"), { avgViews: 1500, count: 2 }, "tally: video avg 1500, count 2");
  assertEqual(perf.get("carousel"), { avgViews: 500, count: 1 }, "tally: carousel null view diabaikan, avg 500 count 1");
}

// classifyIdeaExperimentTier
{
  const perf = tallyMediumPerformance([
    { type: "video", views: 3000 },
    { type: "video", views: 3000 },
    { type: "carousel", views: 500 },
  ]);
  assertEqual(classifyIdeaExperimentTier("video", perf), "proven", "classify: video (avgViews tertinggi) -> proven");
  assertEqual(classifyIdeaExperimentTier("carousel", perf), "variation", "classify: carousel (avgViews lebih rendah) -> variation");
  assertEqual(classifyIdeaExperimentTier("foto", perf), "variation", "classify: foto dilebur ke bucket carousel -> variation");
}
{
  const perf = tallyMediumPerformance([{ type: "video", views: 1000 }]);
  assertEqual(classifyIdeaExperimentTier("carousel", perf), "experiment", "classify: medium belum pernah dicoba -> experiment");
  assertEqual(classifyIdeaExperimentTier(null, perf), null, "classify: contentType null -> null");
}
{
  // Brand baru, belum ada performanceViews sama sekali
  assertEqual(classifyIdeaExperimentTier("video", new Map()), "experiment", "classify: brand baru tanpa data -> experiment");
}

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}

import { mergeAgencySummaries, parsePeerUrls, type AgencyFetchResult, type AgencyBrandSummary } from "../src/lib/agency/aggregate";

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

function fakeBrand(id: string): AgencyBrandSummary {
  return {
    brandId: id, brandName: id, statusCounts: {}, totalContentAllTime: 0,
    weekly: { windowDays: 7, windowStart: "", totalPublished: 0, byPillar: [], byPlatform: [], topContent: [], underperformingContent: [], topContentDataAvailable: false },
  };
}

// parsePeerUrls
{
  assertEqual(parsePeerUrls(undefined), [], "parsePeerUrls: undefined -> array kosong");
  assertEqual(parsePeerUrls(""), [], "parsePeerUrls: string kosong -> array kosong");
  assertEqual(parsePeerUrls("https://a.com"), ["https://a.com"], "parsePeerUrls: 1 URL");
  assertEqual(
    parsePeerUrls("https://a.com/, https://b.com , https://c.com/"),
    ["https://a.com", "https://b.com", "https://c.com"],
    "parsePeerUrls: multi-URL, trim spasi & trailing slash dibuang"
  );
}

// mergeAgencySummaries
{
  const results: AgencyFetchResult[] = [
    { source: "local", brands: [fakeBrand("pelangi"), fakeBrand("harmoni")], error: null },
    { source: "peer1", brands: [fakeBrand("laundry")], error: null },
  ];
  assertEqual(
    mergeAgencySummaries(results).map((b) => b.brandId),
    ["pelangi", "harmoni", "laundry"],
    "merge: semua sumber sukses digabung"
  );
}
{
  // Peer gagal (server down/network error) - JANGAN blank seluruh halaman, brand dari
  // sumber lain (local) tetap muncul.
  const results: AgencyFetchResult[] = [
    { source: "local", brands: [fakeBrand("pelangi")], error: null },
    { source: "peer1", brands: [], error: "fetch failed" },
  ];
  assertEqual(
    mergeAgencySummaries(results).map((b) => b.brandId),
    ["pelangi"],
    "merge: sumber error dibuang, sumber sukses tetap tampil"
  );
}
{
  assertEqual(mergeAgencySummaries([]), [], "merge: tidak ada sumber sama sekali -> array kosong");
}

if (failed) {
  console.error("\n=== ADA YANG GAGAL ===");
  process.exit(1);
} else {
  console.log("\n=== SEMUA PASS ===");
}

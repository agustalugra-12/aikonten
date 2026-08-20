import { generatePredictivePerformance } from "../src/lib/ai/predictivePerformance";
import type { MonthlyReportData, PerformanceTrendSplit } from "../src/lib/reports/monthlyReportData";

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

function basePerformance(overrides: Partial<MonthlyReportData> = {}): MonthlyReportData {
  return {
    windowDays: 30,
    totalContent: 20,
    totalViews: 200000,
    avgEngagementRate: 4.2,
    bestContent: null,
    worstContent: null,
    byPillar: [{ label: "edukasi", avgViews: 12000, count: 8 }, { label: "promo", avgViews: 8000, count: 12 }],
    byContentType: [{ label: "reels", avgViews: 11000, count: 15 }, { label: "carousel", avgViews: 6000, count: 5 }],
    byHookType: [{ label: "curiosity", avgViews: 13000, count: 10 }, { label: "problem", avgViews: 7000, count: 10 }],
    byStructure: [{ label: "AIDA", avgViews: 10000, count: 20 }],
    ...overrides,
  };
}

async function main() {
  // Guard: < 15 konten -> EMPTY_RESULT, tanpa peduli trendSplit
  {
    const result = await generatePredictivePerformance(
      basePerformance({ totalContent: 10 }),
      { firstHalfAvgViews: 1000, secondHalfAvgViews: 2000, firstHalfCount: 5, secondHalfCount: 5 } as PerformanceTrendSplit,
      30,
    );
    assertEqual(result.predictedContents, [], "guard <15 konten: predictedContents kosong");
    assertTrue(result.methodology.includes("Tidak cukup data"), "guard <15 konten: methodology jelaskan alasan");
  }

  // Bug nyata 2026-08-20 (kasus sebelum fix): trend HARUS dari waktu publish sungguhan
  // (trendSplit), BUKAN dari urutan array kategori byPillar/byContentType/dst.
  // Skenario: paruh kedua (belakangan) views-nya NAIK jauh dari paruh pertama -> trend "up".
  {
    const result = await generatePredictivePerformance(
      basePerformance(),
      { firstHalfAvgViews: 5000, secondHalfAvgViews: 9000, firstHalfCount: 10, secondHalfCount: 10 } as PerformanceTrendSplit,
      30,
    );
    assertTrue(result.predictedContents.every((c) => c.trendDirection === "up"), "trend naik: semua predictedContents.trendDirection = 'up'");
    assertTrue(result.methodology.includes("10 konten") , "methodology menyebut jumlah konten tiap paruh (bukti pakai trendSplit sungguhan)");
  }

  // Skenario turun: paruh kedua lebih rendah dari paruh pertama -> trend "down"
  {
    const result = await generatePredictivePerformance(
      basePerformance(),
      { firstHalfAvgViews: 9000, secondHalfAvgViews: 5000, firstHalfCount: 10, secondHalfCount: 10 } as PerformanceTrendSplit,
      30,
    );
    assertTrue(result.predictedContents.every((c) => c.trendDirection === "down"), "trend turun: semua predictedContents.trendDirection = 'down'");
    assertTrue(result.predictedContents.every((c) => c.predictedViews <= c.avgViews), "trend turun: predictedViews <= avgViews (faktor < 1)");
  }

  // Skenario stabil (dalam ±10%) -> trend "stable"
  {
    const result = await generatePredictivePerformance(
      basePerformance(),
      { firstHalfAvgViews: 8000, secondHalfAvgViews: 8200, firstHalfCount: 10, secondHalfCount: 10 } as PerformanceTrendSplit,
      30,
    );
    assertTrue(result.predictedContents.every((c) => c.trendDirection === "stable"), "trend stabil (dalam ±10%): trendDirection = 'stable'");
  }

  // Salah satu paruh kosong (semua konten dipublish di 1 paruh saja) -> fallback ke totalAvg,
  // TIDAK boleh crash/NaN.
  {
    const result = await generatePredictivePerformance(
      basePerformance(),
      { firstHalfAvgViews: null, secondHalfAvgViews: 7000, firstHalfCount: 0, secondHalfCount: 20 } as PerformanceTrendSplit,
      30,
    );
    assertTrue(result.predictedContents.every((c) => Number.isFinite(c.predictedViews)), "paruh pertama kosong: predictedViews tetap angka valid (tidak NaN)");
  }

  if (failed) {
    console.error("\n=== ADA YANG GAGAL ===");
    process.exit(1);
  } else {
    console.log("\n=== SEMUA PASS ===");
  }
}

main();

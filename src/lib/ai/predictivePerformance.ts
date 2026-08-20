import type { MonthlyReportData, PerformanceTrendSplit } from "@/lib/reports/monthlyReportData";

export type PredictedContent = {
  label: string;
  avgViews: number;
  predictedViews: number;
  predictedEngagementRate: number;
  confidence: "high" | "medium" | "low";
  trendDirection: "up" | "stable" | "down";
};

export type PredictivePerformanceResult = {
  predictedContents: PredictedContent[];
  overallPredictedViews: number;
  overallPredictedEngagementRate: number;
  analysisPeriodDays: number;
  forecastPeriodDays: number;
  methodology: string;
};

const EMPTY_RESULT: PredictivePerformanceResult = {
  predictedContents: [],
  overallPredictedViews: 0,
  overallPredictedEngagementRate: 0,
  analysisPeriodDays: 0,
  forecastPeriodDays: 0,
  methodology: "Tidak cukup data untuk prediksi (minimal 15 konten tayang dalam 2 periode).",
};

export async function generatePredictivePerformance(
  ownPerformance: MonthlyReportData,
  trendSplit: PerformanceTrendSplit,
  forecastDays: number = 30,
): Promise<PredictivePerformanceResult> {
  // Guard: minimal 15 konten dalam 2 periode untuk bisa menentukan trend
  if (ownPerformance.totalContent < 15) {
    return EMPTY_RESULT;
  }

  // Hitung baseline average dari semua dimensi
  const allStats = ownPerformance.byPillar
    .concat(ownPerformance.byContentType)
    .concat(ownPerformance.byHookType)
    .concat(ownPerformance.byStructure);
  const totalAvg = allStats.reduce((sum, s) => sum + s.avgViews, 0) / allStats.length;

  // Faktor trend: perbandingan paruh-pertama vs paruh-kedua WAKTU (bukan kategori) -
  // trendSplit dihitung dari firstPublishedAt sungguhan (lihat getPerformanceTrendSplit di
  // monthlyReportData.ts). Fallback ke totalAvg kalau salah satu paruh kosong (mis. semua
  // konten dipublish di paruh pertama window saja) - jangan bagi dgn 0 konten.
  const firstHalfAvg = trendSplit.firstHalfAvgViews ?? totalAvg;
  const secondHalfAvg = trendSplit.secondHalfAvgViews ?? totalAvg;

  let trendDirection: "up" | "stable" | "down" = "stable";
  if (secondHalfAvg > firstHalfAvg * 1.1) trendDirection = "up";
  else if (secondHalfAvg < firstHalfAvg * 0.9) trendDirection = "down";

  // Faktor prediksi: 80-120% dari baseline berdasarkan tren
  const predictedViewsFactor = Math.max(0.8, Math.min(1.2, secondHalfAvg / Math.max(firstHalfAvg, 1)));

  // Bangun predicted contents dari top dimensi
  const predictedContents: PredictedContent[] = [];

  // Ambil top dari masing-masing dimensi
  const topItems = [
    ...ownPerformance.byPillar.sort((a, b) => b.avgViews - a.avgViews).slice(0, 2),
    ...ownPerformance.byContentType.sort((a, b) => b.avgViews - a.avgViews).slice(0, 2),
    ...ownPerformance.byHookType.sort((a, b) => b.avgViews - a.avgViews).slice(0, 2),
    ...ownPerformance.byStructure.sort((a, b) => b.avgViews - a.avgViews).slice(0, 2),
  ];

  const seen = new Set<string>();
  for (const item of topItems.slice(0, 10)) {
    const label = `${item.label} (${item.avgViews > 0 ? Math.round(item.avgViews) : 0}v)`;
    if (!seen.has(label) && predictedContents.length < 5) {
      seen.add(label);
      predictedContents.push({
        label,
        avgViews: item.avgViews,
        predictedViews: Math.round(item.avgViews * predictedViewsFactor),
        predictedEngagementRate: ownPerformance.avgEngagementRate !== null
          ? Math.round(Math.max(0, ownPerformance.avgEngagementRate * 0.95) * 100) / 100
          : 0,
        confidence: "medium",
        trendDirection,
      });
    }
  }

  // Urutkan berdasarkan predictedViews turun
  predictedContents.sort((a, b) => b.predictedViews - a.predictedViews);

  // Hitung overall predicted stats
  const overallPredictedViews = predictedContents.length > 0
    ? predictedContents.reduce((sum, c) => sum + c.predictedViews, 0) / predictedContents.length
    : totalAvg * predictedViewsFactor;

  const overallPredictedEngagementRate = ownPerformance.avgEngagementRate !== null
    ? Math.round(
        (ownPerformance.avgEngagementRate *
          predictedContents.reduce((sum, c) => sum + c.predictedEngagementRate, 0) /
          predictedContents.length) / 100
        ) * 100
    : 0;

  return {
    predictedContents,
    overallPredictedViews,
    overallPredictedEngagementRate,
    analysisPeriodDays: ownPerformance.windowDays,
    forecastPeriodDays: forecastDays,
    methodology:
      `Extrapolasi dari rata-rata performa konten berdasar tanggal publish sungguhan - ` +
      `paruh awal (${trendSplit.firstHalfCount} konten) vs paruh akhir (${trendSplit.secondHalfCount} konten) ` +
      `dari ${ownPerformance.windowDays} hari terakhir. Dimensi dengan performa tertinggi = contender.`,
  };
}

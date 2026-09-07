import { NextRequest, NextResponse } from "next/server";
import { getMonthlyReportData, getPerformanceTrendSplit } from "@/lib/reports/monthlyReportData";
import { generatePredictivePerformance } from "@/lib/ai/predictivePerformance";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Predictive Performance (P2 High) - ON-DEMAND (tombol, BUKAN auto tiap load).
// Prediksi performa konten di periode mendatang berdasarkan data historical.
// Zero cost: hanyalah extrapolasi statistik dari data brand sendiri, tanpa model ML.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;

  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const ownPerformance = await getMonthlyReportData(brandId, 30);

  // Guard: minimal data sufficient for prediction
  if (ownPerformance.totalContent < 15) {
    return NextResponse.json({
      predictedContents: [],
      overallPredictedViews: 0,
      overallPredictedEngagementRate: 0,
      analysisPeriodDays: 30,
      forecastPeriodDays: 30,
      methodology: "Butuh minimal 15 konten tayang dalam 30 hari terakhir untuk prediksi performa.",
    });
  }

  const trendSplit = await getPerformanceTrendSplit(brandId, 30);
  const result = await generatePredictivePerformance(ownPerformance, trendSplit, 30);
  return NextResponse.json(result);
}
import { NextRequest, NextResponse } from "next/server";
import { getMonthlyReportData } from "@/lib/reports/monthlyReportData";
import { generateStrategicRecommendation } from "@/lib/ai/monthlyStrategicRecommendation";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Laporan Bulanan (2026-08-19, PRD §31-33, scope dikurangi - lihat catatan lengkap di
// monthlyReportData.ts soal §34 SWOT Update yang TIDAK dibangun). Beda dari
// weekly-report: endpoint ini memanggil AI (generateStrategicRecommendation) - ada biaya
// nyata tiap panggilan, TIDAK di-cache di v1 ini (laporan bulanan wajar dibuka jarang,
// beda dgn dashboard analitik yang dibuka berkali-kali sehari - kalau ke depan
// penggunaannya ternyata sering & biayanya jadi masalah nyata, baru tambahkan cache
// pola sama dgn socialAccounts.cachedMetrics, JANGAN bangun cache duluan sblm terbukti
// perlu).
const DEFAULT_WINDOW_DAYS = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const days = Number(req.nextUrl.searchParams.get("days")) || DEFAULT_WINDOW_DAYS;
  const data = await getMonthlyReportData(brandId, days);
  const recommendation = await generateStrategicRecommendation(data);
  return NextResponse.json({ ...data, recommendation });
}

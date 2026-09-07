import { NextRequest, NextResponse } from "next/server";
import { getWeeklyReportData } from "@/lib/reports/weeklyReportData";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Laporan mingguan in-app (2026-08-19, PRD "AI Content Intelligence" §25-34, permintaan
// Agus - "semua itu penting": ranking + ringkasan aktivitas dulu, tren & PDF menyusul -
// lihat docs/HANDOFF_OPENCODE_2026-08-18.md utk urutan lengkap). READ-ONLY, tidak
// panggil Buffer API sama sekali - `performanceViews`/`performanceEngagementRate` sudah
// disinkron lazy oleh performanceLearning.ts, jadi laporan ini cukup baca data yang
// sudah ada di DB, murah & cepat. Logic agregasi ada di lib/reports/weeklyReportData.ts
// (dipakai bersama dgn endpoint PDF, lihat weekly-report/pdf/route.ts).
const DEFAULT_WINDOW_DAYS = 7;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const days = Number(req.nextUrl.searchParams.get("days")) || DEFAULT_WINDOW_DAYS;
  const data = await getWeeklyReportData(brandId, days);
  return NextResponse.json(data);
}

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getMonthlyReportData } from "@/lib/reports/monthlyReportData";
import { generateStrategicRecommendation } from "@/lib/ai/monthlyStrategicRecommendation";
import { MonthlyReportPdf } from "@/lib/reports/MonthlyReportPdf";
import { getUserId, getOwnedBrand } from "@/lib/session";

const DEFAULT_WINDOW_DAYS = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  const days = Number(req.nextUrl.searchParams.get("days")) || DEFAULT_WINDOW_DAYS;

  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const data = await getMonthlyReportData(brandId, days);
  const recommendation = await generateStrategicRecommendation(data);
  const buffer = await renderToBuffer(MonthlyReportPdf({ brandName: brand.name, data, recommendation }));

  const filename = `laporan-bulanan-${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

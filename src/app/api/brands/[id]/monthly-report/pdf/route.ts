import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getMonthlyReportData } from "@/lib/reports/monthlyReportData";
import { generateStrategicRecommendation } from "@/lib/ai/monthlyStrategicRecommendation";
import { MonthlyReportPdf } from "@/lib/reports/MonthlyReportPdf";

const DEFAULT_WINDOW_DAYS = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const days = Number(req.nextUrl.searchParams.get("days")) || DEFAULT_WINDOW_DAYS;

  const brand = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId)).limit(1);
  if (brand.length === 0) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const data = await getMonthlyReportData(brandId, days);
  const recommendation = await generateStrategicRecommendation(data);
  const buffer = await renderToBuffer(MonthlyReportPdf({ brandName: brand[0].name, data, recommendation }));

  const filename = `laporan-bulanan-${brand[0].name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

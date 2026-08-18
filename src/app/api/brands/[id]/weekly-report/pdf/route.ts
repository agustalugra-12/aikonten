import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getWeeklyReportData } from "@/lib/reports/weeklyReportData";
import { WeeklyReportPdf } from "@/lib/reports/WeeklyReportPdf";

// Export PDF laporan mingguan (2026-08-19, langkah terakhir Analytics/Reporting §25-34 -
// lihat docs/HANDOFF_OPENCODE_2026-08-18.md). Reuse PERSIS data yang sama dgn endpoint
// JSON (weekly-report/route.ts) - satu sumber kebenaran, cuma beda cara render.
const DEFAULT_WINDOW_DAYS = 7;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const days = Number(req.nextUrl.searchParams.get("days")) || DEFAULT_WINDOW_DAYS;

  const brand = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId)).limit(1);
  if (brand.length === 0) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const data = await getWeeklyReportData(brandId, days);
  const buffer = await renderToBuffer(WeeklyReportPdf({ brandName: brand[0].name, data }));

  const filename = `laporan-${brand[0].name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${days}hari.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

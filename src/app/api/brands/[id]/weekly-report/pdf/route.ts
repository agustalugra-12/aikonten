import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getWeeklyReportData } from "@/lib/reports/weeklyReportData";
import { WeeklyReportPdf } from "@/lib/reports/WeeklyReportPdf";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Export PDF laporan mingguan (2026-08-19, langkah terakhir Analytics/Reporting §25-34 -
// lihat docs/HANDOFF_OPENCODE_2026-08-18.md). Reuse PERSIS data yang sama dgn endpoint
// JSON (weekly-report/route.ts) - satu sumber kebenaran, cuma beda cara render.
const DEFAULT_WINDOW_DAYS = 7;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  const days = Number(req.nextUrl.searchParams.get("days")) || DEFAULT_WINDOW_DAYS;

  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const data = await getWeeklyReportData(brandId, days);
  const buffer = await renderToBuffer(WeeklyReportPdf({ brandName: brand.name, data }));

  const filename = `laporan-${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${days}hari.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

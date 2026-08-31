import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getWeeklyReportData } from "@/lib/reports/weeklyReportData";
import { sanitizeCell } from "@/lib/reports/csvExport";

// CSV export untuk Laporan Mingguan (Phase 6, PRD §49).
// Format: beberapa block (ringkasan, per pilar, top 5 konten) dipisah baris kosong.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const searchParams = req.nextUrl.searchParams;
  const days = Number(searchParams.get("days") || "7");

  const [brand] = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId));
  const data = await getWeeklyReportData(brandId, days);

  const brandName = brand?.name || brandId;
  const filename = `laporan-mingguan-${brandName.toLowerCase().replace(/\s+/g, "-")}-${days}hari.csv`;

  const lines: string[] = [];

  // Block 1: Ringkasan
  lines.push(["Window (hari)", "Window mulai", "Total konten tayang"].map(sanitizeCell).join(","));
  lines.push(
    [data.windowDays, data.windowStart, data.totalPublished].map(sanitizeCell).join(",")
  );

  lines.push("");

  // Block 2: Per pilar
  lines.push(["Pilar", "Jumlah konten"].map(sanitizeCell).join(","));
  if (data.byPillar.length === 0) {
    lines.push(["(tidak ada data)"].map(sanitizeCell).join(","));
  } else {
    for (const p of data.byPillar) {
      lines.push([p.pillar, p.count].map(sanitizeCell).join(","));
    }
  }

  lines.push("");

  // Block 3: Top 5 konten
  lines.push(
    ["Rank", "Platform", "Pilar", "Angle", "Caption", "Views", "Engagement (%)", "Dipublikasikan"]
      .map(sanitizeCell)
      .join(",")
  );
  if (!data.topContentDataAvailable || data.topContent.length === 0) {
    lines.push(["(tidak ada data performa)"].map(sanitizeCell).join(","));
  } else {
    data.topContent.forEach((c, i) => {
      lines.push(
        [
          i + 1,
          c.platform,
          c.pillar || "(tanpa pilar)",
          c.angle || "(tanpa angle)",
          c.captionSnippet,
          c.views ?? "(n/a)",
          c.engagementRate !== null ? c.engagementRate.toFixed(2) : "(n/a)",
          c.publishedAt || "(n/a)",
        ]
          .map(sanitizeCell)
          .join(",")
      );
    });
  }

  const csv = lines.join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

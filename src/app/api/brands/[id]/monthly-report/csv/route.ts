import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getMonthlyReportData } from "@/lib/reports/monthlyReportData";
import { sanitizeCell } from "@/lib/reports/csvExport";

// CSV export untuk Laporan Bulanan (Phase 6, PRD §49).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const searchParams = req.nextUrl.searchParams;
  const days = Number(searchParams.get("days") || "30");

  const [brand] = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId));
  const data = await getMonthlyReportData(brandId, days);

  const brandName = brand?.name || brandId;
  const filename = `laporan-bulanan-${brandName.toLowerCase().replace(/\s+/g, "-")}-${days}hari.csv`;

  const lines: string[] = [];

  // Block 1: Ringkasan eksekutif
  lines.push(
    ["Window (hari)", "Total konten", "Total views", "Rata-rata engagement (%)"].map(sanitizeCell).join(",")
  );
  lines.push(
    [
      data.windowDays,
      data.totalContent,
      data.totalViews,
      data.avgEngagementRate !== null ? data.avgEngagementRate.toFixed(2) : "(n/a)",
    ]
      .map(sanitizeCell)
      .join(",")
  );

  lines.push("");

  // Block 2: Best / Worst
  lines.push(["Jenis", "Caption", "Views"].map(sanitizeCell).join(","));
  lines.push(
    [
      "Terbaik",
      data.bestContent?.captionSnippet || "(tidak ada)",
      data.bestContent?.views ?? "(n/a)",
    ]
      .map(sanitizeCell)
      .join(",")
  );
  lines.push(
    [
      "Terlemah",
      data.worstContent?.captionSnippet || "(tidak ada)",
      data.worstContent?.views ?? "(n/a)",
    ]
      .map(sanitizeCell)
      .join(",")
  );

  lines.push("");

  // Helper untuk block breakdown
  function addBreakdownBlock(title: string, items: { label: string; avgViews: number; count: number }[]) {
    lines.push([title].map(sanitizeCell).join(","));
    lines.push(["Label", "Rata-rata views", "Jumlah konten"].map(sanitizeCell).join(","));
    if (items.length === 0) {
      lines.push(["(tidak ada data)"].map(sanitizeCell).join(","));
    } else {
      for (const item of items) {
        lines.push([item.label, item.avgViews, item.count].map(sanitizeCell).join(","));
      }
    }
    lines.push("");
  }

  addBreakdownBlock("Per Tipe Konten", data.byContentType);
  addBreakdownBlock("Per Pilar", data.byPillar);
  addBreakdownBlock("Per Tipe Hook", data.byHookType);
  addBreakdownBlock("Per Struktur Video", data.byStructure);

  // Hapus baris kosong ekstra di akhir
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const csv = lines.join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { competitors, brands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getMonthlyReportData } from "@/lib/reports/monthlyReportData";
import { generateTrendAdaptation } from "@/lib/ai/trendAdaptation";

// Trend Adaptation (PRD §40) - ON-DEMAND (tombol, BUKAN auto tiap load).
// Pola sama dgn competitor-analysis/route.ts: satu GPT call, zero cost baru.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;

  const brand = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId)).limit(1);
  if (brand.length === 0) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const comps = await db.select().from(competitors).where(eq(competitors.brandId, brandId));
  const ownPerformance = await getMonthlyReportData(brandId, 30);

  // Guard: minimal ada data performa
  if (ownPerformance.totalContent < 3) {
    return NextResponse.json({ trends: [], summary: "Belum ada data cukup untuk analisis tren (minimal 3 konten tayang)." });
  }

  const result = await generateTrendAdaptation(brand[0].name, comps, ownPerformance);
  return NextResponse.json(result);
}

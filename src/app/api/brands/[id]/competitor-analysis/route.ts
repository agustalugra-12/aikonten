import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { competitors, brands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getMonthlyReportData } from "@/lib/reports/monthlyReportData";
import { generateCompetitorIntelligence } from "@/lib/ai/competitorAnalysis";

// Content Gap + SWOT (PRD §5-8) - generate ON-DEMAND (tombol, BUKAN auto tiap load spt
// monthly-report) krn butuh staf sudah isi catatan kompetitor dulu supaya bermakna,
// beda dari laporan performa yg datanya selalu ada. Tidak di-cache (sama alasan
// monthly-report - dibuka jarang, cache ditambah nanti kalau terbukti perlu).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;

  const brand = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId)).limit(1);
  if (brand.length === 0) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const comps = await db.select().from(competitors).where(eq(competitors.brandId, brandId));
  const ownPerformance = await getMonthlyReportData(brandId, 30);
  const result = await generateCompetitorIntelligence(brand[0].name, comps, ownPerformance);

  return NextResponse.json(result);
}

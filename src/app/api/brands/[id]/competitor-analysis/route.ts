import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { competitors, brands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getMonthlyReportData } from "@/lib/reports/monthlyReportData";
import { generateCompetitorIntelligence, buildBrandContext } from "@/lib/ai/competitorAnalysis";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Content Gap + SWOT (PRD §5-8) - generate ON-DEMAND (tombol, BUKAN auto tiap load spt
// monthly-report) krn butuh staf sudah isi catatan kompetitor dulu supaya bermakna,
// beda dari laporan performa yg datanya selalu ada. Tidak di-cache (sama alasan
// monthly-report - dibuka jarang, cache ditambah nanti kalau terbukti perlu).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;

  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const comps = await db.select().from(competitors).where(eq(competitors.brandId, brandId));
  const ownPerformance = await getMonthlyReportData(brandId, 30);
  // brandContext (2026-11-07, disetujui Agus): identitas brand SENDIRI sebagai konteks
  // relevansi, supaya SWOT tidak cuma membandingkan performa per tipe konten. Dibangun
  // dari kolom pendek tabel `brands` (BUKAN manual_knowledge mentah 14rb karakter) dan
  // dijamin bebas harga / nama paket / jumlah kredit oleh buildBrandContext().
  const brandContext = buildBrandContext(brand);
  const result = await generateCompetitorIntelligence(brand.name, comps, ownPerformance, brandContext);

  // Persist (T3-rework 2026-11-02) - simpan Content Gap + SWOT ke brands.swotAnalysis supaya
  // dipakai daily planner (dailyContentPlanner->suggestScoredContentIdeas) TANPA regenerate
  // (hemat 1 panggilan API/hari). getOwnedBrand di atas sudah jamin kepemilikan.
  await db.update(brands).set({ swotAnalysis: JSON.stringify(result) }).where(eq(brands.id, brandId));

  return NextResponse.json(result);
}

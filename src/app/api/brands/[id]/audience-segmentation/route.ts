import { NextRequest, NextResponse } from "next/server";
import { getMonthlyReportData } from "@/lib/reports/monthlyReportData";
import { generateAudienceSegmentation } from "@/lib/ai/audienceSegmentation";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Audience Segmentation (P2 Medium) - ON-DEMAND (tombol, BUKAN auto tiap load).
// Menganalisis kombinasi pillar/content type/hook/structure yang performa-nya baik
// untuk mengidentifikasi segmen audiens yang sejalan. Zero cost: hanya GPT-4.1-mini
// menganalisis data performa brand sendiri, tanpa model ML atau clustering matematika.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;

  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const ownPerformance = await getMonthlyReportData(brandId, 30);

  // Guard: minimal data sufficient for segmentation
  if (ownPerformance.totalContent < 5) {
    return NextResponse.json({
      segments: [],
      summary: "Belum cukup data konten tayang (minimal 5 konten) untuk segmentasi audiens.",
      totalAnalyzed: 0,
    });
  }

  const result = await generateAudienceSegmentation(brand.name, ownPerformance);
  return NextResponse.json(result);
}
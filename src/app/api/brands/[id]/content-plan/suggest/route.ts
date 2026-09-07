import { NextRequest, NextResponse } from "next/server";
import { generateContentPlanSuggestions } from "@/lib/ai/contentPlanSuggestions";
import { getUserId, getOwnedBrand } from "@/lib/session";

// AI Content Planning Engine - saran ON-DEMAND (tombol "AI Sarankan Rencana", pola
// sama dgn competitor-analysis - BUKAN auto tiap load, ada biaya AI nyata tiap
// panggilan). Non-binding: hasil TIDAK disimpan di sini sama sekali, staf terima per
// saran lewat POST /api/brands/[id]/manual-ideas (body JSON {idea}).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const suggestions = await generateContentPlanSuggestions(brandId);
  return NextResponse.json({ suggestions });
}

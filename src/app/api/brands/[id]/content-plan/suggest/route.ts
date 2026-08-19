import { NextRequest, NextResponse } from "next/server";
import { generateContentPlanSuggestions } from "@/lib/ai/contentPlanSuggestions";

// AI Content Planning Engine - saran ON-DEMAND (tombol "AI Sarankan Rencana", pola
// sama dgn competitor-analysis - BUKAN auto tiap load, ada biaya AI nyata tiap
// panggilan). Non-binding: hasil TIDAK disimpan di sini sama sekali, staf terima per
// saran lewat POST /api/brands/[id]/manual-ideas (body JSON {idea}).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const suggestions = await generateContentPlanSuggestions(brandId);
  return NextResponse.json({ suggestions });
}

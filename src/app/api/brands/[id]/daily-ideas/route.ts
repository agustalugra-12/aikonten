import { NextRequest, NextResponse } from "next/server";
import { getOrGenerateDailyIdeas, forceRegenerateDailyIdeas, markDailyIdeaUsed } from "@/lib/ai/dailyContentPlanner";

// AI Content Planner (2026-08-05, permintaan Agus) - GET ambil batch 10 ide hari ini
// (lazy-generate kalau belum ada), POST paksa regenerasi batch baru (tombol "🔄" di
// UI - kalau Agus tidak suka batch hari ini), PATCH tandai 1 ide sudah dipakai
// (dipanggil dari komponen setelah project berhasil dibuat dari ide itu).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  try {
    const ideas = await getOrGenerateDailyIdeas(brandId);
    return NextResponse.json({ ideas });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  try {
    const ideas = await forceRegenerateDailyIdeas(brandId);
    return NextResponse.json({ ideas });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { ideaId } = await req.json();
  if (!ideaId || typeof ideaId !== "string") {
    return NextResponse.json({ error: "ideaId wajib diisi" }, { status: 400 });
  }
  await markDailyIdeaUsed(ideaId);
  return NextResponse.json({ ok: true });
}

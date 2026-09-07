import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dailyIdeas } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getOrGenerateDailyIdeas, forceRegenerateDailyIdeas, markDailyIdeaUsed } from "@/lib/ai/dailyContentPlanner";
import { getUserId, getOwnedBrand } from "@/lib/session";

// AI Content Planner (2026-08-05, permintaan Agus) - GET ambil batch 10 ide hari ini
// (lazy-generate kalau belum ada), POST paksa regenerasi batch baru (tombol "🔄" di
// UI - kalau Agus tidak suka batch hari ini), PATCH tandai 1 ide sudah dipakai
// (dipanggil dari komponen setelah project berhasil dibuat dari ide itu).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  try {
    const ideas = await getOrGenerateDailyIdeas(brandId);
    return NextResponse.json({ ideas });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  try {
    const ideas = await forceRegenerateDailyIdeas(brandId);
    return NextResponse.json({ ideas });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Isolasi (2026-09-07, Fase 1 Alur D) - versi LAMA (repo asal KontenPilot internal)
// terima ideaId APA PUN tanpa cek brand sama sekali (tidak perlu di sana, single-admin).
// Fork INI wajib pastikan idea yang ditandai "used" itu BENAR milik brand yang dimiliki
// userId yang login - sebelum ini pelanggan A bisa menandai/memanipulasi idea pelanggan
// B asal tahu/tebak ideaId-nya.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const { ideaId } = await req.json();
  if (!ideaId || typeof ideaId !== "string") {
    return NextResponse.json({ error: "ideaId wajib diisi" }, { status: 400 });
  }
  const [existing] = await db.select({ id: dailyIdeas.id }).from(dailyIdeas).where(and(eq(dailyIdeas.id, ideaId), eq(dailyIdeas.brandId, brandId)));
  if (!existing) {
    return NextResponse.json({ error: "Ide tidak ditemukan" }, { status: 404 });
  }
  await markDailyIdeaUsed(ideaId);
  return NextResponse.json({ ok: true });
}

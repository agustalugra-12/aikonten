import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contentPlan, users } from "@/db/schema";
import { durasiTargetDiizinkan, DURASI_EKSTERNAL } from "@/lib/billing/durasiVideo";
import { and, eq } from "drizzle-orm";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Content Planner editable (2026-10-05, Fase 1). PATCH = simpan editan 1 baris (inline-edit
// tabel). DELETE = hapus 1 baris. Ownership dicek lewat brandId (id) + baris wajib milik
// brand itu (guard di WHERE, bukan cuma 404 brand).
const EDITABLE = [
  "date", "slotIndex", "contentType", "orientation", "carouselCount", "carouselVisual",
  "footageSource", "pillar", "hook", "topic", "scriptBrief", "draftCaption", "draftHashtags", "status", "autoMode", "videoDuration",
] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const userId = getUserId(req);
  const { id: brandId, rowId } = await params;
  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  // Durasi per-baris: tenant eksternal hanya 30-60 dtk (2026-11-05, durasiVideo.ts).
  if (body.videoDuration != null) {
    const [pemilik] = await db.select({ unlimited: users.unlimited }).from(users).where(eq(users.id, brand.userId));
    if (!durasiTargetDiizinkan(Number(body.videoDuration), pemilik?.unlimited)) {
      return NextResponse.json({ error: `Durasi video ${body.videoDuration} detik tidak tersedia untuk paket ini. Pilih ${DURASI_EKSTERNAL.min}-${DURASI_EKSTERNAL.max} detik.` }, { status: 400 });
    }
  }
  const update: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (k in body) {
      update[k] = k === "draftHashtags" && Array.isArray(body[k]) ? JSON.stringify(body[k]) : body[k];
    }
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Tidak ada field yang diubah" }, { status: 400 });
  }
  update.updatedAt = new Date();
  await db.update(contentPlan).set(update).where(and(eq(contentPlan.id, rowId), eq(contentPlan.brandId, brandId)));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const userId = getUserId(req);
  const { id: brandId, rowId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  await db.delete(contentPlan).where(and(eq(contentPlan.id, rowId), eq(contentPlan.brandId, brandId)));
  return NextResponse.json({ ok: true });
}

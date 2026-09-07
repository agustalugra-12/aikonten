import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { competitors } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserId, getOwnedBrand } from "@/lib/session";

// (2026-09-02) EXTEND - `active` opsional utk toggle Creator Benchmark
// Active/Inactive (PRD Agustap Studio §2.9, §2.16). Request lama {name, notes}
// dari brand lain TIDAK terpengaruh (field baru diabaikan kalau tidak dikirim).
//
// Isolasi (2026-09-07, Fase 1 Alur D) - competitors TIDAK punya userId langsung,
// kepemilikannya lewat brandId (params.id) -> getOwnedBrand. Dicek DUA hal: brand-nya
// milik user ini, DAN competitorId yang diminta BENAR milik brandId itu (bukan
// competitor brand lain yang kebetulan ID-nya ditebak).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; competitorId: string }> }) {
  const userId = getUserId(req);
  const { id: brandId, competitorId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const [existing] = await db.select({ id: competitors.id }).from(competitors).where(and(eq(competitors.id, competitorId), eq(competitors.brandId, brandId)));
  if (!existing) {
    return NextResponse.json({ error: "Kompetitor tidak ditemukan" }, { status: 404 });
  }

  const { name, notes, active } = await req.json();
  const update: { name?: string; notes?: string | null; updatedAt: Date; benchmarkActive?: boolean } = {
    updatedAt: new Date(),
  };
  if (typeof name === "string" && name.trim()) update.name = name.trim();
  if (typeof notes === "string" || notes === null) update.notes = notes;
  if (typeof active === "boolean") update.benchmarkActive = active;
  await db.update(competitors).set(update).where(eq(competitors.id, competitorId));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; competitorId: string }> }) {
  const userId = getUserId(req);
  const { id: brandId, competitorId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const [existing] = await db.select({ id: competitors.id }).from(competitors).where(and(eq(competitors.id, competitorId), eq(competitors.brandId, brandId)));
  if (!existing) {
    return NextResponse.json({ error: "Kompetitor tidak ditemukan" }, { status: 404 });
  }
  await db.delete(competitors).where(eq(competitors.id, competitorId));
  return NextResponse.json({ ok: true });
}

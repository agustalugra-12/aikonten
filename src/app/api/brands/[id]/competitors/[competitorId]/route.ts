import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { competitors } from "@/db/schema";
import { eq } from "drizzle-orm";

// (2026-09-02) EXTEND - `active` opsional utk toggle Creator Benchmark
// Active/Inactive (PRD Agustap Studio §2.9, §2.16). Request lama {name, notes}
// dari brand lain TIDAK terpengaruh (field baru diabaikan kalau tidak dikirim).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; competitorId: string }> }) {
  const { competitorId } = await params;
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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; competitorId: string }> }) {
  const { competitorId } = await params;
  await db.delete(competitors).where(eq(competitors.id, competitorId));
  return NextResponse.json({ ok: true });
}

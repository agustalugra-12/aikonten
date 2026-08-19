import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { competitors } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; competitorId: string }> }) {
  const { competitorId } = await params;
  const { name, notes } = await req.json();
  const update: { name?: string; notes?: string | null; updatedAt: Date } = { updatedAt: new Date() };
  if (typeof name === "string" && name.trim()) update.name = name.trim();
  if (typeof notes === "string" || notes === null) update.notes = notes;
  await db.update(competitors).set(update).where(eq(competitors.id, competitorId));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; competitorId: string }> }) {
  const { competitorId } = await params;
  await db.delete(competitors).where(eq(competitors.id, competitorId));
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { competitors } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { newId } from "@/lib/ids";

// Competitor Intelligence - CRUD data kompetitor (2026-08-19, PRD §5, "tanpa API
// berbayar"). Input MANUAL staf - lihat catatan lengkap di db/schema.ts & AI
// lib/ai/competitorAnalysis.ts soal kenapa ini bukan integrasi otomatis.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const rows = await db.select().from(competitors).where(eq(competitors.brandId, brandId)).orderBy(desc(competitors.updatedAt));
  return NextResponse.json({ competitors: rows });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const { name, notes } = await req.json();
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Nama kompetitor wajib diisi" }, { status: 400 });
  }
  const now = new Date();
  const row = {
    id: newId("comp"),
    brandId,
    name: name.trim(),
    notes: typeof notes === "string" ? notes : null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(competitors).values(row);
  return NextResponse.json({ competitor: row });
}

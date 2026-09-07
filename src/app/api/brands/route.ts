import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { newId } from "@/lib/ids";
import { getUserId, canCreateAnotherBrand } from "@/lib/session";
import { desc, eq } from "drizzle-orm";

// Multi-tenant (2026-09-07, PRD "AI Konten by Agustap Studio" Fase 1, Alur D) - GANTI
// dari ADMIN_USER_ID statis (versi lama, lihat repo asal KontenPilot internal) - setiap
// akun cuma lihat/bikin brand miliknya sendiri. userId dari middleware.ts (x-user-id),
// bukan dipercaya dari body/query manapun.
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  const rows = await db.select().from(brands).where(eq(brands.userId, userId)).orderBy(desc(brands.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  const { name, description } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Nama brand wajib diisi" }, { status: 400 });
  }

  const quota = await canCreateAnotherBrand(userId);
  if (!quota.ok) {
    return NextResponse.json({ error: quota.reason }, { status: 403 });
  }

  const row = {
    id: newId("brand"),
    userId,
    name: name.trim(),
    description: description || null,
    createdAt: new Date(),
  };
  await db.insert(brands).values(row);
  return NextResponse.json(row, { status: 201 });
}

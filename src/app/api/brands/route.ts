import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { newId } from "@/lib/ids";
import { desc } from "drizzle-orm";

// Single-admin app (lihat PRD diskusi) - semua brand dimiliki 1 user tetap, jadi tidak
// perlu resolve user dari session utk multi-tenant. ADMIN_USER_ID statis dari env/seed.
const ADMIN_USER_ID = "user_admin";

export async function GET() {
  const rows = await db.select().from(brands).orderBy(desc(brands.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const { name, description } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Nama brand wajib diisi" }, { status: 400 });
  }

  const row = {
    id: newId("brand"),
    userId: ADMIN_USER_ID,
    name: name.trim(),
    description: description || null,
    createdAt: new Date(),
  };
  await db.insert(brands).values(row);
  return NextResponse.json(row, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contentPlan } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserId, getOwnedBrand } from "@/lib/session";
import { AutoContentError } from "@/lib/pipeline/autoContent";
import { runPlanRowGenerate } from "@/lib/pipeline/generatePlanRow";
import { withLock, brandAutoContentLockKey, LockBusyError } from "@/lib/concurrency/locks";

// Planner Fase 3 (2026-10-05) - "Generate" per baris MANUAL. Logika inti di
// lib/pipeline/generatePlanRow.ts (dipakai bareng cron auto-generate utk baris autoMode=auto).
// Di sini cukup bungkus withLock (serialisasi vs cron/manual) + mapping error.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const userId = getUserId(req);
  const { id: brandId, rowId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const [row] = await db.select().from(contentPlan).where(and(eq(contentPlan.id, rowId), eq(contentPlan.brandId, brandId)));
  if (!row) return NextResponse.json({ error: "Baris rencana tidak ditemukan" }, { status: 404 });
  if (row.status !== "direncanakan") {
    return NextResponse.json({ error: "Baris ini sudah digenerate/diproses." }, { status: 409 });
  }

  try {
    const projectId = await withLock(brandAutoContentLockKey(brandId), () => runPlanRowGenerate(row));
    return NextResponse.json({ ok: true, projectId });
  } catch (err) {
    if (err instanceof LockBusyError) {
      return NextResponse.json({ error: "Brand sedang memproses konten lain - tunggu lalu coba lagi." }, { status: 409 });
    }
    const status = err instanceof AutoContentError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserId, getOwnedProject } from "@/lib/session";
import { newId } from "@/lib/ids";

// Ganti footage (2026-10-05, Fase B - permintaan Agus) - owner pilih footage pengganti
// (bank/upload/pexels). Ganti baris raw_footage project; RE-RENDER dilakukan lewat
// POST /api/projects/[id]/process terpisah (kredit & lock ditangani di sana). Endpoint ini
// cuma tukar sumber, TIDAK charge kredit & tidak hapus aset final (process yg menimpa).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  if (!(await getOwnedProject(userId, id))) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const rawItems: unknown[] = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.filter(
    (it): it is { fileUrl: string; durationSeconds?: number } =>
      !!it && typeof (it as { fileUrl?: unknown }).fileUrl === "string"
  );
  if (items.length === 0) {
    return NextResponse.json({ error: "Pilih minimal 1 footage pengganti." }, { status: 400 });
  }
  await db.delete(mediaAssets).where(and(eq(mediaAssets.projectId, id), eq(mediaAssets.type, "raw_footage")));
  const now = new Date();
  await db.insert(mediaAssets).values(
    items.map((it) => ({
      id: newId("asset"),
      projectId: id,
      type: "raw_footage" as const,
      fileUrl: it.fileUrl,
      durationSeconds: typeof it.durationSeconds === "number" ? it.durationSeconds : null,
      createdAt: now,
    }))
  );
  return NextResponse.json({ ok: true, count: items.length });
}

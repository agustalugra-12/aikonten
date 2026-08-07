import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mediaAssets, projects } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { processProject } from "@/lib/pipeline/processProject";
import { publishProject } from "@/lib/publish/orchestrate";

// "Coba Lagi" pintar (2026-08-07, permintaan Agus - konten yg SUDAH jadi videonya/
// gambarnya sempat "tampil" [status ready] lalu "hilang lagi" krn status jatuh ke
// "failed" - ternyata generate-nya SUKSES, yg gagal cuma publish ke Buffer [rate
// limit]. Retry via /process (generate ulang total dari awal - transcript, render,
// dst) BOROS & SALAH SASARAN utk kasus ini - cukup panggil publishProject ulang
// (idempotent per-akun, lihat orchestrate.ts). Endpoint ini yg MEMUTUSKAN mana yg
// tepat: kalau final_video/final_image SUDAH ada, publish-only; kalau belum ada sama
// sekali (gagal duluan sebelum render selesai, mis. "Video hasil render cuma 23
// detik"), generate ulang penuh via processProject.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }

  const finalAssets = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.projectId, id), inArray(mediaAssets.type, ["final_video", "final_image"])));

  try {
    if (finalAssets.length > 0) {
      await publishProject(id);
      const [updated] = await db.select().from(projects).where(eq(projects.id, id));
      return NextResponse.json({ ok: true, mode: "publish", ...updated });
    }
    const result = await processProject(id);
    return NextResponse.json({ ok: true, mode: "process", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

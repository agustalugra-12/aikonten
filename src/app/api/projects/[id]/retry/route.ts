import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mediaAssets, projects } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { processProject } from "@/lib/pipeline/processProject";
import { publishProject } from "@/lib/publish/orchestrate";
import { LockBusyError } from "@/lib/concurrency/locks";
import { getUserId, getOwnedProject } from "@/lib/session";
import { potongKredit, isiUlangKredit, SaldoTidakCukupError, CREDIT_COST_GENERATE } from "@/lib/billing/credits";
import { pastikanAkunBolehGenerate, AkunTerbatasError } from "@/lib/billing/statusGate";

// "Coba Lagi" pintar (2026-08-07, permintaan Agus - konten yg SUDAH jadi videonya/
// gambarnya sempat "tampil" [status ready] lalu "hilang lagi" krn status jatuh ke
// "failed" - ternyata generate-nya SUKSES, yg gagal cuma publish ke Buffer [rate
// limit]. Retry via /process (generate ulang total dari awal - transcript, render,
// dst) BOROS & SALAH SASARAN utk kasus ini - cukup panggil publishProject ulang
// (idempotent per-akun, lihat orchestrate.ts). Endpoint ini yg MEMUTUSKAN mana yg
// tepat: kalau final_video/final_image SUDAH ada, publish-only; kalau belum ada sama
// sekali (gagal duluan sebelum render selesai, mis. "Video hasil render cuma 23
// detik"), generate ulang penuh via processProject.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;

  const project = await getOwnedProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }

  const finalAssets = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.projectId, id), inArray(mediaAssets.type, ["final_video", "final_image"])));

  if (finalAssets.length > 0) {
    // Mode publish-only - TIDAK memanggil processProject, tidak ada biaya generate baru,
    // jangan potong kredit (2026-09-08, Fase 1 Alur B).
    try {
      await publishProject(id);
      const [updated] = await db.select().from(projects).where(eq(projects.id, id));
      return NextResponse.json({ ok: true, mode: "publish", ...updated });
    } catch (err) {
      if (err instanceof LockBusyError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Mode process - generate ulang penuh, sama gate & biaya dgn /process (potong dulu,
  // refund kalau gagal total - sama pola & alasan dgn process/route.ts).
  try {
    await pastikanAkunBolehGenerate(userId);
  } catch (err) {
    if (err instanceof AkunTerbatasError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const biaya = CREDIT_COST_GENERATE[project.type];
  try {
    await potongKredit(userId, biaya, `generate_${project.type}`, id);
  } catch (err) {
    if (err instanceof SaldoTidakCukupError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    throw err;
  }

  try {
    const result = await processProject(id);
    return NextResponse.json({ ok: true, mode: "process", ...result });
  } catch (err) {
    await isiUlangKredit(userId, biaya, "refund_gagal");
    if (err instanceof LockBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { processProject } from "@/lib/pipeline/processProject";
import { LockBusyError } from "@/lib/concurrency/locks";
import { getUserId, getOwnedProject } from "@/lib/session";
import { potongKredit, isiUlangKredit, SaldoTidakCukupError, CREDIT_COST_GENERATE } from "@/lib/billing/credits";

// Trigger manual dari NewProjectDialog.tsx setelah upload footage selesai. Logika
// pipeline-nya sendiri ada di lib/pipeline/processProject.ts (dipakai bareng dgn
// /api/brands/[id]/auto-content, lihat memory proyek).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id } = await params;
  const project = await getOwnedProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }

  // Potong kredit SEBELUM generate (2026-09-08, Fase 1 Alur B) - biaya AI/render asli
  // terjadi apa pun hasil akhirnya, jadi ditagih di muka, bukan sesudah. Kalau
  // processProject gagal TOTAL (exception), refund penuh (alasan "refund_gagal") -
  // pelanggan tidak boleh bayar generate yang tidak menghasilkan apa-apa.
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
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    await isiUlangKredit(userId, biaya, "refund_gagal");
    // Lock per-projectId (2026-08-14, temuan #1) - project ini sedang diproses proses
    // lain, balikin 409 jelas drpd 500 generik.
    if (err instanceof LockBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    const status = message === "Project tidak ditemukan" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

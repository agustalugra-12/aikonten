import { NextRequest, NextResponse } from "next/server";
import { processProject } from "@/lib/pipeline/processProject";
import { LockBusyError } from "@/lib/concurrency/locks";
import { getUserId, getOwnedProject } from "@/lib/session";
import { potongKredit, isiUlangKredit, SaldoTidakCukupError, CREDIT_COST_GENERATE } from "@/lib/billing/credits";
import { pastikanAkunBolehGenerate, AkunTerbatasError } from "@/lib/billing/statusGate";
import { db } from "@/db";
import { brands, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hitungBiayaKredit, pastikanFormatDiizinkan, VideoPanjangTidakTersediaError } from "@/lib/billing/aturanProduk";
import { gateGenerateManual } from "@/lib/billing/generateGate";

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

  const gate = await gateGenerateManual(userId);
  if (gate.blocked) {
    return NextResponse.json(
      { error: `Terlalu banyak permintaan generate. Coba lagi dalam ${Math.ceil(gate.retryAfter / 60)} menit.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }

  // Aturan produk (2026-10-24): video panjang hanya brand internal (unlimited); biaya
  // carousel = jumlah slide. Divalidasi di backend SEBELUM potong kredit.
  const [brandProj] = await db.select().from(brands).where(eq(brands.id, project.brandId));
  const [pemilikProj] = await db.select({ unlimited: users.unlimited }).from(users).where(eq(users.id, userId));
  try {
    pastikanFormatDiizinkan({ type: project.type, contentFormat: project.contentFormat, videoDurationTarget: brandProj?.videoDurationTarget, unlimited: pemilikProj?.unlimited });
  } catch (err) {
    if (err instanceof VideoPanjangTidakTersediaError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  // Gate status akun (2026-09-08, Fase 1 Alur C) - "terbatas" = paket kadaluarsa lewat
  // masa tenggang, tidak boleh generate BARU (baca/download konten lama tetap boleh).
  try {
    await pastikanAkunBolehGenerate(userId);
  } catch (err) {
    if (err instanceof AkunTerbatasError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  // Potong kredit SEBELUM generate (2026-09-08, Fase 1 Alur B) - biaya AI/render asli
  // terjadi apa pun hasil akhirnya, jadi ditagih di muka, bukan sesudah. Kalau
  // processProject gagal TOTAL (exception), refund penuh (alasan "refund_gagal") -
  // pelanggan tidak boleh bayar generate yang tidak menghasilkan apa-apa.
  const biaya = hitungBiayaKredit(project.type, { contentFormat: project.contentFormat, carouselPhotosPerPost: brandProj?.carouselPhotosPerPost });
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

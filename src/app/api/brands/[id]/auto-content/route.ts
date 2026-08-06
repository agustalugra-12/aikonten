import { NextRequest, NextResponse } from "next/server";
import { runAutoContent, AutoContentError } from "@/lib/pipeline/autoContent";

// "⚡ Konten Otomatis" (lihat memory proyek: "otomatis seperti AI blog") - satu klik,
// TANPA upload apa pun. Logika inti diekstrak (2026-08-06) ke lib/pipeline/autoContent.ts
// supaya dipakai BARENG oleh /api/cron/auto-generate (batch harian brand
// publishMode="auto") - route ini sekarang cuma wrapper HTTP tipis, TIDAK ada perubahan
// perilaku dari sebelumnya.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const body = await req.json().catch(() => ({}));

  // `type` (2026-08-06, permintaan Agus - "buatkan 1 vidio", trigger manual TIDAK punya
  // cara memaksa tipe sama sekali sebelumnya - beda dari jalur cron auto-generate yang
  // sudah dapat desiredType dari daily_ideas.contentType, lihat catatan bug "konten
  // vidionya tidak ada malah foto semua" di autoContent.ts). Tanpa ini, trigger manual
  // SELALU jatuh ke heuristik lama (mediaType item pertama hasil match tema) - acak,
  // sama kelas bug yang sudah diperbaiki utk jalur cron tapi belum utk jalur manual ini.
  const desiredType = body.type === "video" || body.type === "foto" || body.type === "carousel" ? body.type : undefined;

  try {
    const result = await runAutoContent(brandId, body.script, desiredType);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const status = err instanceof AutoContentError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}

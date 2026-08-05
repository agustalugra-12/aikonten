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

  try {
    const result = await runAutoContent(brandId, body.script);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const status = err instanceof AutoContentError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}

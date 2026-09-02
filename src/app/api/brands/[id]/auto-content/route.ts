import { NextRequest, NextResponse } from "next/server";
import { runAutoContent, AutoContentError } from "@/lib/pipeline/autoContent";
import { tryAcquireLock, releaseLock, brandAutoContentLockKey } from "@/lib/concurrency/locks";

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

  // contentFormat (2026-08-13) - trigger manual sebelumnya TIDAK BISA memaksa
  // youtube_shorts spt jalur cron (lihat autoContent.ts: processProject.ts baca ini utk
  // paksa portrait+<=60dtk apa pun setting brand). Diteruskan opsional, tanpa ini
  // perilaku lama (ikut default brand) tetap sama persis.
  const contentFormat = body.contentFormat === "youtube_shorts" ? body.contentFormat : undefined;

  // Lock per-brand (2026-08-14, temuan #1 Lampiran D ENGINEERING_SAFETY.md) - key SAMA
  // dgn cron/auto-generate (brandAutoContentLockKey) supaya tombol manual ini & cron
  // saling block utk brand yg sama, bukan cuma sesama klik manual. Beda dari cron
  // (skip diam2), di sini REJECT JELAS ke UI (409) - ini aksi manual sadar, Agus perlu
  // tahu kalau klik-nya tidak diproses, bukan silent no-op.
  const lockKey = brandAutoContentLockKey(brandId);
  if (!tryAcquireLock(lockKey)) {
    return NextResponse.json(
      { error: "Brand ini sedang diproses (cron otomatis atau proses manual lain sedang jalan) - tunggu sampai selesai, lalu coba lagi." },
      { status: 409 }
    );
  }

  // Agustap Studio Content Inspiration (2026-09-02, PRD §2.19) - id `manual_ideas`
  // opsional dari dropdown "Inspiration" di UI. Diabaikan sepenuhnya utk brand lain
  // (guard brand isolation ada di applyAgustapStrategyIfActive, bukan di sini).
  const agustapInspirationId = typeof body.agustapInspirationId === "string" ? body.agustapInspirationId : undefined;

  try {
    const result = await runAutoContent(
      brandId, body.script, desiredType, contentFormat,
      undefined, undefined, undefined, undefined, undefined,
      agustapInspirationId
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const status = err instanceof AutoContentError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  } finally {
    releaseLock(lockKey);
  }
}

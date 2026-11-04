import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { runPublishSweep } from "@/lib/publish/sweepRunner";
import { sweepEnabled } from "@/lib/publish/sweep";
import { LedgerNotReadyError } from "@/lib/publish/ledger";

// Sweep verifikasi publish Buffer (feat/publish-guard) - dipanggil timer tiap 20 menit
// (scripts/cron/kontenpilot-publish-sweep.timer). BUFFER_SWEEP_ENABLED default OFF -> no-op (verifikasi
// lama yang berjalan). ON -> pending dari DB, 1 query `posts` per channel ber-pending, verifikasi + duplikat.
// ?dryRun=1 -> READ-ONLY: listRecentPosts + rekonsiliasi saja (tanpa delete/ubah DB/notif/cooldown);
// boleh dipanggil walau flag OFF (utk uji jalur baru sebelum diaktifkan).
export async function POST(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  if (!sweepEnabled() && !dryRun) return NextResponse.json({ ok: true, skipped: "BUFFER_SWEEP_ENABLED off - verifikasi lama aktif" });
  try {
    const report = await runPublishSweep({ dryRun, ignoreFlag: dryRun });
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    if (e instanceof LedgerNotReadyError) return NextResponse.json({ ok: false, error: e.message }, { status: 503 });
    throw e;
  }
}

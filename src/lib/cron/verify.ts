import { NextRequest, NextResponse } from "next/server";

// Endpoint cron internal (2026-08-06, permintaan Agus - infra scheduler dari nol, lihat
// PRD "draft atau langsung publis... jam berapa"). Dipanggil systemd timer via curl
// LOKAL (localhost, VPS yg sama - lihat scripts/cron/*.service), BUKAN dari internet
// luar - shared secret sederhana (sama pola dgn X-Internal-Key web-pelangi) cukup,
// bukan JWT/OAuth penuh.
export function verifyCronSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-key");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

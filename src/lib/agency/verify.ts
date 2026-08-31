import { NextRequest, NextResponse } from "next/server";

// Agency Dashboard (2026-08-26, PRD §32, Task Plan 4) - endpoint ini DIPANGGIL LEWAT
// INTERNET dari server lain (aikonten.agustapstudio.com <-> aimarketing.pelangihomestay.com,
// dua VPS terpisah, dua DB terpisah) - BEDA dari cron/verify.ts's CRON_SECRET yang secara
// eksplisit cuma localhost (lihat catatan di file itu). Secret terpisah drpd overload
// CRON_SECRET krn trust boundary-nya beda (internet-facing vs localhost-only).
export function verifyAgencySecret(req: NextRequest): NextResponse | null {
  const expected = process.env.AGENCY_API_SECRET;
  const provided = req.headers.get("x-agency-key");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

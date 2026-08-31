import { NextRequest, NextResponse } from "next/server";
import { verifyAgencySecret } from "@/lib/agency/verify";
import { getLocalAgencySummaries } from "@/lib/agency/aggregate";

// Agency Dashboard (2026-08-26, PRD §32, Task Plan 4) - endpoint READ-ONLY, dipanggil dari
// server LAIN (lihat verify.ts) utk agregasi lintas-brand di /agency (halaman itu cuma ada
// di aikonten.agustapstudio.com - server ini bisa saja cuma jadi SUMBER data kalau tidak
// dikonfigurasi AGENCY_PEER_URLS-nya sendiri). Logic ada di lib/agency/aggregate.ts supaya
// /agency/page.tsx juga bisa pakai LANGSUNG (tanpa HTTP loopback) utk data server sendiri.
export async function GET(req: NextRequest) {
  const unauthorized = verifyAgencySecret(req);
  if (unauthorized) return unauthorized;

  const summaries = await getLocalAgencySummaries();
  return NextResponse.json({ brands: summaries });
}

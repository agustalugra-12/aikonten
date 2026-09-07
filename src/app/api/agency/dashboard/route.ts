import { NextRequest, NextResponse } from "next/server";
import { getLocalAgencySummaries } from "@/lib/agency/aggregate";
import { getUserId, listOwnedBrandIds } from "@/lib/session";

// Agency Dashboard (2026-08-26, PRD §32, Task Plan 4) - endpoint utk BROWSER (auth
// sesi normal via middleware.ts).
//
// Isolasi + peer-aggregation DIHAPUS (2026-09-07, Fase 1 Alur D, fork multi-tenant) -
// versi LAMA (repo asal, single-admin) balikin SEMUA brand tanpa filter (aman di sana,
// cuma 1 operator) DAN gabung data dari server "peer" lain via AGENCY_PEER_URLS/
// AGENCY_API_SECRET (konsep "2 server milik Agus sendiri", TIDAK applicable ke
// multi-tenant - peer aggregation lintas-server berarti membocorkan brand pelanggan A
// ke server yang melayani pelanggan lain). Fork ini: HANYA brand milik userId yang
// login, TIDAK ADA agregasi peer sama sekali.
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  const brandIds = await listOwnedBrandIds(userId);
  const brands = await getLocalAgencySummaries(brandIds);
  return NextResponse.json({ brands, peerErrors: [] });
}

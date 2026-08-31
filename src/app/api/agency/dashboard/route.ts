import { NextResponse } from "next/server";
import { getLocalAgencySummaries, fetchPeerSummaries, mergeAgencySummaries, parsePeerUrls } from "@/lib/agency/aggregate";

// Agency Dashboard (2026-08-26, PRD §32, Task Plan 4) - endpoint utk BROWSER Agus (auth
// sesi normal via proxy.ts, BEDA dari brands-summary/route.ts yg utk server-ke-server).
// Dipanggil dari /agency/page.tsx, pola client-fetch yg SAMA dgn seluruh dashboard lain
// di app ini (semua page.tsx di app ini "use client" + fetch di useEffect - TIDAK ada
// server component dipakai di mana pun, jadi endpoint ini yg pegang AGENCY_API_SECRET/
// AGENCY_PEER_URLS server-side, bukan page.tsx-nya langsung).
export async function GET() {
  const local = await getLocalAgencySummaries();
  const peerUrls = parsePeerUrls(process.env.AGENCY_PEER_URLS);
  const secret = process.env.AGENCY_API_SECRET;

  const peerResults = peerUrls.length > 0 && secret ? await fetchPeerSummaries(peerUrls, secret) : [];
  const merged = mergeAgencySummaries([{ source: "local", brands: local, error: null }, ...peerResults]);
  const peerErrors = peerResults.filter((r) => r.error !== null).map((r) => ({ source: r.source, error: r.error }));

  return NextResponse.json({ brands: merged, peerErrors });
}

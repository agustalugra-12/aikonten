import { NextResponse } from "next/server";

// DINONAKTIFKAN utk fork multi-tenant (2026-09-07, Fase 1 Alur D). Endpoint asli
// (repo internal KontenPilot) melayani SEMUA brand lokal ke server "peer" mana pun yang
// tahu AGENCY_API_SECRET - model itu benar utk 2 server yang SAMA-SAMA milik Agus
// sendiri (internal), tapi FATAL kalau dibiarkan aktif di sini: 1 secret yang bocor
// akan mengekspos ringkasan brand SEMUA pelanggan sekaligus, tanpa cara membatasi ke
// pelanggan tertentu (endpoint ini secret-based, bukan per-akun). Konsep "Agency
// Dashboard lintas-server" tidak berlaku utk instalasi SaaS ini - setiap pelanggan
// cuma pernah punya brand di SATU instalasi (lihat /api/agency/dashboard, yang sudah
// dibatasi ke brand milik akun yang login).
export async function GET() {
  return NextResponse.json(
    { error: "Endpoint ini dinonaktifkan di instalasi multi-tenant - lihat /api/agency/dashboard" },
    { status: 410 }
  );
}

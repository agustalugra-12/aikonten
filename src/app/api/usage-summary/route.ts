import { NextResponse } from "next/server";

// DINONAKTIFKAN utk fork multi-tenant (2026-09-07, Fase 1 Alur D). Endpoint asli
// (repo internal KontenPilot) balikin total biaya AI GLOBAL (semua brand digabung,
// dalam USD) ke siapa pun yang login - benar utk single-admin (Agus SATU-SATUNYA yang
// bisa login, wajar dia lihat biaya asli), tapi kontradiksi langsung dgn keputusan
// bisnis PRD "AI Konten by Agustap Studio" §09: pelanggan SaaS TIDAK PERNAH melihat
// biaya API asli (USD), cuma saldo KREDIT (abstraksi) - lihat plans/creditTransactions
// di schema.ts. Endpoint kredit pengganti (baca users.saldoKredit +
// creditTransactions per akun yang login) belum dibangun - JANGAN aktifkan endpoint
// ini lagi tanpa itu, walau cuma utk "sementara" - resiko bocor angka biaya asli ke
// pelanggan lebih besar drpd manfaat sementara.
export async function GET() {
  return NextResponse.json(
    { error: "Endpoint biaya global dinonaktifkan di instalasi multi-tenant - lihat saldo kredit akun Anda" },
    { status: 410 }
  );
}

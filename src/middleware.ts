import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Gerbang auth terpusat (2026-09-07, PRD "AI Konten by Agustap Studio" Fase 1, Alur D).
// Repo ASAL (KontenPilot internal) TIDAK PUNYA file ini sama sekali - API-nya bebas
// diakses tanpa cek sesi apa pun (aman di sana krn cuma 1 admin, tidak ada isolasi yang
// perlu dijaga). Fork INI beda: 65 route API yang ada SEMUA butuh tahu siapa yang login
// sebelum baca/tulis data brand siapa pun - drpd edit manual satu-satu (rawan kelewat 1
// route, jadi celah kebocoran data antar-pelanggan), gerbang ini jalan LEBIH DULU utk
// SETIAP request /api/* (kecuali yang di-exclude di bawah) & taruh userId yang sudah
// diverifikasi ke header `x-user-id` - route handler tinggal baca header itu, tidak
// perlu verifikasi JWT ulang sendiri-sendiri.
//
// Dikecualikan dari gerbang ini:
// - /api/auth/* - login/signup itu sendiri (belum ada sesi saat request ini terjadi,
//   ATAU OAuth callback pihak ketiga spt Buffer/Meta/YouTube connect).
// - /api/cron/* - dijaga verifyCronSecret sendiri (secret header, bukan sesi user).
// - /api/version - health check ops (commit SHA/waktu start doang, TANPA data bisnis/
//   PII) - repo asal sengaja diekspos publik lewat proxy.ts PUBLIC_PATHS, dipertahankan
//   sama di sini.
const EXCLUDED_PREFIXES = ["/api/auth/", "/api/cron/", "/api/version"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) return NextResponse.next();
  if (EXCLUDED_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const userId = token ? await verifySessionToken(token) : null;
  if (!userId) {
    return NextResponse.json({ error: "Belum login atau sesi kadaluarsa" }, { status: 401 });
  }

  const headers = new Headers(req.headers);
  headers.set("x-user-id", userId);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/api/:path*",
};

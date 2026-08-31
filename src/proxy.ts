import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }
  // Cron internal (2026-08-06, permintaan Agus - infra scheduler) - dipanggil systemd
  // timer via curl LOKAL (bukan browser Agus), TIDAK PERNAH punya cookie sesi login sama
  // sekali. Auth-nya SENDIRI (X-Cron-Key vs CRON_SECRET, lihat lib/cron/verify.ts) -
  // dilewatkan proxy ini SUPAYA request-nya benar2 sampai ke route handler & dicek di
  // sana, bukan ditolak duluan di sini krn tidak punya cookie.
  if (pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }
  // Agency Dashboard (2026-08-26, PRD §32, Task Plan 4) - HANYA brands-summary yg
  // dipanggil SERVER-KE-SERVER (aikonten.agustapstudio.com <-> aimarketing.pelangihomestay.com),
  // BUKAN browser Agus, jadi TIDAK PERNAH punya cookie sesi login - pola sama persis dgn
  // /api/cron/ di atas, auth-nya SENDIRI (X-Agency-Key vs AGENCY_API_SECRET, lihat
  // lib/agency/verify.ts). /api/agency/dashboard SENGAJA TIDAK dikecualikan di sini - itu
  // dipanggil browser Agus sendiri (/agency/page.tsx), TETAP wajib sesi login normal.
  if (pathname === "/api/agency/brands-summary") {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = token ? await verifySessionToken(token) : false;

  if (!valid) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

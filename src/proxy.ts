import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/signup", "/api/auth/login", "/api/version"];

// (2026-09-29) Gabungan proxy internal + gerbang multi-tenant Fase 1: konvensi Next 16
// memakai SATU file `proxy.ts` (bukan `middleware.ts` lagi). Selain gate sesi (redirect
// UI ke /login, 401 utk /api), gerbang ini menyuntik `x-user-id` yang sudah diverifikasi
// ke header setiap request /api/* - route handler Fase 1 membaca header itu utk isolasi
// tenant, tak perlu verifikasi JWT ulang sendiri-sendiri.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }
  // /api/auth/* (login/logout/signup + callback OAuth meta/youtube/buffer) - publik atau
  // punya verifikasi sesi sendiri, dilewati gerbang ini (pola dari middleware Fase 1).
  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }
  // Cron internal dipanggil systemd timer via curl LOKAL - tak pernah punya cookie sesi,
  // auth-nya sendiri (X-Cron-Key vs CRON_SECRET) dicek di route handler.
  if (pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }
  // Agency brands-summary dipanggil server-ke-server - tak pernah punya cookie sesi,
  // auth-nya sendiri (X-Agency-Key vs AGENCY_API_SECRET).
  if (pathname === "/api/agency/brands-summary") {
    return NextResponse.next();
  }
  // Master admin API (2026-09-30) - SENGAJA dilewati injeksi x-user-id: route /api/master/*
  // memverifikasi sesi + status admin (allowlist ADMIN_EMAILS) sendiri via getAdminOrNull()
  // dan HARUS bisa lihat data LINTAS pelanggan (bukan isolasi 1 tenant), jadi tidak boleh
  // dibatasi header x-user-id yang berbasis 1 akun. Auth admin dicek di dalam handler.
  if (pathname.startsWith("/api/master/")) {
    return NextResponse.next();
  }
  // Webhook payment gateway (Duitku, 2026-09-30 T3) - dipanggil server Duitku, tak punya
  // cookie sesi; auth-nya = verifikasi signature di handler. Dilewati gate + injeksi x-user-id.
  if (pathname.startsWith("/api/webhooks/")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const userId = token ? await verifySessionToken(token) : null;

  if (!userId) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Suntik x-user-id utk isolasi tenant (Fase 1) - hanya perlu di jalur API.
  if (pathname.startsWith("/api/")) {
    const headers = new Headers(req.headers);
    headers.set("x-user-id", userId as string);
    return NextResponse.next({ request: { headers } });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

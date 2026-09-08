import { NextRequest, NextResponse } from "next/server";
import { getSessionUserIdOrNull, getOwnedBrand } from "@/lib/session";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

// Mulai alur OAuth utk menyambungkan SATU channel YouTube ke SATU brand (lihat PRD
// diskusi - multi-brand, tiap brand kelola akunnya sendiri).
//
// Komentar lama ("dilindungi proxy.ts, cuma Agus yg login yg bisa memicu ini") SUDAH
// TIDAK BERLAKU di fork multi-tenant ini (2026-09-08) - middleware.ts SENGAJA
// mengecualikan seluruh /api/auth/* (perlu redirect ke Google tanpa gerbang JSON 401),
// jadi route ini verifikasi sesi + kepemilikan brand SENDIRI di sini, sama pola dgn
// auth/meta/connect.
export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId wajib diisi" }, { status: 400 });
  }

  const userId = await getSessionUserIdOrNull(req);
  if (!userId) {
    return NextResponse.json({ error: "Belum login atau sesi kadaluarsa" }, { status: 401 });
  }
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const appUrl = process.env.APP_URL;
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: "YOUTUBE_CLIENT_ID/APP_URL belum diisi di .env" }, { status: 500 });
  }

  const redirectUri = `${appUrl}/api/auth/youtube/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // WAJIB "consent" - tanpa ini Google cuma balikin refresh_token pada otorisasi
    // PERTAMA kali sepanjang masa akun itu, bukan tiap kali connect ulang.
    prompt: "consent",
    state: brandId,
  });

  return NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
}

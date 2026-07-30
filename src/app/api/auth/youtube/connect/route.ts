import { NextRequest, NextResponse } from "next/server";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

// Mulai alur OAuth utk menyambungkan SATU channel YouTube ke SATU brand (lihat PRD
// diskusi - multi-brand, tiap brand kelola akunnya sendiri). Route ini dilindungi
// proxy.ts (semua route ke-protect kecuali /login) jadi cuma Agus yg login yg bisa
// memicu ini - state cuma perlu bawa brandId, tidak perlu token CSRF terpisah.
export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId wajib diisi" }, { status: 400 });
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

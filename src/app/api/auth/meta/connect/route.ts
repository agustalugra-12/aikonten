import { NextRequest, NextResponse } from "next/server";

const AUTH_URL = "https://www.facebook.com/v21.0/dialog/oauth";

// Scope gabungan utk publish ke Facebook Page DAN Instagram Business account yg
// terhubung ke Page itu (lihat instagram.ts/facebook.ts - keduanya lewat Graph API yg
// sama). Mode developer/tester akun sendiri (lihat PRD diskusi) - cukup ditambahkan
// sbg tester di App, tidak perlu App Review resmi.
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId wajib diisi" }, { status: 400 });
  }

  const appId = process.env.META_APP_ID;
  const appUrl = process.env.APP_URL;
  if (!appId || !appUrl) {
    return NextResponse.json({ error: "META_APP_ID/APP_URL belum diisi di .env" }, { status: 500 });
  }

  const redirectUri = `${appUrl}/api/auth/meta/callback`;
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_type: "code",
    state: brandId,
  });

  return NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
}

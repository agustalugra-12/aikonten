import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  exchangeCodeForUserToken,
  exchangeForLongLivedUserToken,
  fetchManagedPages,
  storePendingSelection,
  saveMetaAccountsForBrand,
} from "@/lib/publish/metaAuth";
import { getSessionUserIdOrNull, getOwnedBrand } from "@/lib/session";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const brandId = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error_message") || req.nextUrl.searchParams.get("error");

  const appUrl = process.env.APP_URL || req.nextUrl.origin;

  if (oauthError) {
    return NextResponse.redirect(`${appUrl}/?meta_error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !brandId) {
    return NextResponse.redirect(`${appUrl}/?meta_error=missing_code_or_state`);
  }

  // Isolasi antar-pelanggan (2026-09-08, Fase 1 Alur D) - verifikasi ULANG di sini juga
  // (bukan cuma di connect/route.ts): `state` cuma dijaga Facebook apa adanya, siapa pun
  // bisa memicu callback ini langsung dgn `state` (brandId) bebas tanpa pernah lewat
  // connect/route.ts sama sekali - cek ownership WAJIB di titik yang benar2 menulis token
  // ke DB, bukan cuma di titik masuk. Cookie sesi tetap terkirim di redirect Facebook->
  // sini krn SameSite=Lax (top-level GET navigation).
  const userId = await getSessionUserIdOrNull(req);
  if (!userId || !(await getOwnedBrand(userId, brandId))) {
    return NextResponse.redirect(`${appUrl}/?meta_error=${encodeURIComponent("Brand tidak ditemukan atau sesi kadaluarsa")}`);
  }

  try {
    const redirectUri = `${appUrl}/api/auth/meta/callback`;
    const shortLivedToken = await exchangeCodeForUserToken(code, redirectUri);
    const longLivedToken = await exchangeForLongLivedUserToken(shortLivedToken);
    const pages = await fetchManagedPages(longLivedToken);

    if (pages.length === 0) {
      return NextResponse.redirect(
        `${appUrl}/?meta_error=${encodeURIComponent(
          "Tidak ada Facebook Page ditemukan - pastikan akun ini admin di minimal 1 Page"
        )}`
      );
    }

    if (pages.length === 1) {
      const saved = await saveMetaAccountsForBrand(brandId, pages[0]);
      return NextResponse.redirect(`${appUrl}/?meta_connected=${encodeURIComponent(saved.join(", "))}`);
    }

    // Lebih dari 1 Page (satu akun FB Agus bisa jadi admin di Page brand lain juga) -
    // Agus harus pilih dulu yg mana utk brand ini (lihat select/route.ts).
    const selectionToken = nanoid(16);
    storePendingSelection(selectionToken, brandId, pages);
    return NextResponse.redirect(`${appUrl}/api/auth/meta/select?token=${selectionToken}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${appUrl}/?meta_error=${encodeURIComponent(message)}`);
  }
}

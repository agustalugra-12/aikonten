import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const brandId = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  const appUrl = process.env.APP_URL || req.nextUrl.origin;

  if (oauthError) {
    return NextResponse.redirect(`${appUrl}/?youtube_error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !brandId) {
    return NextResponse.redirect(`${appUrl}/?youtube_error=missing_code_or_state`);
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/?youtube_error=server_not_configured`);
  }

  const redirectUri = `${appUrl}/api/auth/youtube/callback`;

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(JSON.stringify(tokenData));

    const accessToken = tokenData.access_token as string;
    const refreshToken = (tokenData.refresh_token as string) || null;
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    // Ambil identitas channel-nya sendiri (bukan asumsi/manual input) - dipakai sbg
    // platformAccountId (channel id) + username (channel title) di social_accounts.
    const channelRes = await fetch(CHANNELS_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const channelData = await channelRes.json();
    if (!channelRes.ok) throw new Error(JSON.stringify(channelData));
    const channel = channelData.items?.[0];
    if (!channel) throw new Error("Tidak ada channel YouTube utk akun Google ini");

    const channelId = channel.id as string;
    const channelTitle = channel.snippet?.title as string;

    const [existing] = await db
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.brandId, brandId),
          eq(socialAccounts.platform, "youtube"),
          eq(socialAccounts.platformAccountId, channelId)
        )
      );

    if (existing) {
      await db
        .update(socialAccounts)
        .set({
          username: channelTitle,
          accessToken,
          // Google cuma kasih refresh_token baru kadang2 (lihat catatan prompt=consent
          // di connect/route.ts) - kalau tidak ada yg baru, PERTAHANKAN yg lama, jangan
          // ditimpa null.
          refreshToken: refreshToken || existing.refreshToken,
          tokenExpiresAt: expiresAt,
        })
        .where(eq(socialAccounts.id, existing.id));
    } else {
      await db.insert(socialAccounts).values({
        id: newId("social"),
        brandId,
        platform: "youtube",
        publishVia: "native",
        username: channelTitle,
        platformAccountId: channelId,
        accessToken,
        refreshToken,
        tokenExpiresAt: expiresAt,
        createdAt: new Date(),
      });
    }

    return NextResponse.redirect(`${appUrl}/?youtube_connected=${encodeURIComponent(channelTitle)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${appUrl}/?youtube_error=${encodeURIComponent(message)}`);
  }
}

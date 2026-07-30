import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Beri jeda 2 menit sblm expiry asli - hindari race condition dimana token
// "masih valid" pas dicek tapi kadaluarsa persis di tengah request upload video
// (yg bisa makan waktu, video besar).
const EXPIRY_SAFETY_MARGIN_MS = 2 * 60 * 1000;

function getOAuthConfig() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET belum diisi di .env");
  }
  return { clientId, clientSecret };
}

// Access token YouTube cuma berlaku ~1 jam - krn publish di app ini FULL OTOMATIS
// (lihat PRD diskusi, tidak ada langkah manual), token HARUS di-refresh sendiri pakai
// refresh_token sblm tiap publish, bukan asumsi token yg tersimpan masih hidup.
export async function ensureFreshYoutubeAccessToken(account: {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}): Promise<string> {
  const stillValid =
    account.accessToken &&
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() - EXPIRY_SAFETY_MARGIN_MS > Date.now();

  if (stillValid) return account.accessToken!;

  if (!account.refreshToken) {
    throw new Error(
      "Akun YouTube ini belum pernah di-connect lewat OAuth (tidak ada refresh_token) - sambungkan dulu via /api/auth/youtube/connect"
    );
  }

  const { clientId, clientSecret } = getOAuthConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gagal refresh token YouTube: ${JSON.stringify(data)}`);
  }

  const newAccessToken = data.access_token as string;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  await db
    .update(socialAccounts)
    .set({ accessToken: newAccessToken, tokenExpiresAt: expiresAt })
    .where(eq(socialAccounts.id, account.id));

  return newAccessToken;
}

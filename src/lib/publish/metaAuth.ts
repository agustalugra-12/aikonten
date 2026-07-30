import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export function getMetaAppConfig() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("META_APP_ID/META_APP_SECRET belum diisi di .env");
  }
  return { appId, appSecret };
}

export async function exchangeCodeForUserToken(code: string, redirectUri: string): Promise<string> {
  const { appId, appSecret } = getMetaAppConfig();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.access_token;
}

// Token dari code exchange umurnya pendek (~jam) - ditukar ke long-lived (~60 hari).
// Page access token yg diturunkan dari long-lived user token ini PRAKTIS TIDAK
// kadaluarsa (beda dari YouTube - lihat youtubeAuth.ts), jadi tidak perlu mekanisme
// refresh berkala terpisah utk Meta.
export async function exchangeForLongLivedUserToken(shortLivedToken: string): Promise<string> {
  const { appId, appSecret } = getMetaAppConfig();
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.access_token;
}

export type ManagedPage = {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  igUserId: string | null;
  igUsername: string | null;
};

// Satu akun Facebook pribadi Agus bisa jadi admin di BEBERAPA Page (satu per brand,
// mis. Pelangi + Harmoni) - fetch semua, biar Agus pilih yg mana pas connect utk brand
// tertentu (lihat route select/route.ts).
export async function fetchManagedPages(longLivedUserToken: string): Promise<ManagedPage[]> {
  const res = await fetch(`${GRAPH_BASE}/me/accounts?access_token=${longLivedUserToken}`);
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));

  const pages: ManagedPage[] = [];
  for (const page of data.data || []) {
    let igUserId: string | null = null;
    let igUsername: string | null = null;
    const igRes = await fetch(
      `${GRAPH_BASE}/${page.id}?fields=instagram_business_account{id,username}&access_token=${page.access_token}`
    );
    const igData = await igRes.json();
    if (igRes.ok && igData.instagram_business_account) {
      igUserId = igData.instagram_business_account.id;
      igUsername = igData.instagram_business_account.username;
    }

    pages.push({
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
      igUserId,
      igUsername,
    });
  }
  return pages;
}

// Penyimpanan sementara in-memory (bukan DB) utk hasil OAuth pas Agus punya LEBIH DARI
// SATU Page & harus milih yg mana dulu utk brand ini (lihat select/route.ts) - proses
// singkat 1 admin, jadi cukup sederhana begini, TIDAK perlu tabel DB terpisah. TTL 10
// menit supaya tidak numpuk kalau Agus tidak pernah selesai milih.
type PendingSelection = { brandId: string; pages: ManagedPage[]; expiresAt: number };
const pendingSelections = new Map<string, PendingSelection>();
const SELECTION_TTL_MS = 10 * 60 * 1000;

export function storePendingSelection(token: string, brandId: string, pages: ManagedPage[]) {
  pendingSelections.set(token, { brandId, pages, expiresAt: Date.now() + SELECTION_TTL_MS });
}

export function takePendingSelection(token: string): PendingSelection | null {
  const entry = pendingSelections.get(token);
  pendingSelections.delete(token);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry;
}

async function upsertSocialAccount(opts: {
  brandId: string;
  platform: "facebook" | "instagram";
  platformAccountId: string;
  username: string;
  accessToken: string;
}) {
  const [existing] = await db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.brandId, opts.brandId),
        eq(socialAccounts.platform, opts.platform),
        eq(socialAccounts.platformAccountId, opts.platformAccountId)
      )
    );

  if (existing) {
    await db
      .update(socialAccounts)
      .set({ username: opts.username, accessToken: opts.accessToken })
      .where(eq(socialAccounts.id, existing.id));
  } else {
    await db.insert(socialAccounts).values({
      id: newId("social"),
      brandId: opts.brandId,
      platform: opts.platform,
      publishVia: "native",
      platformAccountId: opts.platformAccountId,
      username: opts.username,
      accessToken: opts.accessToken,
      // Page access token turunan long-lived user token praktis tidak kadaluarsa
      // (lihat catatan di atas) - tidak ada tokenExpiresAt/refreshToken utk Meta.
      createdAt: new Date(),
    });
  }
}

// Simpan Page (Facebook) + Instagram Business account yg terhubung (kalau ada) sbg
// social_accounts utk SATU brand - dipanggil baik dari callback (kalau cuma 1 Page)
// maupun select (kalau Agus pilih salah satu dari beberapa Page).
export async function saveMetaAccountsForBrand(brandId: string, page: ManagedPage): Promise<string[]> {
  const saved: string[] = [];

  await upsertSocialAccount({
    brandId,
    platform: "facebook",
    platformAccountId: page.pageId,
    username: page.pageName,
    accessToken: page.pageAccessToken,
  });
  saved.push(`Facebook: ${page.pageName}`);

  if (page.igUserId && page.igUsername) {
    await upsertSocialAccount({
      brandId,
      platform: "instagram",
      platformAccountId: page.igUserId,
      username: page.igUsername,
      accessToken: page.pageAccessToken,
    });
    saved.push(`Instagram: @${page.igUsername}`);
  }

  return saved;
}

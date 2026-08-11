import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { socialAccounts, brands } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { ensureFreshYoutubeAccessToken } from "@/lib/publish/youtubeAuth";
import { sendTelegramNotification } from "@/lib/publish/telegram";

// Cron health-check harian utk token OAuth YouTube native (2026-08-12, Fase 0 PRD
// Animal Story & Co "100 video/30 hari") - refresh_token GOOGLE OAuth APP YANG MASIH
// STATUS "TESTING" (bukan "Production") di Google Cloud Console kadaluarsa KERAS
// setelah 7 hari terlepas dari aktivitas - risiko nyata utk eksperimen 30 hari tanpa
// pengawasan: kalau ini terjadi diam-diam, publish native YouTube brand ini akan gagal
// total mulai suatu hari tanpa Agus tahu sampai ngecek manual. Endpoint ini SENGAJA
// proaktif me-refresh (bukan cuma cek expiresAt) tiap akun YouTube native yang connected
// - kalau refresh gagal (token benar2 mati), Agus dapat alert Telegram SEKARANG, bukan
// ketahuan di tengah batch generate video ke-47 dari 100.
export async function POST(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  const accounts = await db
    .select({ account: socialAccounts, brandName: brands.name })
    .from(socialAccounts)
    .innerJoin(brands, eq(socialAccounts.brandId, brands.id))
    .where(
      and(
        eq(socialAccounts.platform, "youtube"),
        eq(socialAccounts.publishVia, "native"),
        eq(socialAccounts.connected, true)
      )
    );

  const results: Array<{ brandName: string; username: string; ok: boolean; error?: string }> = [];

  for (const { account, brandName } of accounts) {
    try {
      await ensureFreshYoutubeAccessToken(account);
      results.push({ brandName, username: account.username, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron/youtube-token-health] refresh gagal utk ${brandName} (${account.username}):`, err);
      results.push({ brandName, username: account.username, ok: false, error: message });
      await sendTelegramNotification(
        `🚨 <b>${brandName}</b> - token OAuth YouTube native GAGAL di-refresh\n` +
          `Akun: ${account.username}\n` +
          `Error: ${message}\n\n` +
          `Publish otomatis native YouTube kemungkinan akan berhenti. Sambungkan ulang lewat halaman Integrasi Sosmed.`
      );
    }
  }

  return NextResponse.json({ ok: true, results });
}

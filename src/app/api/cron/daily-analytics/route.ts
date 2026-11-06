import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify";
import { db } from "@/db";
import { socialAccounts, analytics } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getAggregatedMetrics } from "@/lib/publish/bufferAuth";
import { syncBrandPerformance } from "@/lib/ai/performanceLearning";
import { newId } from "@/lib/ids";
import { ledgerReady, missingLedgerTables, getTokenCooldownUntil, countCalls30d } from "@/lib/publish/ledger";
import { budgetVerdict, defaultBudgetCfg } from "@/lib/publish/guard";

// Cron - isi snapshot harian tabel `analytics` (2026-08-19, PRD "AI Content Intelligence"
// §25-34 Analytics/Reporting, permintaan Agus). Tabel ini SUDAH ADA di schema sejak lama
// tapi TIDAK PERNAH DIISI kode mana pun - laporan tren dari waktu ke waktu (bulan lalu vs
// bulan ini) butuh histori ini, dan histori tidak bisa direkonstruksi mundur, jadi makin
// cepat mulai terkumpul makin baik.
//
// Sumber data: SAMA PERSIS dgn yg sudah dipakai & terverifikasi ke API Buffer asli di
// endpoint dashboard (/api/brands/[id]/analytics, lihat AnalyticsSummary.tsx) -
// getAggregatedMetrics per channel, tipe metrik nyata (introspeksi API, BUKAN dugaan):
// views/reach/reactions/shares/engagementRate. Kolom `analytics.likes` diisi dari metrik
// `reactions` (istilah Buffer utk "suka" lintas-platform, bukan field literal "likes" -
// field itu TIDAK ADA di response API asli). Kolom `analytics.followers` DIBIARKAN NULL -
// belum ada query Buffer GraphQL yg terverifikasi expose follower count per channel,
// jangan tebak/fabrikasi field yg belum dicek ke API asli (pola sama spt komentar
// getPostMetrics di bufferAuth.ts).
//
// Jendela metrik: 1 hari (kemarin 00:00 - hari ini 00:00 waktu server) - merepresentasikan
// aktivitas HARI ITU, konsisten dgn nama kolom `dateRecorded`. Idempotent: cek row
// existing utk (socialAccountId, dateRecorded) dulu, UPDATE kalau ada (misfire/retry timer
// tidak bikin baris dobel) bukan INSERT buta.
export async function POST(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  // Analytics = call NON-esensial: pakai budget terpisah (berhenti di reserve) agar publish tetap prioritas.
  // Ledger belum dimigrasi -> berhenti jelas (konsisten dgn publish), bukan jalan tanpa tercatat.
  if (!ledgerReady()) {
    return NextResponse.json({ ok: false, error: `LEDGER_NOT_MIGRATED: ${missingLedgerTables().join(", ")}` }, { status: 503 });
  }
  const budgetCfg = defaultBudgetCfg();
  const nowMs = Date.now();
  const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.connected, true));
  const today = new Date();
  const dateRecorded = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const windowStart = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const results: Array<{ accountId: string; username: string; ok: boolean; error?: string }> = [];
  const brandTokens = new Map<string, string | null>(); // brand sehat (lolos cooldown+budget) utk snapshot per-posting di bawah

  for (const acc of accounts) {
    if (acc.publishVia !== "buffer" || !acc.bufferChannelId) {
      continue; // akun native (mis. YouTube langsung) belum ada sumber metrik harian
    }
    if (await getTokenCooldownUntil(acc.accessToken, nowMs)) {
      results.push({ accountId: acc.id, username: acc.username, ok: false, error: "dilewati: token Buffer cooldown" });
      continue;
    }
    if (!budgetVerdict(await countCalls30d(acc.accessToken, nowMs), budgetCfg).allowNonEssential) {
      results.push({ accountId: acc.id, username: acc.username, ok: false, error: "dilewati: budget Buffer di reserve (publish diprioritaskan)" });
      continue;
    }
    if (!brandTokens.has(acc.brandId)) brandTokens.set(acc.brandId, acc.accessToken);
    try {
      const metrics = await getAggregatedMetrics(
        acc.bufferChannelId,
        windowStart.toISOString(),
        today.toISOString(),
        acc.accessToken,
        { brandId: acc.brandId }
      );
      const views = metrics.find((m) => m.type === "views")?.value ?? null;
      const reactions = metrics.find((m) => m.type === "reactions")?.value ?? null;
      // Analytics v2 (2026-11-01) - simpan juga reach/shares/engagementRate harian (sebelumnya
      // hanya live dari Buffer, tak ada tren). followers belum (tak ada query Buffer terverifikasi).
      const reach = metrics.find((m) => m.type === "reach")?.value ?? null;
      const shares = metrics.find((m) => m.type === "shares")?.value ?? null;
      const engagementRate = metrics.find((m) => m.type === "engagementRate")?.value ?? null;

      const existing = await db
        .select({ id: analytics.id })
        .from(analytics)
        .where(and(eq(analytics.socialAccountId, acc.id), eq(analytics.dateRecorded, dateRecorded)))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(analytics)
          .set({ views: views !== null ? Math.round(views) : null, likes: reactions !== null ? Math.round(reactions) : null, reach: reach !== null ? Math.round(reach) : null, shares: shares !== null ? Math.round(shares) : null, engagementRate })
          .where(eq(analytics.id, existing[0].id));
      } else {
        await db.insert(analytics).values({
          id: newId("an"),
          socialAccountId: acc.id,
          followers: null,
          views: views !== null ? Math.round(views) : null,
          likes: reactions !== null ? Math.round(reactions) : null,
          reach: reach !== null ? Math.round(reach) : null,
          shares: shares !== null ? Math.round(shares) : null,
          engagementRate,
          dateRecorded,
          createdAt: new Date(),
        });
      }
      results.push({ accountId: acc.id, username: acc.username, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron/daily-analytics] gagal utk akun ${acc.username} (${acc.id}):`, err);
      results.push({ accountId: acc.id, username: acc.username, ok: false, error: message });
    }
  }

  // feat/buffer-quota-saver (2026-11-06): snapshot metrik PER-POSTING sekali/hari DI SINI
  // (dipindah dari jalur generate - dulu syncBrandPerformance dipanggil live tiap generate).
  // Learning loop kini BACA dari DB (projects.performanceViews); generate tak call Buffer lagi.
  // Budget-gated (non-esensial, berhenti di reserve) -> tak pernah makan jatah publish.
  const perPostSync: Array<{ brandId: string; ok: boolean; error?: string }> = [];
  for (const [brandId, token] of brandTokens) {
    if (await getTokenCooldownUntil(token, nowMs)) { perPostSync.push({ brandId, ok: false, error: "cooldown" }); continue; }
    if (!budgetVerdict(await countCalls30d(token, nowMs), budgetCfg).allowNonEssential) { perPostSync.push({ brandId, ok: false, error: "budget reserve" }); continue; }
    try { await syncBrandPerformance(brandId); perPostSync.push({ brandId, ok: true }); }
    catch (err) { perPostSync.push({ brandId, ok: false, error: err instanceof Error ? err.message : String(err) }); }
  }

  return NextResponse.json({ dateRecorded, results, perPostSync });
}

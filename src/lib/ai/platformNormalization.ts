import { db } from "@/db";
import { publishLogs, socialAccounts } from "@/db/schema";
import { and, eq, gte, isNotNull } from "drizzle-orm";

// Platform Normalization (PRD §18, Task Plan 3, 2026-08-26) - raw views TIDAK bisa
// dibandingkan apple-to-apple antar platform (TikTok/IG/FB/YouTube py skala jauh beda).
// Modul ini murni soal ANALYTICS (baseline+relative performance+winner/underperformer),
// BEDA dari platformAdaptation.ts (§43, adaptasi gaya caption per platform saat publish -
// itu TETAP dipakai apa adanya, tidak disentuh di sini). Baseline dihitung per-platform
// dari publishLogs.views (persisted mulai 2026-08-26 di performanceLearning.ts - lihat
// catatan lengkap di schema.ts's publishLogs.views kenapa data lama [sebelum tanggal itu]
// akan NULL, bukan bug).

export type PlatformBaseline = { avgViews: number; count: number };

// MINIMUM_HISTORY (bukan 1) - platform dgn <3 post yg py data blm cukup utk jadi baseline
// yg bisa diandalkan (1-2 post bisa fluke), classifyPlatformPerformance kembalikan tier
// "baseline_building" utk kasus ini - JANGAN pernah label winner/underperformer dari
// sample sekecil itu.
const MINIMUM_HISTORY = 3;
const WINNER_MULTIPLIER = 1.5;
const UNDERPERFORMER_MULTIPLIER = 0.5;

// Fungsi MURNI (dipisah dari query DB, pola sama dgn contentVariety.ts's
// tallyMediumPerformance) - avgViews+count per platform dari rows views.
export function tallyPlatformPerformance(
  rows: { platform: string; views: number | null }[]
): Map<string, PlatformBaseline> {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    if (r.views == null) continue;
    (groups.get(r.platform) || groups.set(r.platform, []).get(r.platform)!).push(r.views);
  }
  const result = new Map<string, PlatformBaseline>();
  for (const [platform, views] of groups) {
    result.set(platform, { avgViews: Math.round(views.reduce((a, b) => a + b, 0) / views.length), count: views.length });
  }
  return result;
}

export type PlatformPerformanceTier = "winner" | "average" | "underperformer" | "baseline_building";

export function classifyPlatformPerformance(
  views: number,
  baseline: PlatformBaseline | undefined
): { multiplier: number | null; tier: PlatformPerformanceTier } {
  if (!baseline || baseline.count < MINIMUM_HISTORY || baseline.avgViews === 0) {
    return { multiplier: null, tier: "baseline_building" };
  }
  const multiplier = Math.round((views / baseline.avgViews) * 100) / 100;
  if (multiplier >= WINNER_MULTIPLIER) return { multiplier, tier: "winner" };
  if (multiplier <= UNDERPERFORMER_MULTIPLIER) return { multiplier, tier: "underperformer" };
  return { multiplier, tier: "average" };
}

export async function getPlatformBaseline(brandId: string, windowDays: number): Promise<Map<string, PlatformBaseline>> {
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ platform: socialAccounts.platform, views: publishLogs.views })
    .from(publishLogs)
    .innerJoin(socialAccounts, eq(publishLogs.socialAccountId, socialAccounts.id))
    .where(
      and(
        eq(socialAccounts.brandId, brandId),
        eq(publishLogs.status, "success"),
        isNotNull(publishLogs.views),
        gte(publishLogs.createdAt, windowStart)
      )
    );
  return tallyPlatformPerformance(rows);
}

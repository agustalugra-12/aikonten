import { db } from "@/db";
import { projects, publishLogs, socialAccounts } from "@/db/schema";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { tallyPlatformPerformance, classifyPlatformPerformance, type PlatformBaseline } from "@/lib/ai/platformNormalization";

// Data mentah laporan mingguan (2026-08-19) - DIEKSTRAK dari route.ts (2026-08-19, awal
// pembuatan fitur ini) supaya endpoint JSON (dashboard in-app) & endpoint PDF (menyusul)
// pakai SATU sumber logic yang sama, bukan hitung ulang berbeda-beda tempat.
//
// "Kapan sebuah project dianggap 'published minggu ini'" - pakai MIN(publishLogs.publishedAt)
// per project (publish sukses PERTAMA ke akun mana pun), BUKAN projects.createdAt (itu
// waktu upload/generate, bisa jauh sebelum benar2 tayang kalau lewat draft review) &
// BUKAN projects.status (status "published" tetap sama walau publishnya sudah lama,
// tidak ada info KAPAN). Project dgn status "partial" (sebagian akun sukses) tetap
// dihitung asal ADA minimal 1 publishLogs sukses di jendela waktu ini.
export type WeeklyReportTopContent = {
  id: string;
  pillar: string | null;
  angle: string | null;
  captionSnippet: string;
  views: number | null;
  engagementRate: number | null;
  publishedAt: string | null;
  // Platform Normalization (2026-08-26, PRD §18, Task Plan 3) - topContent sekarang
  // per PLATFORM-POST (1 baris per publishLogs sukses), BUKAN per project - 1 project yg
  // tayang ke 2+ platform sekaligus jadi 2+ baris, krn baseline/multiplier cuma bermakna
  // dibandingkan ke platform yg SAMA (lihat catatan lengkap di platformNormalization.ts).
  // Diranking by multiplier (relative ke baseline platform-nya sendiri), BUKAN raw views
  // lagi - itu yg bikin perbandingan lintas platform jadi adil.
  platform: string;
  multiplier: number | null;
  tier: "winner" | "average" | "underperformer" | "baseline_building";
};

export type WeeklyReportData = {
  windowDays: number;
  windowStart: string;
  totalPublished: number;
  byPillar: { pillar: string; count: number }[];
  // Baseline per platform (PRD §18) - avgViews+count dari SEMUA publishLogs sukses brand
  // ini dlm window yg sama (bukan cuma yg py topContent), jadi baseline representatif.
  byPlatform: { platform: string; avgViews: number; count: number }[];
  topContent: WeeklyReportTopContent[];
  // Agency Dashboard (2026-08-26, PRD §32, Task Plan 4) - topContent HANYA top 5 by
  // multiplier DESC, tier "underperformer" (multiplier rendah) nyaris tidak pernah masuk
  // slice itu - dipisah di sini biar Agency Dashboard bisa tampilkan "underperforming
  // content lintas brand" tanpa query baru (reuse classifiedRows yg sudah dihitung).
  underperformingContent: WeeklyReportTopContent[];
  topContentDataAvailable: boolean;
};

export async function getWeeklyReportData(brandId: string, days: number): Promise<WeeklyReportData> {
  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // MIN(publishedAt) per project - agregasi SQL langsung (bukan fetch-semua-lalu-JS-reduce
  // spt performanceLearning.ts) krn publishLogs bisa berbaris banyak per project [1 per
  // akun] & kita cuma butuh 1 angka per project, lebih murah didorong ke DB.
  const firstPublish = db
    .select({
      projectId: publishLogs.projectId,
      firstPublishedAt: sql<number>`min(${publishLogs.publishedAt})`.as("first_published_at"),
    })
    .from(publishLogs)
    .where(and(eq(publishLogs.status, "success"), isNotNull(publishLogs.publishedAt)))
    .groupBy(publishLogs.projectId)
    .as("first_publish");

  const rows = await db
    .select({
      id: projects.id,
      pillar: projects.pillar,
      angle: projects.angle,
      generatedCaption: projects.generatedCaption,
      performanceViews: projects.performanceViews,
      performanceEngagementRate: projects.performanceEngagementRate,
      publishedAt: firstPublish.firstPublishedAt,
    })
    .from(projects)
    .innerJoin(firstPublish, eq(firstPublish.projectId, projects.id))
    .where(and(eq(projects.brandId, brandId), gte(firstPublish.firstPublishedAt, windowStart.getTime() / 1000)));

  // SQLite `integer timestamp` mode drizzle simpan sbg epoch DETIK utk kolom ini
  // (diverifikasi langsung ke source drizzle-orm - mapFromDriverValue kali 1000 -
  // 2026-08-19), dibandingkan konsisten di atas, dikonversi balik ke ms cuma utk
  // ditampilkan.
  const totalPublished = rows.length;

  const pillarCounts = new Map<string, number>();
  for (const r of rows) {
    const key = r.pillar || "(tanpa pilar)";
    pillarCounts.set(key, (pillarCounts.get(key) || 0) + 1);
  }
  const byPillar = Array.from(pillarCounts.entries())
    .map(([pillar, count]) => ({ pillar, count }))
    .sort((a, b) => b.count - a.count);

  // Platform Normalization (PRD §18) - per platform-post, join publishLogs (metrik ASLI
  // per platform, lihat performanceLearning.ts) ke projects (pillar/angle/caption) & ke
  // socialAccounts (platform). Baseline dihitung dari SEMUA baris di window ini (bukan
  // cuma yg akhirnya masuk top 5) - tallyPlatformPerformance sama persis dgn yg dipakai
  // getPlatformBaseline, lihat platformNormalization.ts.
  const platformPostRows = await db
    .select({
      id: projects.id,
      pillar: projects.pillar,
      angle: projects.angle,
      generatedCaption: projects.generatedCaption,
      views: publishLogs.views,
      engagementRate: publishLogs.engagementRate,
      publishedAt: publishLogs.publishedAt,
      platform: socialAccounts.platform,
    })
    .from(publishLogs)
    .innerJoin(projects, eq(publishLogs.projectId, projects.id))
    .innerJoin(socialAccounts, eq(publishLogs.socialAccountId, socialAccounts.id))
    .where(
      and(
        eq(projects.brandId, brandId),
        eq(publishLogs.status, "success"),
        isNotNull(publishLogs.publishedAt),
        gte(publishLogs.publishedAt, windowStart)
      )
    );

  const platformBaseline = tallyPlatformPerformance(
    platformPostRows.map((r) => ({ platform: r.platform, views: r.views }))
  );
  const byPlatform = Array.from(platformBaseline.entries())
    .map(([platform, b]: [string, PlatformBaseline]) => ({ platform, avgViews: b.avgViews, count: b.count }))
    .sort((a, b) => b.avgViews - a.avgViews);

  const classifiedRows = platformPostRows
    .filter((r) => r.views !== null)
    .map((r) => {
      const { multiplier, tier } = classifyPlatformPerformance(r.views!, platformBaseline.get(r.platform));
      return {
        id: r.id,
        pillar: r.pillar,
        angle: r.angle,
        captionSnippet: (r.generatedCaption || "").slice(0, 120),
        views: r.views,
        engagementRate: r.engagementRate !== null ? r.engagementRate / 100 : null,
        publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
        platform: r.platform,
        multiplier,
        tier,
      };
    })
    .sort((a, b) => (b.multiplier ?? -Infinity) - (a.multiplier ?? -Infinity));

  const topContent = classifiedRows.slice(0, 5);
  const underperformingContent = classifiedRows
    .filter((r) => r.tier === "underperformer")
    .slice(-5)
    .reverse();

  return {
    windowDays: days,
    windowStart: windowStart.toISOString(),
    totalPublished,
    byPillar,
    byPlatform,
    topContent,
    underperformingContent,
    topContentDataAvailable: platformPostRows.some((r) => r.views !== null),
  };
}

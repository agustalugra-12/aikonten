import { db } from "@/db";
import { projects, publishLogs, contentTypes } from "@/db/schema";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";

// Data mentah Laporan Bulanan (2026-08-19, PRD §31-32) - SCOPE DIKURANGI dari PRD asli:
// §34 "Monthly SWOT Update" TIDAK dibangun (butuh Competitor Data, masih BLOCKED - lihat
// docs/HANDOFF_OPENCODE_2026-08-18.md). Breakdown performa (§32) juga dikurangi dari 9
// dimensi ke 4 (Content Type/Pillar/Hook/Structure) - CTA/Footage/Posting Time/Platform
// Performance TIDAK ADA sumber data yang terverifikasi di schema saat ini (bukan
// ditebak/dihitung dari proxy yang tidak akurat, lihat catatan sama di weeklyReportData.ts
// soal jangan fabrikasi field yang belum terverifikasi ke sumber asli).
export type PerformanceBreakdown = { label: string; avgViews: number; count: number };

export type MonthlyReportData = {
  windowDays: number;
  totalContent: number;
  totalViews: number;
  avgEngagementRate: number | null;
  bestContent: { id: string; captionSnippet: string; views: number } | null;
  worstContent: { id: string; captionSnippet: string; views: number } | null;
  byContentType: PerformanceBreakdown[];
  byPillar: PerformanceBreakdown[];
  byHookType: PerformanceBreakdown[];
  byStructure: PerformanceBreakdown[];
};

function breakdown(rows: { key: string | null; views: number }[]): PerformanceBreakdown[] {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const key = r.key || "(tidak ada)";
    (groups.get(key) || groups.set(key, []).get(key)!).push(r.views);
  }
  return Array.from(groups.entries())
    .map(([label, views]) => ({
      label,
      avgViews: Math.round(views.reduce((a, b) => a + b, 0) / views.length),
      count: views.length,
    }))
    .sort((a, b) => b.avgViews - a.avgViews);
}

export async function getMonthlyReportData(brandId: string, days: number): Promise<MonthlyReportData> {
  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

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
      hookType: projects.hookType,
      structureTemplate: projects.structureTemplate,
      generatedCaption: projects.generatedCaption,
      performanceViews: projects.performanceViews,
      performanceEngagementRate: projects.performanceEngagementRate,
      contentTypeName: contentTypes.name,
    })
    .from(projects)
    .innerJoin(firstPublish, eq(firstPublish.projectId, projects.id))
    .leftJoin(contentTypes, eq(projects.contentTypeId, contentTypes.id))
    .where(and(eq(projects.brandId, brandId), gte(firstPublish.firstPublishedAt, windowStart.getTime() / 1000)));

  const totalContent = rows.length;
  const withViews = rows.filter((r) => r.performanceViews !== null) as (typeof rows[number] & { performanceViews: number })[];
  const totalViews = withViews.reduce((sum, r) => sum + r.performanceViews, 0);
  const withEngagement = rows.filter((r) => r.performanceEngagementRate !== null);
  const avgEngagementRate = withEngagement.length
    ? withEngagement.reduce((sum, r) => sum + (r.performanceEngagementRate ?? 0), 0) / withEngagement.length / 100
    : null;

  const sortedByViews = [...withViews].sort((a, b) => b.performanceViews - a.performanceViews);
  const best = sortedByViews[0];
  const worst = sortedByViews[sortedByViews.length - 1];

  return {
    windowDays: days,
    totalContent,
    totalViews,
    avgEngagementRate,
    bestContent: best
      ? { id: best.id, captionSnippet: (best.generatedCaption || "").slice(0, 120), views: best.performanceViews }
      : null,
    // worst cuma ditampilkan kalau ADA >=2 konten - kalau cuma 1, "terburuk" == "terbaik",
    // menampilkan keduanya jadi membingungkan (bukan insight, cuma duplikat).
    worstContent: worst && sortedByViews.length > 1
      ? { id: worst.id, captionSnippet: (worst.generatedCaption || "").slice(0, 120), views: worst.performanceViews }
      : null,
    byContentType: breakdown(withViews.map((r) => ({ key: r.contentTypeName, views: r.performanceViews }))),
    byPillar: breakdown(withViews.map((r) => ({ key: r.pillar, views: r.performanceViews }))),
    byHookType: breakdown(withViews.map((r) => ({ key: r.hookType, views: r.performanceViews }))),
    byStructure: breakdown(withViews.map((r) => ({ key: r.structureTemplate, views: r.performanceViews }))),
  };
}

export type PerformanceTrendSplit = {
  firstHalfAvgViews: number | null;
  secondHalfAvgViews: number | null;
  firstHalfCount: number;
  secondHalfCount: number;
};

// Perbandingan performa paruh-pertama vs paruh-kedua window (2026-08-20, bug nyata) -
// dipakai predictivePerformance.ts utk menentukan trendDirection. SEBELUM fix, kode itu
// menyamakan "first half" dgn N item pertama dari array byPillar+byContentType+byHookType+
// byStructure yang SUDAH diurutkan berdasar avgViews (bukan waktu) - jadi yang dibandingkan
// sebenarnya "kategori berperforma tertinggi" vs "sisanya", BUKAN performa awal window vs
// akhir window sama sekali. Fungsi ini query ulang pakai firstPublishedAt ASLI (kolom yang
// sudah ada di query getMonthlyReportData, cuma belum di-expose) supaya split-nya sungguhan
// berdasar waktu publish, konsisten dgn larangan proyek ini soal fabrikasi field yang tidak
// terverifikasi ke sumber asli (lihat catatan di atas soal §34/breakdown 9->4 dimensi).
export async function getPerformanceTrendSplit(brandId: string, windowDays: number): Promise<PerformanceTrendSplit> {
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const midpoint = new Date(Date.now() - (windowDays / 2) * 24 * 60 * 60 * 1000);

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
      firstPublishedAt: firstPublish.firstPublishedAt,
      performanceViews: projects.performanceViews,
    })
    .from(projects)
    .innerJoin(firstPublish, eq(firstPublish.projectId, projects.id))
    .where(and(
      eq(projects.brandId, brandId),
      gte(firstPublish.firstPublishedAt, windowStart.getTime() / 1000),
      isNotNull(projects.performanceViews),
    ));

  const midpointSec = midpoint.getTime() / 1000;
  const firstHalf = rows.filter((r) => r.firstPublishedAt < midpointSec).map((r) => r.performanceViews as number);
  const secondHalf = rows.filter((r) => r.firstPublishedAt >= midpointSec).map((r) => r.performanceViews as number);

  const avg = (vals: number[]) => (vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null);

  return {
    firstHalfAvgViews: avg(firstHalf),
    secondHalfAvgViews: avg(secondHalf),
    firstHalfCount: firstHalf.length,
    secondHalfCount: secondHalf.length,
  };
}

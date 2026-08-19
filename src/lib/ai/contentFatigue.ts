import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq, desc, gte } from "drizzle-orm";

// Content Fatigue Detection (PRD §39) - deteksi topik/pillar yang overused
// dengan performa menurun. Data sudah ada semua (performanceViews per topic
// dari waktu ke waktu), tidak butuh SWOT/Competitor, tidak butuh dependency baru.

const FATIGUE_WINDOW_DAYS = 30;
const FATIGUE_MIN_USAGE = 3; // minimal 3x pakai topik dalam window utk bisa dianggap fatigue

export type FatigueResult = {
  topic: string;
  usageCount: number;
  avgViews: number;
  avgEngagement: number;
  trend: "increasing" | "decreasing" | "stable";
  recommendation: "continue" | "reduce" | "rotate";
};

export async function detectContentFatigue(brandId: string): Promise<FatigueResult[]> {
  const cutoff = new Date(Date.now() - FATIGUE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Ambil project yang sudah publish dalam window + performance data
  const recentProjects = await db
    .select({
      id: projects.id,
      pillar: projects.pillar,
      hookType: projects.hookType,
      views: projects.performanceViews,
      engagement: projects.performanceEngagementRate,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(
      and(
        eq(projects.brandId, brandId),
        eq(projects.status, "published"),
        gte(projects.createdAt, cutoff),
      )
    )
    .orderBy(desc(projects.createdAt));

  // Group by pillar (content pillar = "topik" dalam konteks PRD)
  const pillarStats: Record<string, { count: number; views: number[]; engagement: number[] }> = {};
  for (const p of recentProjects) {
    const key = p.pillar || p.hookType || "Unknown";
    if (!pillarStats[key]) pillarStats[key] = { count: 0, views: [], engagement: [] };
    pillarStats[key].count++;
    if (p.views != null) pillarStats[key].views.push(p.views);
    if (p.engagement != null) pillarStats[key].engagement.push(p.engagement);
  }

  const results: FatigueResult[] = [];

  for (const [topic, stats] of Object.entries(pillarStats)) {
    if (stats.count < FATIGUE_MIN_USAGE) continue;

    const avgViews = stats.views.length > 0
      ? stats.views.reduce((a, b) => a + b, 0) / stats.views.length
      : 0;
    const avgEngagement = stats.engagement.length > 0
      ? stats.engagement.reduce((a, b) => a + b, 0) / stats.engagement.length
      : 0;

    // Simple trend: bandingkan paruh pertama vs paruh kedua
    const mid = Math.floor(stats.views.length / 2);
    const firstHalf = stats.views.slice(0, mid);
    const secondHalf = stats.views.slice(mid);
    const avgFirst = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : avgViews;
    const avgSecond = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : avgViews;

    let trend: FatigueResult["trend"] = "stable";
    if (avgSecond > avgFirst * 1.1) trend = "increasing";
    else if (avgSecond < avgFirst * 0.9) trend = "decreasing";

    // Recommendation berdasar usage + trend
    let recommendation: FatigueResult["recommendation"] = "continue";
    if (stats.count >= 8 && trend === "decreasing") {
      recommendation = "reduce";
    } else if (stats.count >= 12) {
      recommendation = "rotate";
    } else if (stats.count >= 6 && trend === "decreasing") {
      recommendation = "reduce";
    }

    results.push({
      topic,
      usageCount: stats.count,
      avgViews: Math.round(avgViews),
      avgEngagement: Math.round(avgEngagement * 100) / 100,
      trend,
      recommendation,
    });
  }

  // Sort by usage count descending
  return results.sort((a, b) => b.usageCount - a.usageCount);
}

export const FATIGUE_RECOMMENDATION_LABELS: Record<FatigueResult["recommendation"], string> = {
  continue: "Lanjutkan",
  reduce: "Kurangi Frekuensi",
  rotate: "Ganti Topik",
};

export const FATIGUE_RECOMMENDATION_COLORS: Record<FatigueResult["recommendation"], string> = {
  continue: "bg-green-100 text-green-800",
  reduce: "bg-yellow-100 text-yellow-800",
  rotate: "bg-red-100 text-red-800",
};

export const FATIGUE_TREND_LABELS: Record<FatigueResult["trend"], string> = {
  increasing: "↑ Meningkat",
  decreasing: "↓ Menurun",
  stable: "→ Stabil",
};

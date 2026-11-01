import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analytics, socialAccounts } from "@/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Time-series analitik HISTORIS (2026-11-01, Analytics v1 + reach/eng) - dari tabel `analytics`
// snapshot HARIAN milik KITA: tren Views/Likes/Reach per hari + Engagement rata-rata harian +
// breakdown per platform + total & delta. reach/engagementRate baru mulai terisi sejak cron v2
// (1-Nov) -> hasReach/hasEng menandai apakah sudah ada data (UI tampilkan "mulai terkumpul").
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  const dayMs = 24 * 60 * 60 * 1000;
  const windowStart = new Date(Date.now() - days * dayMs).toISOString().slice(0, 10);
  const prevStart = new Date(Date.now() - days * 2 * dayMs).toISOString().slice(0, 10);

  const rows = await db
    .select({ date: analytics.dateRecorded, views: analytics.views, likes: analytics.likes, reach: analytics.reach, eng: analytics.engagementRate, platform: socialAccounts.platform })
    .from(analytics)
    .innerJoin(socialAccounts, eq(analytics.socialAccountId, socialAccounts.id))
    .where(and(eq(socialAccounts.brandId, brandId), gte(analytics.dateRecorded, prevStart)));

  type Day = { views: number; likes: number; reach: number; engSum: number; engN: number };
  const dailyMap = new Map<string, Day>();
  const platMap = new Map<string, { views: number; likes: number }>();
  let curV = 0, curL = 0, curR = 0, curEngSum = 0, curEngN = 0, prevV = 0, prevL = 0;
  let hasReach = false, hasEng = false;
  for (const r of rows) {
    const v = r.views ?? 0, l = r.likes ?? 0, rc = r.reach ?? 0;
    if (r.reach != null) hasReach = true;
    if (r.eng != null) hasEng = true;
    if (r.date >= windowStart) {
      curV += v; curL += l; curR += rc;
      if (r.eng != null) { curEngSum += r.eng; curEngN++; }
      const d = dailyMap.get(r.date) ?? { views: 0, likes: 0, reach: 0, engSum: 0, engN: 0 };
      d.views += v; d.likes += l; d.reach += rc;
      if (r.eng != null) { d.engSum += r.eng; d.engN++; }
      dailyMap.set(r.date, d);
      const p = platMap.get(r.platform) ?? { views: 0, likes: 0 };
      p.views += v; p.likes += l; platMap.set(r.platform, p);
    } else {
      prevV += v; prevL += l;
    }
  }
  const daily = [...dailyMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, m]) => ({
    date, views: m.views, likes: m.likes, reach: m.reach, eng: m.engN ? Number((m.engSum / m.engN).toFixed(2)) : null,
  }));
  const byPlatform = [...platMap.entries()].map(([platform, m]) => ({ platform, views: m.views, likes: m.likes })).sort((a, b) => b.views - a.views);
  return NextResponse.json({
    days, daily, byPlatform, hasReach, hasEng,
    totals: { views: curV, likes: curL, reach: curR, eng: curEngN ? Number((curEngSum / curEngN).toFixed(2)) : null },
    prev: { views: prevV, likes: prevL },
  });
}

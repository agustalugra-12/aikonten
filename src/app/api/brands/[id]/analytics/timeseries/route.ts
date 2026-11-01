import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analytics, socialAccounts } from "@/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Time-series analitik HISTORIS (2026-11-01, Analytics v1) - dari tabel `analytics` snapshot
// HARIAN milik KITA (bukan live Buffer): tren Views & Likes per hari + breakdown per platform
// + total & delta vs periode sebelumnya. Data sudah terkumpul sejak Agu 2026. date_recorded =
// teks "YYYY-MM-DD" -> perbandingan string ISO urut benar secara leksikografis.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  const dayMs = 24 * 60 * 60 * 1000;
  const windowStart = new Date(Date.now() - days * dayMs).toISOString().slice(0, 10);
  const prevStart = new Date(Date.now() - days * 2 * dayMs).toISOString().slice(0, 10); // utk delta

  const rows = await db
    .select({ date: analytics.dateRecorded, views: analytics.views, likes: analytics.likes, platform: socialAccounts.platform })
    .from(analytics)
    .innerJoin(socialAccounts, eq(analytics.socialAccountId, socialAccounts.id))
    .where(and(eq(socialAccounts.brandId, brandId), gte(analytics.dateRecorded, prevStart)));

  const dailyMap = new Map<string, { views: number; likes: number }>();
  const platMap = new Map<string, { views: number; likes: number }>();
  let curV = 0, curL = 0, prevV = 0, prevL = 0;
  for (const r of rows) {
    const v = r.views ?? 0, l = r.likes ?? 0;
    if (r.date >= windowStart) {
      curV += v; curL += l;
      const d = dailyMap.get(r.date) ?? { views: 0, likes: 0 };
      d.views += v; d.likes += l; dailyMap.set(r.date, d);
      const p = platMap.get(r.platform) ?? { views: 0, likes: 0 };
      p.views += v; p.likes += l; platMap.set(r.platform, p);
    } else {
      prevV += v; prevL += l;
    }
  }
  const daily = [...dailyMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, m]) => ({ date, views: m.views, likes: m.likes }));
  const byPlatform = [...platMap.entries()].map(([platform, m]) => ({ platform, views: m.views, likes: m.likes })).sort((a, b) => b.views - a.views);
  return NextResponse.json({ days, daily, byPlatform, totals: { views: curV, likes: curL }, prev: { views: prevV, likes: prevL } });
}

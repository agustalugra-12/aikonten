import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Content Performance (2026-11-01, Analytics v3) - "konten mana yang perform": agregasi metrik
// per-proyek yang SUDAH disinkron performanceLearning.ts (projects.performanceViews /
// performanceEngagementRate[x100]) dikelompokkan per Tipe / Pilar / Hook + Top Content. Menutup
// loop konten AI -> hasil nyata. TANPA tabel/cron baru (pakai data existing). engagement x100.
type Row = { type: string; pillar: string | null; hook: string | null; views: number; eng: number | null; id: string; title: string };

function group(rows: Row[], keyFn: (r: Row) => string | null) {
  const m = new Map<string, { key: string; n: number; sumV: number; sumE: number; nE: number }>();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    const g = m.get(k) ?? { key: k, n: 0, sumV: 0, sumE: 0, nE: 0 };
    g.n++; g.sumV += r.views;
    if (r.eng != null) { g.sumE += r.eng; g.nE++; }
    m.set(k, g);
  }
  return [...m.values()]
    .map((g) => ({ key: g.key, n: g.n, avgViews: Math.round(g.sumV / g.n), avgEng: g.nE ? Number((g.sumE / g.nE / 100).toFixed(2)) : null }))
    .sort((a, b) => b.avgViews - a.avgViews);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const recs = await db
    .select({
      id: projects.id, type: projects.type, pillar: projects.pillar, hookType: projects.hookType,
      views: projects.performanceViews, eng: projects.performanceEngagementRate,
      script: projects.script, caption: projects.generatedCaption,
    })
    .from(projects)
    .where(and(eq(projects.brandId, brandId), isNotNull(projects.performanceViews), gt(projects.performanceViews, 0)));

  const rows: Row[] = recs.map((r) => ({
    type: r.type, pillar: r.pillar, hook: r.hookType, views: r.views ?? 0, eng: r.eng,
    id: r.id, title: ((r.caption || r.script || "").slice(0, 70)).trim() || "(tanpa judul)",
  }));

  const topContent = [...rows]
    .sort((a, b) => b.views - a.views)
    .slice(0, 8)
    .map((r) => ({ id: r.id, type: r.type, pillar: r.pillar, hook: r.hook, title: r.title, views: r.views, eng: r.eng != null ? Number((r.eng / 100).toFixed(2)) : null }));

  return NextResponse.json({
    totalScored: rows.length,
    byType: group(rows, (r) => r.type),
    byPillar: group(rows, (r) => r.pillar),
    byHook: group(rows, (r) => r.hook),
    topContent,
  });
}

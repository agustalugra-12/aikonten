import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, publishLogs } from "@/db/schema";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";

// Laporan mingguan in-app (2026-08-19, PRD "AI Content Intelligence" §25-34, permintaan
// Agus - "semua itu penting": ranking + ringkasan aktivitas dulu, tren & PDF menyusul -
// lihat docs/HANDOFF_OPENCODE_2026-08-18.md utk urutan lengkap). READ-ONLY, tidak
// panggil Buffer API sama sekali - `performanceViews`/`performanceEngagementRate` sudah
// disinkron lazy oleh performanceLearning.ts (dipicu tiap generate ide harian), jadi
// laporan ini cukup baca data yang sudah ada di DB, murah & cepat.
//
// "Kapan sebuah project dianggap 'published minggu ini'" - pakai MIN(publishLogs.publishedAt)
// per project (publish sukses PERTAMA ke akun mana pun), BUKAN projects.createdAt (itu
// waktu upload/generate, bisa jauh sebelum benar2 tayang kalau lewat draft review) &
// BUKAN projects.status (status "published" tetap sama walau publishnya sudah lama,
// tidak ada info KAPAN). Project dgn status "partial" (sebagian akun sukses) tetap
// dihitung asal ADA minimal 1 publishLogs sukses di jendela waktu ini.
const DEFAULT_WINDOW_DAYS = 7;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const days = Number(req.nextUrl.searchParams.get("days")) || DEFAULT_WINDOW_DAYS;
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

  // SQLite `integer timestamp` mode drizzle simpan sbg epoch DETIK utk kolom ini (lihat
  // definisi publishedAt di schema - mode "timestamp" generik, drizzle-orm utk
  // better-sqlite3 default epoch detik) - dibandingkan konsisten di atas, dikonversi balik
  // ke ms cuma utk ditampilkan.
  const totalPublished = rows.length;

  const pillarCounts = new Map<string, number>();
  for (const r of rows) {
    const key = r.pillar || "(tanpa pilar)";
    pillarCounts.set(key, (pillarCounts.get(key) || 0) + 1);
  }
  const byPillar = Array.from(pillarCounts.entries())
    .map(([pillar, count]) => ({ pillar, count }))
    .sort((a, b) => b.count - a.count);

  const topContent = rows
    .filter((r) => r.performanceViews !== null)
    .sort((a, b) => (b.performanceViews ?? 0) - (a.performanceViews ?? 0))
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      pillar: r.pillar,
      angle: r.angle,
      captionSnippet: (r.generatedCaption || "").slice(0, 120),
      views: r.performanceViews,
      engagementRate: r.performanceEngagementRate !== null ? r.performanceEngagementRate / 100 : null,
      publishedAt: r.publishedAt ? new Date(r.publishedAt * 1000).toISOString() : null,
    }));

  return NextResponse.json({
    windowDays: days,
    windowStart: windowStart.toISOString(),
    totalPublished,
    byPillar,
    topContent,
    topContentDataAvailable: rows.some((r) => r.performanceViews !== null),
  });
}

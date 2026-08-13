import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, publishLogs, socialAccounts, llmUsageLog } from "@/db/schema";
import { eq, and, gte, lt, inArray } from "drizzle-orm";

// Statistik dashboard (2026-08-13, permintaan Agus - konsep dashboard baru gaya app
// musik [kartu statistik+chart+greeting], TAPI semua angka di sini WAJIB data nyata,
// bukan tiruan pola "Songs Played"/"Hours Listened" dari referensinya. Dipetakan ke
// data yang benar2 ada di KontenPilot - lihat diskusi sesi ini utk mapping lengkapnya.
function startOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const now = new Date();
  const today = startOfDayLocal(now);

  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Publish minggu ini vs minggu lalu (delta, spt "+18% this week" di referensi) -
  // dihitung dari projects.updatedAt yg berstatus "published" (momen itu jadi published
  // TERAKHIR kali, cukup akurat utk konten yg tidak berubah status bolak-balik).
  const [publishedThisWeek, publishedLastWeek, draftCount] = await Promise.all([
    db.select().from(projects).where(and(eq(projects.brandId, brandId), eq(projects.status, "published"), gte(projects.updatedAt, sevenDaysAgo))),
    db.select().from(projects).where(and(eq(projects.brandId, brandId), eq(projects.status, "published"), gte(projects.updatedAt, fourteenDaysAgo), lt(projects.updatedAt, sevenDaysAgo))),
    db.select().from(projects).where(and(eq(projects.brandId, brandId), eq(projects.status, "ready"))),
  ]);

  // Aktivitas 7 hari terakhir (bar chart) - dari data KAMI SENDIRI (projects.updatedAt),
  // BUKAN dari metrik Buffer (AnalyticsSummary.tsx yg sudah ada itu per-akun/agregat
  // total, bukan time-series harian, & kena limit histori 30 hari akun free-plan Buffer -
  // data kami sendiri lebih reliable & tidak tergantung API pihak ketiga).
  const dailyActivity: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const count = publishedThisWeek.filter((p) => p.updatedAt >= dayStart && p.updatedAt < dayEnd).length;
    dailyActivity.push({ date: dayStart.toISOString().slice(0, 10), count });
  }

  // Streak (2026-08-13) - hari berturut-turut (mundur dari HARI INI) yg py minimal 1
  // publish. Cukup 14 hari ke belakang utk hitung streak wajar (brand paling aktif
  // publish tiap hari, streak >14 jarang relevan utk ditampilkan di kartu kecil).
  const recentPublished = await db
    .select({ updatedAt: projects.updatedAt })
    .from(projects)
    .where(and(eq(projects.brandId, brandId), eq(projects.status, "published"), gte(projects.updatedAt, fourteenDaysAgo)));
  const publishedDays = new Set(recentPublished.map((p) => p.updatedAt.toISOString().slice(0, 10)));
  let streak = 0;
  for (let i = 0; i < 14; i++) {
    const day = new Date(today.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (publishedDays.has(day)) streak++;
    else break;
  }

  // Distribusi platform (donut chart) - dari publish_logs SUKSES 30 hari terakhir,
  // join social_accounts utk nama platform (publish_logs sendiri cuma py socialAccountId).
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const brandProjectIds = (await db.select({ id: projects.id }).from(projects).where(eq(projects.brandId, brandId))).map((p) => p.id);
  const platformCounts: Record<string, number> = {};
  if (brandProjectIds.length > 0) {
    const logs = await db
      .select({ socialAccountId: publishLogs.socialAccountId })
      .from(publishLogs)
      .where(and(inArray(publishLogs.projectId, brandProjectIds), eq(publishLogs.status, "success"), gte(publishLogs.createdAt, thirtyDaysAgo)));
    const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.brandId, brandId));
    const platformByAccountId = new Map(accounts.map((a) => [a.id, a.platform]));
    for (const l of logs) {
      const platform = platformByAccountId.get(l.socialAccountId) || "lainnya";
      platformCounts[platform] = (platformCounts[platform] || 0) + 1;
    }
  }

  // Biaya AI bulan ini, per-brand (2026-08-13) - beda dari /api/usage-summary yg GLOBAL
  // lintas brand - llmUsageLog.brandId sudah tersedia sejak Fase 1a Animal Story & Co
  // (cost dashboard per-brand), tinggal dipakai.
  const costRows = await db
    .select({ costUsd: llmUsageLog.costUsd })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.brandId, brandId), gte(llmUsageLog.ts, startOfMonth)));
  const costThisMonth = costRows.reduce((sum, r) => sum + (r.costUsd || 0), 0);

  const deltaPercent =
    publishedLastWeek.length > 0
      ? Math.round(((publishedThisWeek.length - publishedLastWeek.length) / publishedLastWeek.length) * 100)
      : publishedThisWeek.length > 0
        ? 100
        : 0;

  return NextResponse.json({
    publishedThisWeek: publishedThisWeek.length,
    publishedThisWeekDeltaPercent: deltaPercent,
    draftCount: draftCount.length,
    costThisMonth,
    streak,
    dailyActivity,
    platformDistribution: Object.entries(platformCounts).map(([platform, count]) => ({ platform, count })),
  });
}

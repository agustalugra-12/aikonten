import { db } from "@/db";
import { projects, publishLogs, socialAccounts } from "@/db/schema";
import { and, eq, isNull, or, lt, isNotNull, desc } from "drizzle-orm";
import { getPostMetrics } from "@/lib/publish/bufferAuth";
import { getYoutubeVideoMetrics } from "@/lib/publish/youtube";
import { ensureFreshYoutubeAccessToken } from "@/lib/publish/youtubeAuth";

// AI Learning Engine (2026-08-05, PRD "AI Content Brain" modul 13, permintaan Agus -
// "AI membaca View/Like/Share/Comment/Watch Time/CTR, belajar konten mana yg paling
// disukai, meningkatkan produksi konten serupa"). Diverifikasi LIVE ke Buffer API
// SEBELUM dibangun (getPostMetrics, lihat bufferAuth.ts) - data performa ASLI memang
// tersedia (views nyata 266/220/163 dari post yg SUDAH published brand ini), bukan
// asumsi cold-start kosong.
//
// Sync LAZY (2026-08-05, sama pola dgn dailyContentPlanner.ts - KontenPilot AI belum
// punya infra cron) - dipanggil dari getOrGenerateDailyIdeas SEKALI per hari, BUKAN
// tiap request. Skip project yg baru disync <6 jam lalu (hemat API call, metrik
// Buffer sendiri jg tidak update real-time).
const RESYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function syncBrandPerformance(brandId: string): Promise<void> {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - RESYNC_INTERVAL_MS);

  // orderBy DESC createdAt (2026-08-26, bug nyata ditemukan Agus - "laundry in bali blum
  // muncul" di laporan mingguan) - SEBELUM ini TANPA ORDER BY, jadi urutan candidate
  // ikut rowid/insertion order (tertua duluan). syncProjectPerformance() TIDAK PERNAH
  // set performanceSyncedAt kalau anyMetricsFound=false (mis. post Buffer sudah kehapus/
  // API permanen gagal utk post itu) - project TUA yg metriknya permanen tidak bisa
  // diambil jadi SELALU kepilih ulang tiap panggilan & menghabiskan limit(20), project
  // BARU (yg justru relevan utk laporan 7 hari) tidak pernah kebagian slot sync. Diverifikasi
  // langsung ke DB brand Laundry In Bali: 229 publish sukses, publish TERBARU kemarin,
  // tapi performance_synced_at PALING BARU cuma sampai 12 Agustus - persis gejala ini.
  const candidateProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.brandId, brandId),
        eq(projects.status, "published"),
        or(isNull(projects.performanceSyncedAt), lt(projects.performanceSyncedAt, staleThreshold))
      )
    )
    .orderBy(desc(projects.createdAt))
    .limit(20); // batasi per pemanggilan - hindari 1 sync borongan lambat/kena rate limit

  for (const p of candidateProjects) {
    try {
      await syncProjectPerformance(p.id);
    } catch (err) {
      // Best-effort - 1 project gagal sync (mis. Buffer API error sementara) TIDAK
      // BOLEH gagalkan seluruh alur generate ide harian yg memanggil fungsi ini.
      console.error(`[performanceLearning] gagal sync project ${p.id}:`, err);
    }
  }
}

async function syncProjectPerformance(projectId: string): Promise<void> {
  const logs = await db
    .select({ id: publishLogs.id, platformPostId: publishLogs.platformPostId, socialAccountId: publishLogs.socialAccountId })
    .from(publishLogs)
    .where(and(eq(publishLogs.projectId, projectId), eq(publishLogs.status, "success"), isNotNull(publishLogs.platformPostId)));

  let totalViews = 0;
  let engagementSum = 0;
  let engagementCount = 0;
  let anyMetricsFound = false;

  for (const log of logs) {
    if (!log.platformPostId) continue;
    // Token per-akun (2026-08-06, permintaan Agus - lihat catatan bufferAuth.ts) - akun
    // Buffer brand ini bisa beda dari default, cari token tersimpannya dulu.
    const [account] = log.socialAccountId
      ? await db.select().from(socialAccounts).where(eq(socialAccounts.id, log.socialAccountId))
      : [];

    // Cabang native YouTube (2026-08-08, lihat catatan lengkap di getYoutubeVideoMetrics,
    // youtube.ts) - post YouTube TIDAK PERNAH lewat Buffer, getPostMetrics generic di
    // bawah tidak akan pernah mengenali platformPostId-nya. UNTESTED ke channel nyata
    // (belum ada yang connect) - lihat catatan di getYoutubeVideoMetrics.
    let metrics;
    if (account?.platform === "youtube" && account.publishVia === "native") {
      try {
        const accessToken = await ensureFreshYoutubeAccessToken(account);
        metrics = await getYoutubeVideoMetrics(log.platformPostId, accessToken);
      } catch (err) {
        console.error(`[performanceLearning] gagal sync metrik YouTube native utk post ${log.platformPostId}:`, err);
        continue;
      }
    } else {
      metrics = await getPostMetrics(log.platformPostId, account?.accessToken);
    }
    if (!metrics) continue;
    anyMetricsFound = true;
    const views = metrics.find((m) => m.type === "views")?.value;
    const engagement = metrics.find((m) => m.type === "engagementRate")?.value;
    if (typeof views === "number") totalViews += views;
    if (typeof engagement === "number") {
      engagementSum += engagement;
      engagementCount += 1;
    }
    // Platform Normalization (2026-08-26, PRD §18, Task Plan 3) - simpan metrik PER LOG
    // (per platform/akun), BUKAN cuma total gabungan di bawah - baseline-per-platform
    // butuh angka asli per-platform, lihat catatan lengkap di schema.ts's publishLogs.views.
    await db
      .update(publishLogs)
      .set({
        views: typeof views === "number" ? Math.round(views) : null,
        engagementRate: typeof engagement === "number" ? Math.round(engagement * 100) : null,
      })
      .where(eq(publishLogs.id, log.id));
  }

  if (!anyMetricsFound) return; // belum ada data sama sekali - jangan tulis performanceSyncedAt (coba lagi nanti, bukan "sudah dicek, kosong")

  await db
    .update(projects)
    .set({
      performanceViews: Math.round(totalViews),
      performanceEngagementRate: engagementCount > 0 ? Math.round((engagementSum / engagementCount) * 100) : null,
      performanceSyncedAt: new Date(),
    })
    .where(eq(projects.id, projectId));
}

export type PerformanceClassification = {
  pillar: string | null;
  angle: string | null;
  performanceViews: number | null;
};

// Insight "konten mana yg paling disukai" (2026-08-05) - hitung rata2 views PER PILAR
// dari konten yg SUDAH punya data performa nyata, suntik ke prompt suggestScoredContentIdeas
// (dipakai jg sbg salah satu kriteria skor Opportunity Finder - "potensi menarik calon
// tamu" SEKARANG py dasar data nyata, bukan cuma tebakan model).
export function buildPerformanceInsightBlock(classifications: PerformanceClassification[]): string {
  const withData = classifications.filter((c) => c.performanceViews !== null && c.pillar);
  if (withData.length < 3) {
    // Data terlalu sedikit utk kesimpulan bermakna - JUJUR bilang belum cukup data,
    // JANGAN paksa insight dari sampel kecil yg menyesatkan.
    return "";
  }

  const pillarViews: Record<string, number[]> = {};
  for (const c of withData) {
    if (!c.pillar) continue;
    (pillarViews[c.pillar] ||= []).push(c.performanceViews!);
  }
  const avgLines = Object.entries(pillarViews)
    .map(([pillar, views]) => {
      const avg = Math.round(views.reduce((a, b) => a + b, 0) / views.length);
      return { pillar, avg, count: views.length };
    })
    .sort((a, b) => b.avg - a.avg)
    .map((p) => `- ${p.pillar}: rata-rata ${p.avg} views (dari ${p.count} konten)`)
    .join("\n");

  return (
    `\n\n# PERFORMA KONTEN NYATA (dari ${withData.length} konten yg sudah published & ` +
    `punya data views asli dari Buffer)\n${avgLines}\n\n` +
    "Ini SINYAL performa ASLI (bukan tebakan) - pertimbangkan sbg salah satu faktor " +
    "(bukan satu-satunya) saat memberi skor ide: pilar dgn performa lebih baik LAYAK " +
    "dapat pertimbangan tambahan, TAPI jangan abaikan total variasi/keyword priority " +
    "yg sudah dihitung di atas - tujuannya seimbang, bukan cuma ulangi yg sudah terbukti."
  );
}

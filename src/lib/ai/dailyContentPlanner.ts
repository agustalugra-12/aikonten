import { db } from "@/db";
import { dailyIdeas, brands, projects, manualIdeas, socialAccounts, competitors } from "@/db/schema";
import { and, eq, desc, asc, inArray } from "drizzle-orm";
import { suggestScoredContentIdeas, todayDateKeyWita } from "./researchTopics";
import { syncBrandPerformance } from "./performanceLearning";
import { getChannelProfile, generateYoutubeDailyIdeas } from "./youtubeEditorial";
import { newId } from "@/lib/ids";
import { runWithUsageContext } from "./usageContext";
import { generateTrendAdaptation, filterTrendsForContextFirewall } from "./trendAdaptation";
import { getMonthlyReportData } from "@/lib/reports/monthlyReportData";
import { getMediumPerformance, classifyIdeaExperimentTier } from "./contentVariety";

// AI Content Planner (2026-08-05, permintaan Agus, PRD "AI Content Brain" modul 10 -
// "setiap pagi AI membuat 10 ide"). Digenerate SEKALI per hari (lazy - saat pertama
// kali dashboard/panel dibuka hari itu, BUKAN cron terjadwal - KontenPilot AI belum
// punya infra cron sama sekali, beda dari ai-chat-bot/web-pelangi yg sudah py systemd
// timer, jadi ini pola paling sederhana yg mencapai hasil praktis sama: "10 ide segar
// tiap hari" tanpa nambah komponen infra baru) & DIPERSIST (dailyIdeas) supaya
// konsisten sepanjang hari - refresh halaman tidak menghasilkan batch baru yg beda.
//
// Opportunity Finder (2026-08-05) - pakai suggestScoredContentIdeas (BUKAN
// suggestContentIdeas biasa) supaya tiap ide dapat score+reasoning eksplisit sesuai
// PRD Agus, diurutkan skor tertinggi dulu.
//
// Volume harian per-tipe (2026-08-05, revisi Agus - awalnya "3 foto 7 video" [total
// tetap 10], DIREVISI hari yg sama jadi 3 tipe TERPISAH tanpa total tetap: "4 foto, 4
// vidio, 4 curasel artinya 12 konten" - total sekarang murni SEJUMLAH yg di-set Agus
// (brands.dailyVideoCount + dailySinglePhotoCount + dailyCarouselCount), lihat schema.ts.

export type DailyIdea = {
  id: string;
  idea: string;
  used: boolean;
  score: number | null;
  reasoning: string | null;
  contentType: "video" | "foto" | "carousel" | null;
  contentFormat: string | null;
  youtubeSeriesId: string | null;
  youtubeMetadata: string | null;
  pillar: string | null;
  // Experiment Engine (2026-08-25, PRD §24, Task 4 Plan 1) - observational SAJA, lihat
  // catatan lengkap di contentVariety.ts's classifyIdeaExperimentTier soal kenapa ini
  // BUKAN gating pemilihan ide.
  experimentTier: "proven" | "variation" | "experiment" | null;
  // Platform Fit Score (2026-08-26, PRD §19, Task Plan 5) - lihat catatan lengkap di
  // researchTopics.ts's ScoredIdea. {} = brand belum py akun terhubung/data blm ada.
  platformFitScores: Record<string, number>;
};

export function parseStoredPlatformFitScores(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function getOrGenerateDailyIdeas(brandId: string): Promise<DailyIdea[]> {
  // Atribusi biaya (2026-08-12, Fase 1a) - projectId belum ada di titik ini (ide belum
  // jadi project), cukup brandId - lihat usageContext.ts.
  return runWithUsageContext({ brandId }, async () => {
  const today = todayDateKeyWita();
  // Experiment Engine (2026-08-25, Task 4 Plan 1) - dihitung sekali per panggilan, dipakai
  // ulang di semua jalur return (cache/YouTube/generik) - cuma agregasi SQL dari
  // performanceViews yg sudah ada, bukan panggilan AI, aman dihitung tiap kali dibaca.
  const mediumPerf = await getMediumPerformance(brandId);

  const existing = await db
    .select()
    .from(dailyIdeas)
    .where(and(eq(dailyIdeas.brandId, brandId), eq(dailyIdeas.date, today)));
  if (existing.length > 0) {
    return existing
      .map((r) => ({
        id: r.id, idea: r.idea, used: r.used, score: r.score, reasoning: r.reasoning,
        contentType: r.contentType, contentFormat: r.contentFormat,
        youtubeSeriesId: r.youtubeSeriesId, youtubeMetadata: r.youtubeMetadata,
        pillar: r.pillar,
        experimentTier: classifyIdeaExperimentTier(r.contentType, mediumPerf),
        platformFitScores: parseStoredPlatformFitScores(r.platformFitScores),
      }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) throw new Error("Brand tidak ditemukan");

  // AI Learning Engine (2026-08-05) - sync performa (views/engagement dari Buffer,
  // lihat performanceLearning.ts) SEKALI per hari, bareng dgn generate ide harian -
  // best-effort, JANGAN gagalkan seluruh alur ide kalau sync gagal (mis. Buffer API
  // down sementara).
  await syncBrandPerformance(brandId).catch((err) => {
    console.error(`[dailyContentPlanner] gagal sync performa brand ${brandId}:`, err);
  });

  // Histori lebih lebar drpd "Ide Konten" on-demand (15 -> 30 skrip terakhir) - batch
  // 10 ide sekaligus butuh lebih banyak konteks anti-pengulangan drpd cuma 3-5 ide.
  const recentProjects = await db
    .select({
      script: projects.script, pillar: projects.pillar, angle: projects.angle,
      targetKeyword: projects.targetKeyword, keywordLevel: projects.keywordLevel,
      performanceViews: projects.performanceViews,
    })
    .from(projects)
    .where(eq(projects.brandId, brandId))
    .orderBy(desc(projects.createdAt))
    .limit(30);
  const recentScripts = recentProjects.map((p) => p.script).filter((s): s is string => !!s);

  // YouTube Editorial Engine (2026-08-10, PRD Agus "YouTube Long Form Content Engine" +
  // "YouTube Shorts Engine", reusable per channel - "siapa tau aku mau buat channel
  // lain") - HANYA aktif kalau brand ini py akun YouTube DAN akun itu sudah diisi
  // Editorial Policy (channelProfiles, lihat ChannelProfileDialog.tsx). Brand TANPA
  // channel YouTube atau YANG BELUM isi Editorial Policy-nya (Pelangi/Harmoni/laundry
  // in bali - SEMUA brand yg ada sebelum fitur ini) jatuh ke jalur GENERIK lama di
  // bawah, PERSIS PERILAKU SAMA spt sebelum fitur ini ada - zero regression.
  const [youtubeAccount] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.brandId, brandId), eq(socialAccounts.platform, "youtube")));
  const channelProfile = youtubeAccount ? await getChannelProfile(youtubeAccount.id) : null;

  if (channelProfile) {
    const longCount = brand.dailyVideoCount;
    const shortCount = brand.dailyYoutubeShortsCount;
    const ytIdeas = await generateYoutubeDailyIdeas(channelProfile, youtubeAccount!.id, longCount, shortCount, recentScripts);

    const now = new Date();
    const rows = ytIdeas.map((yi) => ({
      id: newId("idea"),
      brandId,
      date: today,
      idea: yi.idea,
      used: false,
      score: null,
      reasoning: null,
      contentType: yi.contentType,
      contentFormat: yi.contentFormat,
      youtubeSeriesId: yi.youtubeSeriesId,
      youtubeMetadata: JSON.stringify(yi.youtubeMetadata),
      pillar: yi.pillar,
      createdAt: now,
    }));
    if (rows.length > 0) {
      await db.insert(dailyIdeas).values(rows);
    }
    return rows.map((r) => ({
      id: r.id, idea: r.idea, used: r.used, score: r.score, reasoning: r.reasoning,
      contentType: r.contentType, contentFormat: r.contentFormat,
      youtubeSeriesId: r.youtubeSeriesId, youtubeMetadata: r.youtubeMetadata,
      pillar: r.pillar,
      experimentTier: classifyIdeaExperimentTier(r.contentType, mediumPerf),
      platformFitScores: {}, // jalur YouTube Editorial - platformFitScores blm dihitung di sini
    }));
  }
  // Duplicate Checker, Content Pillar, & Keyword Priority NYATA (2026-08-05) - kirim
  // klasifikasi ASLI (bukan cuma teks skrip mentah) supaya distribusi pilar/angle/
  // keyword SEBENARNYA dipertimbangkan, lihat buildDistributionBlock &
  // buildKeywordPriorityBlock di researchTopics.ts/keywordPriority.ts.
  const recentClassifications = recentProjects.map((p) => ({
    pillar: p.pillar, angle: p.angle, targetKeyword: p.targetKeyword, keywordLevel: p.keywordLevel,
  }));
  const performanceClassifications = recentProjects.map((p) => ({
    pillar: p.pillar, angle: p.angle, performanceViews: p.performanceViews,
  }));

  // Context Firewall (2026-08-25, PRD §5) - tren dianalisis SEKALI per hari, bareng
  // syncBrandPerformance di atas (pola lazy/once-a-day yg SAMA - tidak menambah infra
  // cron baru, cukup 1 panggilan gpt-4.1-mini murah tambahan per brand per hari).
  // trendAdaptation.ts SUDAH menilai relevanceScore & recommendation - firewall di sini
  // cuma MEMFILTER: item yg genuinely tidak relevan (recommendation="ignore" DAN tidak
  // ada mechanismNote) DIBUANG SELURUHNYA (topiknya tidak pernah dikirim ke prompt ide),
  // sisanya HANYA mechanismNote (kalau ada, kasus "ignore" tapi mekanismenya berguna)
  // atau nama tren+reasoning (kasus act_now/monitor) yg dikirim - never topik mentah
  // dari tren yg sudah diputuskan tidak relevan.
  let mechanismInsights: string[] = [];
  try {
    const comps = await db.select().from(competitors).where(eq(competitors.brandId, brandId));
    const ownPerformance = await getMonthlyReportData(brandId, 30);
    if (ownPerformance.totalContent >= 3) {
      const trendResult = await generateTrendAdaptation(brand.name, comps, ownPerformance);
      mechanismInsights = filterTrendsForContextFirewall(trendResult.trends);
    }
  } catch (err) {
    console.error(`[dailyContentPlanner] gagal analisis tren utk Context Firewall brand ${brandId}:`, err);
  }

  // Bank Ide Manual (2026-08-06, permintaan Agus - "otomatis diambil sebagai bahan
  // konten jika sudah habis otomatis masuk ke ide konten yang disediakan ai") - ambil
  // ide BELUM DIPAKAI punya brand ini, FIFO (createdAt terlama dulu - ide yg diupload
  // duluan dipakai duluan), MAKSIMAL sejumlah target harian (sisanya biar AI generate
  // sendiri, lihat mustIncludeIdeas di suggestScoredContentIdeas).
  // YT Shorts (2026-08-10, permintaan Agus - "pengaturan untuk yt short di automation")
  // - dilebur ke bucket "video" saat MINTA ide (LLM tidak perlu tahu konsep ini, cukup
  // brainstorm ide video spt biasa - lihat catatan schema.ts) - videoCountForIdeas =
  // video biasa + YT Shorts DIGABUNG, supaya jumlah ide video yg diminta tetap benar
  // (bukan diam-diam mencuri slot dari dailyVideoCount). Ditandai contentFormat
  // "youtube_shorts" SETELAH hasil balik, deterministik di kode (bukan diserahkan ke
  // LLM) - N ide video TERAKHIR (skor terendah di antara video) jadi YT Shorts, sisanya
  // video biasa - ide mana yg kebagian tidak penting krn semua ide "video" setara
  // (belum ada framing konten YT Shorts vs video biasa yg berbeda di tahap ide).
  const videoCountForIdeas = brand.dailyVideoCount + brand.dailyYoutubeShortsCount;
  const dailyTotal = videoCountForIdeas + brand.dailySinglePhotoCount + brand.dailyCarouselCount;
  const manualPool = await db
    .select()
    .from(manualIdeas)
    .where(and(eq(manualIdeas.brandId, brandId), eq(manualIdeas.used, false)))
    .orderBy(asc(manualIdeas.createdAt))
    .limit(dailyTotal);

  // Platform Fit Score (2026-08-26, PRD §19, Task Plan 5) - platform yg BENERAN
  // terhubung brand ini, bukan daftar semua platform yg didukung app.
  const connectedAccounts = await db.select({ platform: socialAccounts.platform }).from(socialAccounts).where(eq(socialAccounts.brandId, brandId));
  const connectedPlatforms = Array.from(new Set(connectedAccounts.map((a) => a.platform)));

  const scoredIdeas = await suggestScoredContentIdeas(
    brand.name, brand.description, recentScripts,
    videoCountForIdeas, brand.dailySinglePhotoCount, brand.dailyCarouselCount,
    recentClassifications, performanceClassifications, brand.knowledgeSite, brand.manualKnowledge,
    manualPool.map((m) => m.idea),
    brand.contentPillars,
    mechanismInsights,
    connectedPlatforms
  );

  if (manualPool.length > 0) {
    await db.update(manualIdeas).set({ used: true }).where(inArray(manualIdeas.id, manualPool.map((m) => m.id)));
  }

  const videoIdeaIndices = scoredIdeas
    .map((s, i) => ({ contentType: s.contentType, i }))
    .filter((x) => x.contentType === "video")
    .map((x) => x.i);
  const shortsIndices = new Set(videoIdeaIndices.slice(-brand.dailyYoutubeShortsCount));

  const now = new Date();
  const rows = scoredIdeas.map((s, i) => ({
    id: newId("idea"),
    brandId,
    date: today,
    idea: s.idea,
    used: false,
    score: s.score,
    reasoning: s.reasoning,
    contentType: s.contentType,
    contentFormat: shortsIndices.has(i) ? "youtube_shorts" : null,
    platformFitScores: Object.keys(s.platformFitScores).length > 0 ? JSON.stringify(s.platformFitScores) : null,
    createdAt: now,
  }));
  if (rows.length > 0) {
    await db.insert(dailyIdeas).values(rows);
  }
  return rows.map((r) => ({
    id: r.id, idea: r.idea, used: r.used, score: r.score, reasoning: r.reasoning,
    contentType: r.contentType, contentFormat: r.contentFormat,
    youtubeSeriesId: null, youtubeMetadata: null,
    // Jalur generik: pillar BELUM diklasifikasi di tahap ide (baru diklasifikasi
    // processProject.ts->generateCaptionAndHashtags saat project benar2 diproses) -
    // null di sini konsisten dgn perilaku lama, BUKAN regresi.
    pillar: null,
    experimentTier: classifyIdeaExperimentTier(r.contentType, mediumPerf),
    platformFitScores: parseStoredPlatformFitScores(r.platformFitScores),
  }));
  });
}

export async function forceRegenerateDailyIdeas(brandId: string): Promise<DailyIdea[]> {
  const today = todayDateKeyWita();
  await db.delete(dailyIdeas).where(and(eq(dailyIdeas.brandId, brandId), eq(dailyIdeas.date, today)));
  return getOrGenerateDailyIdeas(brandId);
}

export async function markDailyIdeaUsed(ideaId: string): Promise<void> {
  await db.update(dailyIdeas).set({ used: true }).where(eq(dailyIdeas.id, ideaId));
}

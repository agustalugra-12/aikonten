import { db } from "@/db";
import { dailyIdeas, brands, projects, manualIdeas, socialAccounts } from "@/db/schema";
import { and, eq, desc, asc, inArray } from "drizzle-orm";
import { suggestScoredContentIdeas, todayDateKeyWita } from "./researchTopics";
import { syncBrandPerformance } from "./performanceLearning";
import { getChannelProfile, generateYoutubeDailyIdeas } from "./youtubeEditorial";
import { newId } from "@/lib/ids";

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
};

export async function getOrGenerateDailyIdeas(brandId: string): Promise<DailyIdea[]> {
  const today = todayDateKeyWita();

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
      createdAt: now,
    }));
    if (rows.length > 0) {
      await db.insert(dailyIdeas).values(rows);
    }
    return rows.map((r) => ({
      id: r.id, idea: r.idea, used: r.used, score: r.score, reasoning: r.reasoning,
      contentType: r.contentType, contentFormat: r.contentFormat,
      youtubeSeriesId: r.youtubeSeriesId, youtubeMetadata: r.youtubeMetadata,
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

  const scoredIdeas = await suggestScoredContentIdeas(
    brand.name, brand.description, recentScripts,
    videoCountForIdeas, brand.dailySinglePhotoCount, brand.dailyCarouselCount,
    recentClassifications, performanceClassifications, brand.knowledgeSite, brand.manualKnowledge,
    manualPool.map((m) => m.idea)
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
    createdAt: now,
  }));
  if (rows.length > 0) {
    await db.insert(dailyIdeas).values(rows);
  }
  return rows.map((r) => ({
    id: r.id, idea: r.idea, used: r.used, score: r.score, reasoning: r.reasoning,
    contentType: r.contentType, contentFormat: r.contentFormat,
    youtubeSeriesId: null, youtubeMetadata: null,
  }));
}

export async function forceRegenerateDailyIdeas(brandId: string): Promise<DailyIdea[]> {
  const today = todayDateKeyWita();
  await db.delete(dailyIdeas).where(and(eq(dailyIdeas.brandId, brandId), eq(dailyIdeas.date, today)));
  return getOrGenerateDailyIdeas(brandId);
}

export async function markDailyIdeaUsed(ideaId: string): Promise<void> {
  await db.update(dailyIdeas).set({ used: true }).where(eq(dailyIdeas.id, ideaId));
}

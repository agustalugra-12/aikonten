import { db } from "@/db";
import { projects, mediaAssets, brands, footageBank } from "@/db/schema";
import { newId } from "@/lib/ids";
import { suggestContentIdeas } from "@/lib/ai/researchTopics";
import { matchFootageForScript, pickAnyRealPhoto } from "@/lib/ai/matchFootageBank";
import { processProject, type ProcessResult } from "@/lib/pipeline/processProject";
import { isIdeSpesifikProperti } from "@/lib/ai/classifyIdea";
import { deriveBrollKeywordsFromScript } from "@/lib/ai/deriveBrollKeywords";
import { searchBrollVideo } from "@/lib/assets/broll";
import { getRecentlyUsedFootageUrls, getRemoteFileSizeBytes, MAX_FOOTAGE_BYTES, selectBalancedRealFootage } from "@/lib/ai/footageVariety";
import { getDurationConfig } from "@/lib/ai/clipSelect";
import { eq, desc } from "drizzle-orm";

// Diekstrak (2026-08-06) dari /api/brands/[id]/auto-content/route.ts SUPAYA dipakai
// BARENG oleh endpoint HTTP itu (klik manual "⚡ Konten Otomatis") DAN
// /api/cron/auto-generate (batch harian brand publishMode="auto", lihat PRD Agus
// "draft atau langsung publis... hasil generate akan diam di draft sampai jam yang
// ditentukan") - SATU logika yg sama persis, bukan duplikasi 2 tempat yg bisa
// menyimpang. route.ts sekarang cuma wrapper HTTP tipis di atas fungsi ini.
const MAX_VIDEO_CLIPS_AUTO = 20;
const DEFAULT_CAROUSEL_PHOTOS_AUTO = 5;

export class AutoContentError extends Error {
  status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.status = status;
  }
}

export async function runAutoContent(
  brandId: string,
  scriptOverride?: string
): Promise<{ projectId: string; script: string; fromBroll: boolean } & ProcessResult> {
  let script = scriptOverride;

  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) {
    throw new AutoContentError("Brand tidak ditemukan", 404);
  }

  if (!script) {
    const recentProjects = await db
      .select({ script: projects.script })
      .from(projects)
      .where(eq(projects.brandId, brandId))
      .orderBy(desc(projects.createdAt))
      .limit(15);
    const recentScripts = recentProjects.map((p) => p.script).filter((s): s is string => !!s);
    const ideas = await suggestContentIdeas(brand.name, brand.description, recentScripts, 4, [], brand.knowledgeSite, brand.manualKnowledge);
    if (ideas.length === 0) {
      throw new AutoContentError("AI tidak berhasil kasih ide konten");
    }
    script = ideas[0];
  }

  const matchedUrls = await matchFootageForScript(brandId, script);
  let type: "video" | "carousel" = "carousel";
  let urlsToUse: string[] = [];
  let fromBroll = false;
  let brollAssetDurationSeconds: number | null = null;

  if (matchedUrls.length > 0) {
    const matchedRows = await db.select().from(footageBank).where(eq(footageBank.brandId, brandId));
    const matchedItems = matchedRows.filter((r) => matchedUrls.includes(r.fileUrl));
    const isVideo = matchedItems[0]?.mediaType === "video";
    type = isVideo ? "video" : "carousel";
    if (isVideo) {
      const recentlyUsed = await getRecentlyUsedFootageUrls(brandId);

      async function filterViableSize<T extends { fileUrl: string }>(items: T[]): Promise<T[]> {
        const sized = await Promise.all(
          items.map(async (r) => ({ item: r, size: await getRemoteFileSizeBytes(r.fileUrl) }))
        );
        return sized.filter((s) => s.size === null || s.size <= MAX_FOOTAGE_BYTES).map((s) => s.item);
      }

      const durationConfig = getDurationConfig(brand.videoDurationTarget);
      const TARGET_VIDEO_CLIP_COUNT = Math.ceil(durationConfig.realBudgetSeconds / 3.7);
      const videoCandidates = matchedItems.filter((r) => r.mediaType === "video");
      const allBankVideos = matchedRows.filter((r) => r.mediaType === "video");
      urlsToUse = await selectBalancedRealFootage({
        themedCandidates: videoCandidates,
        allBankVideos,
        recentlyUsed,
        targetCount: Math.min(TARGET_VIDEO_CLIP_COUNT, MAX_VIDEO_CLIPS_AUTO),
        filterViableSize,
      });
    } else {
      // Bug NYATA ditemukan lewat tes live (2026-08-06) - matchFootageForScript boleh
      // balikin CAMPURAN foto & video sekaligus (relevansi tema, bukan dipisah per tipe
      // media) - SEBELUM ini kode di sini ambil N URL PERTAMA dari matchedUrls MENTAH
      // tanpa filter tipe, jadi kalau ada .mp4 nyempil di antara N foto teratas, file
      // video itu ikut dikirim ke vision API sbg "foto" & ditolak OpenAI ("unsupported
      // image format") - persis akar penyebab kegagalan lama yg pernah ditemukan (project
      // gagal dgn .mp4 tercampur di raw_footage carousel). Filter ke mediaType="image"
      // DULU sebelum slice, bukan asal ambil N pertama.
      const imageOnlyUrls = matchedItems.filter((r) => r.mediaType === "image").map((r) => r.fileUrl);
      urlsToUse = imageOnlyUrls.slice(0, brand.carouselPhotosPerPost || DEFAULT_CAROUSEL_PHOTOS_AUTO);
      // Kalau kandidat tema TERNYATA semua video (mediaType item pertama "video" tapi ada
      // foto lain di urutan bawah SUDAH kekurangan) atau malah 0 foto sama sekali di hasil
      // tema - fallback ke foto asli APA SAJA (pickAnyRealPhoto, sama pola dgn cabang
      // "tidak ada footage cocok" di bawah) drpd project gagal total krn kandidat foto
      // kosong walau bank sebenarnya py foto.
      if (urlsToUse.length === 0) {
        const anyPhoto = await pickAnyRealPhoto(brandId);
        if (anyPhoto) urlsToUse = [anyPhoto];
      }
    }
  } else {
    const spesifik = isIdeSpesifikProperti(script);

    if (!spesifik) {
      try {
        const keywords = await deriveBrollKeywordsFromScript(script);
        const broll = await searchBrollVideo(keywords);
        if (broll) {
          type = "video";
          urlsToUse = [broll.videoUrl];
          fromBroll = true;
          brollAssetDurationSeconds = broll.durationSeconds;
        }
      } catch (err) {
        console.error("[autoContent] fallback Pexels/Pixabay gagal:", err);
      }
    }

    if (urlsToUse.length === 0) {
      const anyPhoto = await pickAnyRealPhoto(brandId);
      if (anyPhoto) {
        type = "carousel";
        urlsToUse = [anyPhoto];
      }
    }

    if (urlsToUse.length === 0) {
      throw new AutoContentError(
        spesifik
          ? "Ide ini spesifik soal properti (harga/fasilitas/kamar) - wajib footage/foto asli, tidak ada yg cocok di Bank Footage. Upload dulu footage asli, atau foto apa pun (utk fallback foto)."
          : "Tidak ada footage di bank yg cocok, video stok cadangan juga tidak ketemu, dan belum ada foto asli sama sekali di Bank Footage."
      );
    }
  }

  const now = new Date();
  const projectId = newId("proj");

  await db.insert(projects).values({
    id: projectId,
    brandId,
    type,
    status: "uploaded",
    script,
    transcript: null,
    clipSelection: null,
    generatedCaption: null,
    generatedHashtags: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  });

  for (const url of urlsToUse) {
    await db.insert(mediaAssets).values({
      id: newId("asset"),
      projectId,
      type: "raw_footage",
      fileUrl: url,
      durationSeconds: fromBroll && url === urlsToUse[0] ? brollAssetDurationSeconds : null,
      createdAt: new Date(),
    });
  }

  const result = await processProject(projectId);
  return { projectId, script, fromBroll, ...result };
}

import { db } from "@/db";
import { projects, mediaAssets, brands, footageBank, socialAccounts } from "@/db/schema";
import { newId } from "@/lib/ids";
import { suggestContentIdeas } from "@/lib/ai/researchTopics";
import { matchFootageForScript, pickAnyRealPhoto } from "@/lib/ai/matchFootageBank";
import { processProject, type ProcessResult } from "@/lib/pipeline/processProject";
import { isIdeSpesifikProperti } from "@/lib/ai/classifyIdea";
import { deriveBrollKeywordsFromScript } from "@/lib/ai/deriveBrollKeywords";
import { searchBrollVideo } from "@/lib/assets/broll";
import { getFootageUsageRecency, getRemoteFileSizeBytes, MAX_FOOTAGE_BYTES, selectBalancedRealFootage } from "@/lib/ai/footageVariety";
import { getDurationConfig } from "@/lib/ai/clipSelect";
import { getChannelProfile } from "@/lib/ai/youtubeEditorial";
import { getOrGenerateDailyIdeas, markDailyIdeaUsed } from "@/lib/ai/dailyContentPlanner";
import { eq, desc, and } from "drizzle-orm";

// Diekstrak (2026-08-06) dari /api/brands/[id]/auto-content/route.ts SUPAYA dipakai
// BARENG oleh endpoint HTTP itu (klik manual "⚡ Konten Otomatis") DAN
// /api/cron/auto-generate (batch harian brand publishMode="auto", lihat PRD Agus
// "draft atau langsung publis... hasil generate akan diam di draft sampai jam yang
// ditentukan") - SATU logika yg sama persis, bukan duplikasi 2 tempat yg bisa
// menyimpang. route.ts sekarang cuma wrapper HTTP tipis di atas fungsi ini.
// 20 tetap cukup utk video pendek lama (30-90dtk, butuh ~6-17 klip @3,7dtk/klip rata2) -
// tapi target long-form baru (180-480dtk, 2026-08-06) bisa butuh puluhan klip real kalau
// footage bank brand-nya suatu saat cukup besar. selectBalancedRealFootage() sendiri
// SUDAH aman dibatasi jumlah kandidat yg BENERAN ada (.slice), jadi menaikkan batas ini
// tidak beresiko "maksa" ambil lebih dari yg tersedia - cuma menghapus plafon buatan yg
// SEBELUM ini lebih rendah dari kebutuhan real video 8 menit.
const MAX_VIDEO_CLIPS_AUTO = 60;
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
  scriptOverride?: string,
  // Tipe konten yg DIMINTA (2026-08-06, bug nyata - laporan Agus "konten vidionya
  // tidak ada malah foto semua") - dari daily_ideas.contentType kalau dipanggil cron
  // auto-generate, opsional (manual "⚡ Konten Otomatis" tanpa ide pre-klasifikasi tetap
  // jalan spt sebelumnya, lihat pemakaiannya di bawah).
  desiredType?: "video" | "foto" | "carousel",
  // YT Shorts (2026-08-10, permintaan Agus) - dari daily_ideas.contentFormat kalau
  // dipanggil cron auto-generate, diteruskan apa adanya ke projects.contentFormat.
  // processProject.ts baca ini utk paksa portrait+<=60dtk apa pun setting brand.
  contentFormat?: string | null,
  // YouTube Editorial Engine (2026-08-10) - dari daily_ideas.youtubeSeriesId/
  // youtubeMetadata kalau ide ini datang dari youtubeEditorial.ts (lihat
  // dailyContentPlanner.ts), diteruskan apa adanya ke projects. processProject.ts baca
  // youtubeMetadata utk isi chapters (butuh durasi render asli) & pakai script APA
  // ADANYA sbg naskah (skrip dokumenter lengkap, bukan brief singkat spt ide biasa).
  youtubeSeriesId?: string | null,
  youtubeMetadata?: string | null
): Promise<{ projectId: string; script: string; fromBroll: boolean } & ProcessResult> {
  let script = scriptOverride;

  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) {
    throw new AutoContentError("Brand tidak ditemukan", 404);
  }

  if (!script) {
    // Cek dulu apakah brand ini brand YouTube Editorial (ada channel profile) SEBELUM
    // jatuh ke suggestContentIdeas (2026-08-10, bug nyata - trigger manual "⚡ Konten
    // Otomatis" tanpa scriptOverride/youtubeMetadata utk Animal Story & Co [brand
    // YouTube berbahasa Inggris] jatuh ke suggestContentIdeas, yg Indonesia-oriented &
    // brand-hospitality-oriented [ide default "behind the scenes"] - hasilnya video
    // Indonesia salah total nyasar masuk channel dokumenter Inggris. Jalur cron
    // auto-generate TIDAK kena bug ini krn dia SELALU resolve ide via
    // getOrGenerateDailyIdeas dulu baru panggil fungsi ini dgn script+youtubeMetadata
    // eksplisit - tapi trigger manual (tombol dashboard / panggilan tanpa parameter)
    // bisa lewat sini apa adanya. Fix: brand ber-channel-profile WAJIB ambil ide dari
    // getOrGenerateDailyIdeas juga (bahasa+format ikut channel), TIDAK BOLEH fallback
    // ke ide generik sama sekali - kalau semua ide hari ini sudah kepakai, GAGAL JELAS
    // drpd diam2 generate konten yg salah bahasa/brand.
    const [ytAccount] = await db
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.brandId, brandId), eq(socialAccounts.platform, "youtube")));
    const channelProfile = ytAccount ? await getChannelProfile(ytAccount.id) : null;

    if (channelProfile) {
      const todaysIdeas = await getOrGenerateDailyIdeas(brandId);
      const unused = todaysIdeas.find((i) => !i.used);
      if (!unused) {
        throw new AutoContentError(
          "Semua ide konten YouTube hari ini sudah dipakai - channel ini pakai Editorial " +
            "Engine (bukan ide bebas), tidak ada fallback generik supaya bahasa/brand tidak " +
            "salah. Coba lagi besok, atau generate ide baru manual dulu.",
          400
        );
      }
      script = unused.idea;
      desiredType = unused.contentType || undefined;
      contentFormat = unused.contentFormat;
      youtubeSeriesId = unused.youtubeSeriesId;
      youtubeMetadata = unused.youtubeMetadata;
      await markDailyIdeaUsed(unused.id);
    } else {
      const recentProjects = await db
        .select({ script: projects.script })
        .from(projects)
        .where(eq(projects.brandId, brandId))
        .orderBy(desc(projects.createdAt))
        .limit(15);
      const recentScripts = recentProjects.map((p) => p.script).filter((s): s is string => !!s);
      const ideas = await suggestContentIdeas(brand.name, brand.description, recentScripts, 4, [], brand.knowledgeSite, brand.manualKnowledge, brand.contentPillars);
      if (ideas.length === 0) {
        throw new AutoContentError("AI tidak berhasil kasih ide konten");
      }
      script = ideas[0];
    }
  }

  const matchedUrls = await matchFootageForScript(brandId, script);
  let type: "video" | "carousel" = "carousel";
  let urlsToUse: string[] = [];
  let fromBroll = false;
  let brollAssetDurationSeconds: number | null = null;
  // Full AI-Generate Poster (2026-08-11, permintaan Agus - lihat allowAiGeneratedPhotos
  // di schema.ts) - true HANYA kalau brand ini toggle-nya AKTIF DAN benar2 tidak ada
  // foto asli relevan/tersedia (dicek di 2 titik fallback di bawah). urlsToUse TETAP
  // kosong di kasus ini (BUKAN diisi foto asli yg tidak relevan) - processProject.ts
  // baca photoUrls.length===0 sbg sinyal "pakai generatePosterFullAi", lihat catatan
  // lengkap di sana.
  let useFullAiPoster = false;

  if (matchedUrls.length > 0) {
    const matchedRows = await db.select().from(footageBank).where(eq(footageBank.brandId, brandId));
    const matchedItems = matchedRows.filter((r) => matchedUrls.includes(r.fileUrl));
    // BUG NYATA ditemukan 2026-08-06 (laporan Agus - "konten vidionya tidak ada malah
    // foto semua", setting brand 7 video/hari tapi batch hari itu 0 video benaran
    // dihasilkan) - SEBELUM ini tipe akhir MURNI ditentukan dari mediaType item PERTAMA
    // di hasil match (matchedItems[0]) - urutan itu datang dari relevansi tema GPT, sama
    // sekali TIDAK terkait dgn tipe yg diminta idenya sendiri (video/foto/carousel dari
    // daily_ideas.contentType). Efeknya acak: ide berlabel "video" bisa jadi foto kalau
    // KEBETULAN item foto nangkring di urutan pertama hasil match, walau bank PUNYA
    // video asli yg relevan di urutan bawah/di luar hasil match tema.
    // Fix: kalau desiredType diketahui (dari cron, punya label ide asli), PAKSA sesuai
    // itu - "video" dipaksa isVideo=true selama bank brand ini PUNYA video asli SAMA
    // SEKALI (allBankVideos di bawah, bukan cuma yg lolos match tema - selectBalancedRealFootage
    // sudah blend keduanya), "foto"/"carousel" dipaksa isVideo=false. Kalau desiredType
    // tidak diberikan (mis. tombol manual "⚡ Konten Otomatis" tanpa ide pre-klasifikasi),
    // fallback ke heuristik lama (mediaType item pertama) - perilaku existing dipertahankan.
    const bankHasAnyVideo = matchedRows.some((r) => r.mediaType === "video");
    const isVideo =
      desiredType === "video" ? bankHasAnyVideo :
      desiredType === "foto" || desiredType === "carousel" ? false :
      matchedItems[0]?.mediaType === "video";
    type = isVideo ? "video" : "carousel";
    if (isVideo) {
      const usageRecency = await getFootageUsageRecency(brandId);

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
        usageRecency,
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
      // Bug NYATA ditemukan 2026-08-06 (laporan Agus - "aku mau yang single foto poster
      // bukan carousel") - SEBELUM ini "foto" (single photo, py kuota harian SENDIRI
      // beda dari "carousel" - lihat brand.dailySinglePhotoCount vs dailyCarouselCount di
      // BrandSettingsSidebar) diam-diam DISAMAKAN dgn "carousel" di sini, SELALU pakai
      // brand.carouselPhotosPerPost (default 5) - hasil "foto" tidak pernah benar2 1 foto
      // kecuali kebetulan carouselPhotosPerPost=1. desiredType="foto" sekarang eksplisit
      // ambil TEPAT 1 foto, tidak peduli carouselPhotosPerPost - itu setting KHUSUS jalur
      // carousel (desiredType="carousel" atau heuristik lama tanpa desiredType).
      const targetPhotoCount = desiredType === "foto" ? 1 : (brand.carouselPhotosPerPost || DEFAULT_CAROUSEL_PHOTOS_AUTO);
      urlsToUse = imageOnlyUrls.slice(0, targetPhotoCount);
      // Kalau kandidat tema TERNYATA semua video (mediaType item pertama "video" tapi ada
      // foto lain di urutan bawah SUDAH kekurangan) atau malah 0 foto sama sekali di hasil
      // tema - fallback ke foto asli APA SAJA (pickAnyRealPhoto, sama pola dgn cabang
      // "tidak ada footage cocok" di bawah) drpd project gagal total krn kandidat foto
      // kosong walau bank sebenarnya py foto.
      //
      // Urutan prioritas (2026-08-11, DIPERBAIKI - permintaan Agus eksplisit "VISUAL
      // SOURCE PRIORITY": poster edukasi/tips = "1. AI generated image... 3. optional
      // real photo" - AI generate LEBIH DIUTAMAKAN drpd foto asli SEMBARANGAN yg belum
      // tentu relevan ke topik spesifik ini, BUKAN sebaliknya spt versi awal saya tadi
      // [dites langsung: generate 1 konten nyata malah pakai foto bank yg tidak relevan
      // krn pickAnyRealPhoto dicoba duluan] - brand dgn toggle aktif COBA full-AI DULU,
      // foto asli APA SAJA cuma dipakai kalau toggle MATI (perilaku LAMA, brand lain
      // tidak berubah).
      if (urlsToUse.length === 0) {
        if (brand.allowAiGeneratedPhotos) {
          useFullAiPoster = true;
        } else {
          const anyPhoto = await pickAnyRealPhoto(brandId);
          if (anyPhoto) urlsToUse = [anyPhoto];
        }
      }
    }
  } else {
    const spesifik = isIdeSpesifikProperti(script, brand.knowledgeSite);

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

    // Urutan prioritas (2026-08-11, lihat catatan lengkap di titik fallback sama di
    // atas) - AI generate DIUTAMAKAN drpd foto asli sembarangan, kalau toggle aktif DAN
    // ide ini TIDAK spesifik soal properti/layanan (mis. Day Use Pelangi - promo yg
    // mengklaim properti/layanan SPESIFIK tetap WAJIB gagal jelas drpd diam2 dapat
    // visual karangan, aturan LAMA dipertahankan penuh - lihat throw di bawah).
    if (urlsToUse.length === 0) {
      if (brand.allowAiGeneratedPhotos && !spesifik) {
        type = "carousel";
        useFullAiPoster = true;
      } else {
        const anyPhoto = await pickAnyRealPhoto(brandId);
        if (anyPhoto) {
          type = "carousel";
          urlsToUse = [anyPhoto];
        }
      }
    }

    if (urlsToUse.length === 0 && !useFullAiPoster) {
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
    contentFormat: type === "video" ? contentFormat ?? null : null,
    youtubeSeriesId: type === "video" ? youtubeSeriesId ?? null : null,
    youtubeMetadata: type === "video" ? youtubeMetadata ?? null : null,
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

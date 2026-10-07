import { db } from "@/db";
import { projects, mediaAssets, brands, socialAccounts, footageBank, contentTypes } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { transcribeFootage, transcribeAudioBuffer, type TranscriptSegment } from "@/lib/ai/transcribe";
import {
  selectClips,
  scoreSegments,
  MAX_CLIP_DURATION,
  computeFootageBudgets,
  getDurationConfig,
} from "@/lib/ai/clipSelect";
import { generateCaptionAndHashtags, generateCaptionForImages, buildCaptionSrt, buildSrtFromTranscriptSegments, type ContentAngle } from "@/lib/ai/generateContent";
import { getRecentStructureAndHookUsage, isStructureOverused, isHookTypeOverused, getRecentContentTypeUsage, isContentTypeOverused } from "@/lib/ai/contentVariety";
import { getOverusedHashtags } from "@/lib/ai/hashtagTracking";
import { generateVoiceover } from "@/lib/ai/dubbing";
// Render video LOKAL via FFmpeg (2026-08-05, permintaan Agus - "migrasi agar prosesnya
// free") - GANTI dari cloudinary.ts (makan kredit berbayar) ke ffmpeg.ts (gratis, pakai
// CPU server sendiri). Signature SAMA PERSIS, cuma ganti sumber import.
import { renderFinalVideo } from "@/lib/render/ffmpeg";
import { planEdit, pickMusicTrack } from "@/lib/ai/aiDirector";
import { detectBeats } from "@/lib/ai/beatDetect";
import { extractStatOverlays } from "@/lib/ai/statExtractor";
import { extractLowerThird } from "@/lib/ai/lowerThirdExtractor";
import { parseWeightToKg } from "@/lib/render/comparisonBar";
import { pickCtaText, type CtaContext } from "@/lib/ai/ctaEngine";
import { runVideoQualityChecks } from "@/lib/pipeline/qualityChecker";
import { imageToVideoClip } from "@/lib/render/imageToClip";
import { generatePosterCopy, type PosterCopy } from "@/lib/ai/posterCopy";
import { getBrandPerformanceInsight } from "@/lib/ai/performanceLearning";
import { applyPosterDesign, generatePosterFullAi } from "@/lib/ai/posterDesign";
import { validatePriceClaims, stripInvalidPrices } from "@/lib/ai/priceValidator";
import { extractThumbnailCandidates } from "@/lib/render/frameExtract";
import { scoreThumbnailCandidates } from "@/lib/ai/thumbnailScoring";
import { searchBrollVideo } from "@/lib/assets/broll";
import { fetchDestinationBrollClips, isDestinationContent, type DestinationBrollClip } from "@/lib/ai/destinationBroll";
import { getRecentlyUsedFootageUrls, getRemoteFileSizeBytes, MAX_FOOTAGE_BYTES } from "@/lib/ai/footageVariety";
import { angkaKeKata, adaAngkaTersisa } from "@/lib/ai/angkaKeKata";
import { applyLogoToImage } from "@/lib/ai/logoOverlay";
import { checkContentSimilarity } from "@/lib/ai/contentSimilarity";
import { analyzeRetentionRisk } from "@/lib/ai/retentionIntelligence";
import { factCheckCaption } from "@/lib/ai/factCheck";
import { isAgustapExtensionActive } from "@/lib/agustap/featureFlag";
import { checkContentClarity, type ServiceCatalog, type ClarityCheckResult } from "@/lib/agustap/contentClarity";
import { AGUSTAP_FINANCIAL_BLOCKLIST } from "@/lib/agustap/contextualFootage";
import { deriveBrollKeywordsFromScript, pickBrollKeyword } from "@/lib/ai/deriveBrollKeywords";
import { distributeChapters, type YoutubeMetadata } from "@/lib/ai/youtubeEditorial";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import { newId } from "@/lib/ids";
import { runWithUsageContext } from "@/lib/ai/usageContext";
import { tryAcquireLock, releaseLock, projectProcessLockKey, LockBusyError } from "@/lib/concurrency/locks";

export type ProcessResult = {
  caption: string;
  hashtags: string[];
  promoText?: string | null;
  photoCount?: number;
  clipCount?: number;
  structureTemplate?: string;
};

// Deteksi footage stok Pexels/Pixabay via domain URL, BUKAN kolom DB baru (2026-08-04,
// permintaan Agus - fallback "generate tetap jalan walau tidak ada footage asli", lihat
// auto-content/route.ts) - pragmatis, hindari migrasi skema utk 1 fitur ini. Footage stok
// TIDAK PUNYA ucapan asli yg relevan buat ditranskrip (beda dari footage Pelangi/Harmoni
// sendiri yg suara aslinya jadi dasar pemilihan klip) - jadi transcribeFootage+selectClips
// di-SKIP total, diganti 1 segmen sintetis yg mencakup seluruh klip (durasi asli dari
// broll.durationSeconds, disimpan ke mediaAssets.durationSeconds saat insert - lihat
// auto-content/route.ts). AI Dubbing (sudah ada) tetap jalan spt biasa & GANTI TOTAL audio
// asli klip stok dgn TTS baca caption - jadi tidak masalah klip stok tidak ada ucapan.
const STOCK_FOOTAGE_DOMAINS = ["pexels.com", "pixabay.com"];
const STOCK_FOOTAGE_MAX_DURATION = 20; // detik - jaga video tetap gaya konten pendek/reels

function isStockFootageUrl(url: string): boolean {
  return STOCK_FOOTAGE_DOMAINS.some((domain) => url.includes(domain));
}

// YouTube caption (2026-08-10, YouTube Editorial Engine) - `caption` di project ini
// dipakai LANGSUNG sbg text upload (orchestrate.ts) - format: judul di baris pertama
// (KONVENSI yg SAMA dipakai publishToYoutube native, lihat youtube.ts `caption.split
// ("\n")[0]` jadi title), baris kosong, lalu deskripsi SEO, lalu blok chapter (kalau
// ADA - diisi belakangan setelah durasi render asli diketahui, lihat distributeChapters
// di processProject.ts pemanggil). Hashtag TIDAK disisipkan di sini - orchestrate.ts
// SUDAH menambahkan hashtag di akhir caption utk SEMUA platform (lihat baseCaption di
// sana), menambahkannya di sini akan dobel.
function buildYoutubeCaption(title: string, seoDescription: string, chapters: { time: string; label: string }[]): string {
  const chapterBlock = chapters.length > 0 ? `\n\n${chapters.map((c) => `${c.time} ${c.label}`).join("\n")}` : "";
  return `${title}\n\n${seoDescription}${chapterBlock}`;
}

// Pipeline Fase 1 (lihat memory proyek) - DIPAKAI BERSAMA oleh
// POST /api/projects/[id]/process (dipicu manual dari NewProjectDialog) MAUPUN
// POST /api/brands/[id]/auto-content ("⚡ Konten Otomatis", lihat matchFootageBank.ts)
// - SATU implementasi, bukan duplikat kode. Dua jalur beda tergantung project.type:
// - "video": transkripsi -> pemilihan klip otomatis (heuristik deterministik, BUKAN
//   vision-AI) -> caption/hashtag/subtitle -> render video final (splice+subtitle via
//   Cloudinary) -> thumbnail (kalau ada YouTube) -> publish.
// - "carousel" (foto): TIDAK ada transkrip/render - foto mentah LANGSUNG jadi aset
//   final, caption dibuat dari analisis foto asli (vision model).
// Keduanya BERHENTI di status "ready" (draft) - TIDAK publish otomatis lagi
// (2026-08-04, permintaan Agus: mau bisa cek draft dulu sebelum tayang - lihat
// DraftReview.tsx). publishProject() sekarang HANYA dipanggil manual lewat tombol
// "Publikasikan" di draft review (POST /api/projects/[id]/publish).
async function processProjectInner(id: string): Promise<ProcessResult> {
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) throw new Error("Project tidak ditemukan");

  // Atribusi biaya (2026-08-12, Fase 1a) - SEMUA panggilan model di dalam try/catch di
  // bawah ini (langsung maupun via fungsi lain yang dipanggil dari sini) otomatis
  // ke-tag brandId/projectId lewat AsyncLocalStorage, lihat usageContext.ts.
  // Auto-Fix Ladder log (2026-08-12, Fase 2b) - diisi tiap kali sebuah reject-point
  // mencoba strategi degradasi sebelum benar2 gagal (lihat pemakaian dekat
  // durationConfig.min di bawah). Dideklarasikan DI LUAR try/catch (bukan di dalam try)
  // supaya catch block juga bisa baca isinya - kejadian yg SEMPAT dicoba tetap berharga
  // dicatat walau project ini akhirnya failed total (mis. langkah 1 broaden keyword
  // berhasil dicoba tapi project gagal belakangan krn sebab lain yg tidak terkait).
  const autoFixLog: { step: string; action: string; result: string }[] = [];

  return runWithUsageContext({ brandId: project.brandId, projectId: id }, async () => {
  try {
    if (!project.script) throw new Error("Project belum punya script/brief");

    const rawFootageAssets = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.projectId, id), eq(mediaAssets.type, "raw_footage")));
    // brand dipindah ke SINI (2026-08-11, sebelumnya di bawah) - dibutuhkan guard di
    // bawah SEBELUM titik lama fetch-nya.
    const [brand] = await db.select().from(brands).where(eq(brands.id, project.brandId));
    // Contextual Footage (2026-09-02, PRD Agustap Studio) - blocklist finansial dipakai
    // SEMUA titik searchBrollVideo di bawah utk brand ini. Default-block (bukan panggil
    // deriveAgustapBrollQuery lagi di tiap titik - satu LLM call ekstra sudah terjadi di
    // generateCaptionAndHashtags/autoContent.ts, di sini cukup terapkan blocklist-nya
    // saja) - simplifikasi sadar: skrip Agustap yang genuinely soal trading sangat
    // jarang, default aman lebih penting drpd deteksi presisi di tiap titik B-roll.
    const agustapFootageBlock = isAgustapExtensionActive(brand?.knowledgeSite) ? AGUSTAP_FINANCIAL_BLOCKLIST : [];
    // project.type === "carousel" DAN brand.allowAiGeneratedPhotos DIKECUALIKAN
    // (2026-08-11, bug nyata ditemukan lewat tes generate langsung - "Belum ada footage
    // mentah" walau ini SENGAJA dibuat 0-asset oleh autoContent.ts sbg sinyal full
    // AI-generate poster, lihat allowAiGeneratedPhotos di schema.ts & catatan lengkap
    // di cabang carousel di bawah). SENGAJA dicek allowAiGeneratedPhotos DI SINI JUGA
    // (bukan cuma percaya "type carousel = pasti sengaja") - brand TANPA toggle ini yg
    // kebetulan 0 asset (edge case pre-existing lain, bukan dari fitur ini) TETAP kena
    // guard spt sebelumnya, drpd lolos lalu crash lebih membingungkan di
    // applyPosterDesign (imageUrl undefined).
    // (2026-10-02) 0 footage LEGIT utk carousel apa pun (jalur full-AI poster handle
    // photoUrls=0 via generatePosterFullAi) - dulu cek brand.allowAiGeneratedPhotos, tapi
    // forceVisual="ai" (per-generate) bisa paksa AI walau flag brand false. Hanya VIDEO
    // yang wajib punya footage mentah. autoContent sudah throw lebih dulu kalau carousel
    // genuinely tak ada foto & bukan jalur AI, jadi carousel yg sampai sini pasti disengaja.
    if (rawFootageAssets.length === 0 && project.type !== "carousel") {
      throw new Error("Belum ada footage mentah utk project ini");
    }
    // jalur video BISA >1 file sekaligus (2026-08-05, permintaan Agus - "dominasi footage
    // Pelangi" perlu digabung dari beberapa klip, 1 file asli sering terlalu pendek
    // sendirian) - lihat pooling multi-source di bawah. rawFootage (tunggal) tetap dipakai
    // sbg representatif utk thumbnail & cek stok-atau-tidak.
    const [rawFootage] = rawFootageAssets;
    // YT Shorts (2026-08-10, permintaan Agus) - project dari bucket dailyYoutubeShorts
    // Count SELALU dipaksa <=60dtk & portrait, TIDAK PEDULI videoOrientation/
    // videoDurationTarget brand (brand itu bisa saja disetel landscape 5 menit utk video
    // biasa - Shorts butuh format sendiri, lihat catatan schema.ts projects.contentFormat).
    const isYoutubeShorts = project.contentFormat === "youtube_shorts";
    // Durasi target video (2026-08-05, permintaan Agus - "video 30 detik 60 detik dan
    // 1.30") - setting per-brand, dipakai SEMUA budget/klip di bawah (video-only, tidak
    // relevan utk cabang carousel/foto di atas).
    const durationConfig = getDurationConfig(isYoutubeShorts ? 60 : brand?.videoDurationTarget);

    if (project.type === "carousel") {
      const photoUrls = rawFootageAssets.map((a) => a.fileUrl);
      // Content Clarity (2026-09-02, PRD "Agustap Studio Content Clarity") - jalur
      // carousel/poster TIDAK PUNYA regen loop struktur/hook sama sekali sebelumnya
      // (beda dari jalur video di bawah) - ini KHUSUS carousel poster kena skenario
      // negative-example PRD (paket promosi tanpa penjelasan layanan). Dicek SEBELUM
      // generatePosterCopy/applyPosterDesign (fal.ai berbayar) supaya caption yg gagal
      // clarity tidak sempat menghasilkan gambar poster yg dibuang. Max 2 percobaan,
      // pola SAMA dgn jalur video (bounded, bukan retry tak terbatas).
      const clarityActive = isAgustapExtensionActive(brand?.knowledgeSite);
      let agustapServiceCatalogCarousel: ServiceCatalog | null = null;
      if (clarityActive && brand?.serviceCatalog) {
        try {
          agustapServiceCatalogCarousel = JSON.parse(brand.serviceCatalog) as ServiceCatalog;
        } catch {
          agustapServiceCatalogCarousel = null;
        }
      }
      let carouselAttempt = 0;
      let generatedImages: Awaited<ReturnType<typeof generateCaptionForImages>>;
      do {
        generatedImages = await generateCaptionForImages(
          brand?.name || "Brand",
          project.script,
          photoUrls,
          brand?.knowledgeSite,
          brand?.manualKnowledge,
          brand?.contentPillars,
          project.brandId,
          brand
        );
        carouselAttempt += 1;
        if (!clarityActive || !generatedImages.contentType) break;
        const [ct] = await db.select().from(contentTypes).where(eq(contentTypes.name, generatedImages.contentType));
        try {
          const clarity = await checkContentClarity(
            { caption: generatedImages.caption, promotionalIntensity: ct?.promotionalIntensity ?? 0 },
            agustapServiceCatalogCarousel
          );
          if (clarity.passed || carouselAttempt >= 2) break;
          console.warn(`[processProject] carousel clarity FAIL (${clarity.failureReason || "-"}) (percobaan ${carouselAttempt}/2), regenerate...`);
        } catch (err) {
          console.error("[processProject] gagal cek content clarity (carousel), lanjut tanpa cek (fail-open):", err);
          break;
        }
      } while (true);
      // eslint-disable-next-line prefer-const
      let { caption, hashtags, promoText, pillar, angle, hookType, contentType, targetKeyword, keywordLevel, knowledgeUsed, visualDirection, ctaText } = generatedImages;
      // Price Source of Truth (2026-08-11, permintaan Agus - lihat priceValidator.ts) -
      // caption/promoText dibersihkan dari klaim harga yg TIDAK cocok persis dgn
      // knowledgeUsed (knowledge base RESMI brand ini, gabungan manualKnowledge + fetch
      // otomatis PMS Pelangi/Harmoni kalau relevan - lebih lengkap drpd manualKnowledge
      // mentah). promoText field KHUSUS harga/promo - kalau isinya sendiri invalid,
      // dikosongkan total (bukan di-strip parsial, tidak ada isinya lagi kalau harganya
      // dibuang), caption tetap teks lain-lain jalan normal cuma nominalnya hilang.
      caption = stripInvalidPrices(caption, knowledgeUsed);
      if (promoText && !validatePriceClaims(promoText, knowledgeUsed).valid) {
        promoText = null;
      }

      // Foto TUNGGAL & COVER carousel SAMA-SAMA pakai "Pelangi Homestay Poster Design
      // System v1" (2026-08-05, master prompt lengkap dari Agus; 2026-08-06 disatukan ke
      // carousel jg atas permintaan Agus - "aku mau prom untuk pister foto di terapkan
      // juga di curasel sehingga selaras") - poster penuh (headline/CTA/badge/benefit dgn
      // gaya brand konsisten), BUKAN cuma badge kecil 1 pojok. Cakupan SENGAJA dibatasi ke
      // foto PERTAMA saja (bukan semua foto carousel) - dikonfirmasi eksplisit ke Agus:
      // tiap foto yg didesain = 1 panggilan fal.ai baru, mendesain SEMUA foto carousel
      // akan mengalikan biaya per-carousel sejumlah foto-nya (mis. 5x) DAN berisiko
      // headline/CTA yg sama berulang tiap slide terlihat spam - Agus pilih "cover saja"
      // (biaya ~sama spt applyPromoOverlay lama yg cuma sentuh foto pertama). Foto ke-2
      // dst TETAP foto asli apa adanya (fal.ai TIDAK disentuh sama sekali, nol biaya
      // tambahan) - promoOverlay.ts (badge kecil) sudah TIDAK dipakai lagi di jalur ini,
      // digantikan penuh oleh poster (yg juga bisa tampilkan harga lewat field `harga`
      // di PosterCopy kalau skrip menyebutnya).
      // knowledgeUsed (bukan brand?.manualKnowledge mentah) - lebih LENGKAP, sudah
      // gabung manualKnowledge + fetch otomatis PMS Pelangi/Harmoni (lihat catatan
      // stripInvalidPrices di atas) - poster Pelangi/Harmoni jg divalidasi thd harga
      // REAL-TIME PMS, bukan cuma teks manual yg bisa basi.
      // (2026-10-05, temuan Agus) Poster Feed (desiredType foto, ditandai contentFormat
      // di autoContent) = SELALU 1 gambar, abaikan carouselPhotosPerPost. Tanpa ini foto
      // ikut jadi multi-slide krn type tersimpan "carousel".
      const isPosterFeed = project.contentFormat === "poster_feed";
      const carouselN = isPosterFeed ? 1 : Math.max(1, Math.min(brand?.carouselPhotosPerPost ?? 1, 5));
      // (2026-10-02, temuan Agus) Multi-slide carousel KEDUA mode isi teks tiap slide:
      // 1 sampul (hook) + 1 slide per poin konten. Dulu footage asli cuma cover yg berteks,
      // slide 2+ foto polos. Sekarang footage asli jg tempel 1 poin ke tiap foto
      // (applyPosterDesign, foto diulang kalau kurang); full-AI tetap generatePosterFullAi.
      // forceSlides minta copy TEPAT carouselN-1 poin (gabung/ringkas, bukan potong).
      const wantMultiSlide = carouselN > 1;
      // (2026-10-07, #5) Insight performa nyata (pilar mana paling banyak views) disuntik
      // ke prompt poster-copy supaya generasi condong ke yg terbukti perform, bukan generik.
      const perfInsight = await getBrandPerformanceInsight(project.brandId);
      const posterCopy = await generatePosterCopy(brand?.name || "Brand", project.script, knowledgeUsed, pillar, wantMultiSlide ? carouselN : undefined, perfInsight);
      const posterAspect = brand?.videoOrientation === "landscape" ? "16:9" : "4:5";
      const isAiCarousel = photoUrls.length === 0;

      // renderSlide: footage asli -> tempel copy ke foto bank (applyPosterDesign); full-AI
      // -> poster text-to-image penuh. aspectRatio dihormati keduanya (uji: 16:9=1376x768).
      const renderSlide = (copy: PosterCopy, photoIdx: number) =>
        isAiCarousel
          ? generatePosterFullAi({
              brandId: project.brandId,
              projectId: id,
              copy,
              brandProfile: brand?.posterBrandProfile,
              aspectRatio: posterAspect,
              allowLogoInContent: brand?.allowLogoInAiContent,
            })
          : applyPosterDesign({
              brandId: project.brandId,
              projectId: id,
              imageUrl: photoUrls[photoIdx % photoUrls.length],
              copy,
              brandProfile: brand?.posterBrandProfile,
              aspectRatio: posterAspect,
              allowLogoInContent: brand?.allowLogoInAiContent,
            });

      let finalImageUrls: string[];
      if (wantMultiSlide) {
        // sampul = hook (headline+subheadline, tanpa poin); slide berikut = 1 poin/slide.
        // ponytail: model balikin < carouselN-1 poin -> slide ikut lebih sedikit (fail-soft).
        const points = posterCopy.infografisPoints ?? [];
        const slideCopies: PosterCopy[] = [
          { ...posterCopy, infografisPoints: null, benefits: [] },
          ...points.slice(0, carouselN - 1).map((p) => ({
            headline: posterCopy.headline,
            subheadline: null,
            harga: null,
            cta: posterCopy.cta,
            benefits: [] as string[],
            isiTulisan: null,
            infografisPoints: [{ nomor: p.nomor, teks: p.teks }],
          })),
        ];
        finalImageUrls = await Promise.all(slideCopies.map((c, idx) => renderSlide(c, idx)));
      } else {
        finalImageUrls = [await renderSlide(posterCopy, 0)];
      }

      // Logo brand OPSIONAL (2026-08-05, permintaan Agus) - lingkaran, proporsional,
      // ditempel di SETIAP foto final (poster tunggal MAUPUN carousel) - dilewati
      // begitu saja kalau brand belum punya logoUrl.
      //
      // Per-foto try/catch (2026-08-06, bug nyata ditemukan lewat tes live) - ditemukan
      // 5 file JPEG di Footage Bank Pelangi yg SECARA STRUKTURAL rusak ("VipsJpeg: Invalid
      // SOS parameters for sequential JPEG" - lolos baca metadata, tapi crash pas
      // sharp benar2 decode+composite+encode ulang). SEBELUM ini 1 foto rusak di tengah
      // batch carousel bikin SELURUH project gagal (Promise.all melempar begitu salah
      // satu gagal) - sekarang kegagalan logo overlay utk 1 foto SPESIFIK di-skip (pakai
      // foto TANPA logo utk foto itu saja), bukan gagalkan seluruh batch - foto lain yg
      // sehat tetap dapat logo normal.
      const brandedImageUrls = brand?.logoUrl
        ? await Promise.all(
            finalImageUrls.map(async (url, i) => {
              try {
                const buffer = await applyLogoToImage(url, brand.logoUrl!);
                const key = buildAssetKey(project.brandId, id, `logo_${i}.png`);
                return await uploadBuffer(key, buffer, "image/png");
              } catch (err) {
                console.error(`[processProject] gagal tempel logo di foto ${i} (${url}), pakai foto asli tanpa logo:`, err);
                return url;
              }
            })
          )
        : finalImageUrls;

      // Duplicate/Repetition Detector (2026-08-08, PRD Section 9-10) - lihat catatan
      // lengkap di schema.ts & contentSimilarity.ts. Gagal embed (mis. API down sesaat)
      // TIDAK BOLEH menggagalkan project - skor/embedding tetap null, project lanjut
      // normal, cuma kehilangan visibilitas similarity utk project ini saja.
      let similarity: { embedding: number[]; similarityScore: number; similarToProjectId: string | null } | null = null;
      try {
        similarity = await checkContentSimilarity(project.brandId, caption, id);
      } catch (err) {
        console.error("[processProject] gagal hitung content similarity, dilewati:", err);
      }

      // Fact Check Engine (2026-08-08, PRD Section 12) - lihat factCheck.ts. Gagal
      // (API error) TIDAK BOLEH menggagalkan project, sama filosofi dgn similarity di atas.
      let factCheck: { confidence: number; unsupportedClaims: string[] } | null = null;
      try {
        factCheck = await factCheckCaption(caption, knowledgeUsed);
      } catch (err) {
        console.error("[processProject] gagal fact-check caption, dilewati:", err);
      }

      // Status TETAP "processing" di sini (BUKAN "ready" lagi, 2026-08-10 - bug nyata
      // ditemukan: cron/auto-publish men-scan status="ready" tiap 10-15 menit, kalau
      // status di-flip DI SINI [sebelum final_image benar2 ke-insert di bawah] ada
      // jendela balapan singkat di mana cron bisa nemu project ini "ready" tapi asetnya
      // belum ada, langsung ditandai "failed" (lihat orchestrate.ts pesan "Belum ada
      // aset final") walau generate-nya sendiri SUKSES - status baru di-flip ke "ready"
      // SETELAH loop insert final_image di bawah selesai.
      await db
        .update(projects)
        .set({
          generatedCaption: caption,
          generatedHashtags: JSON.stringify(hashtags),
          pillar,
          angle,
          hookType,
          contentTypeId: contentType,
          targetKeyword,
          keywordLevel,
          visualDirection,
          ctaText,
          captionEmbedding: similarity ? JSON.stringify(similarity.embedding) : null,
          similarityScore: similarity?.similarityScore ?? null,
          similarToProjectId: similarity?.similarToProjectId ?? null,
          factCheckConfidence: factCheck?.confidence ?? null,
          factCheckFlags: factCheck && factCheck.unsupportedClaims.length > 0 ? JSON.stringify(factCheck.unsupportedClaims) : null,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id));

      // Foto tunggal SELALU tetap poster foto (2026-08-05, permintaan Agus - single
      // post harus pakai foto asli apa adanya + overlay teks promo kalau ada, BUKAN
      // diubah jadi video) - sama persis carousel multi-foto di bawah, tidak ada lagi
      // percabangan khusus foto tunggal. Efek zoom-ke-video (applyZoomToImage) yang
      // dulu otomatis jalan di sini sudah DIHAPUS dari alur ini per keputusan Agus ini
      // (supersede keputusan sebelumnya "bangun untuk foto saja" - Ken Burns zoom).
      for (const url of brandedImageUrls) {
        await db.insert(mediaAssets).values({
          id: newId("asset"),
          projectId: id,
          type: "final_image",
          fileUrl: url,
          durationSeconds: null,
          createdAt: new Date(),
        });
      }

      await db.update(projects).set({ status: "ready", updatedAt: new Date() }).where(eq(projects.id, id));

      return { caption, hashtags, promoText, photoCount: brandedImageUrls.length };
    }

    const isStockFootage = rawFootageAssets.every((a) => isStockFootageUrl(a.fileUrl));

    type SourcedSegment = Awaited<ReturnType<typeof selectClips>>[number] & { sourceUrl: string };
    let segments: Awaited<ReturnType<typeof transcribeFootage>>;
    let selected: SourcedSegment[];
    let selectedText: string;
    // Pool transkrip LENGKAP (semua segmen, bukan cuma yg terpilih) - diisi di cabang
    // non-stok, dipakai lagi belakangan utk top-up minimum durasi (lihat durationConfig.min
    // di bawah) kalau seleksi awal masih kurang.
    const pooled: (Awaited<ReturnType<typeof transcribeFootage>>[number] & { sourceUrl: string })[] = [];

    if (isStockFootage) {
      const cappedDuration = Math.min(rawFootage.durationSeconds || 8, STOCK_FOOTAGE_MAX_DURATION);
      segments = [];
      selected = [
        {
          start: 0,
          end: cappedDuration,
          text: "",
          avgLogprob: 0,
          keywordScore: 0,
          clarityScore: 0,
          durationScore: 0,
          combinedScore: 0,
          sourceUrl: rawFootage.fileUrl,
        },
      ];
      // Tidak ada transkrip asli - caption/hashtag digenerate dari SKRIP/IDE saja (masih
      // cukup, krn ini jalur ide UMUM yg tidak butuh detail spesifik properti).
      selectedText = "";
    } else {
      // Skip footage yg kelewat panjang/besar SEBELUM transkripsi (lihat catatan
      // MAX_FOOTAGE_BYTES di atas) - cek size via HEAD dulu (murah, tidak perlu download
      // penuh), JANGAN coba-coba transkripsi lalu gagal di tengah pipeline (bug nyata yg
      // ditemukan sblm larangan ini ada).
      const sizeChecked = await Promise.all(
        rawFootageAssets.map(async (asset) => ({ asset, size: await getRemoteFileSizeBytes(asset.fileUrl) }))
      );
      const oversized = sizeChecked.filter((s) => s.size !== null && s.size > MAX_FOOTAGE_BYTES);
      const usableAssets = sizeChecked
        .filter((s) => s.size === null || s.size <= MAX_FOOTAGE_BYTES)
        .map((s) => s.asset);
      if (oversized.length > 0) {
        console.warn(
          `[processProject] skip footage terlalu panjang/besar (>24MB), TIDAK dipakai: ${oversized
            .map((s) => `${s.asset.fileUrl} (${Math.round((s.size || 0) / 1024 / 1024)}MB)`)
            .join(", ")}`
        );
      }
      if (usableAssets.length === 0) {
        throw new Error(
          "Semua footage yg diupload terlalu panjang/besar (>24MB) - potong dulu jadi beberapa klip pendek (beberapa detik tiap klip), jangan upload 1 video panjang."
        );
      }

      // Kumpulkan footage dari SEMUA file asli sekaligus (2026-08-05, permintaan Agus -
      // "1 video didominasi footage Pelangi", rasio 7:3 - 1 file asli sendirian sering
      // terlalu pendek [ada yg cuma ~4 detik] utk isi 70% dari target 30-60 detik).
      // Transkrip tiap file terpisah, tandai asal file-nya (sourceUrl) supaya
      // renderFinalVideo tahu tiap klip terpilih harus dipotong dari file MANA.
      segments = [];
      for (const asset of usableAssets) {
        // try/catch per-file (2026-08-06, bug nyata ditemukan lewat tes live brand baru
        // "laundry in bali" - footage-nya video WhatsApp asli/casual, beda dari footage
        // Pelangi yg lebih terkontrol) - SEBELUM ini 1 file dgn audio yg gagal didekode
        // Whisper (video bisu/audio korup, umum di video WhatsApp yg diteruskan berkali-
        // kali) GAGALKAN SELURUH project, walau file LAIN di batch yg sama baik-baik saja.
        // Fallback ke segments kosong utk file ini SAJA - `topUps` (di bawah) & selectClips
        // SUDAH menangani sourceUrl dgn 0 segment dgn aman (skip top-up utk file itu,
        // bukan crash) - sama filosofi gagal-lunak dgn skip file oversized di atas.
        let t: TranscriptSegment[] = [];
        try {
          t = await transcribeFootage(asset.fileUrl);
        } catch (err) {
          console.warn(`[processProject] gagal transkrip ${asset.fileUrl} (audio tidak terbaca/tidak ada) - dilewati, file lain tetap lanjut:`, err);
        }
        segments = segments.concat(t);
        pooled.push(...t.map((s) => ({ ...s, sourceUrl: asset.fileUrl })));
      }
      // Rasio asli:Pexels TERGANTUNG jenis konten (2026-08-05, permintaan Agus - "jika
      // konten wisata dekat pelangi homestay pakai footage pexels 60% footage pelangi
      // 40%", KEBALIKAN dari rasio default 7:3 utk video promosi properti biasa - lihat
      // computeFootageBudgets di clipSelect.ts).
      const footageBudgets = computeFootageBudgets(isDestinationContent(project.script), durationConfig.target, brand?.footageSource ?? "mixed");
      const budgeted = selectClips(pooled, project.script, footageBudgets.realBudgetSeconds);
      // Pastikan SEMUA file yg Agus sediakan ikut terwakili (2026-08-05, bug nyata
      // ditemukan lewat tes live - selectClips cuma fallback ke 1 klip TERBAIK dari
      // SELURUH pool kalau tidak ada yg lolos ambang skor, bukan per-file - 4 klip asli
      // disediakan tapi cuma 1 yg kepakai krn footage lain tanpa narasi jelas semuanya
      // kalah skor dari yg 1 itu). Video yg "didominasi footage Pelangi" (permintaan
      // Agus) HARUS menyertakan tiap file yg disediakan, bukan cuma yg skornya
      // kebetulan tertinggi - top-up klip terbaik PER FILE yg belum terwakili di hasil
      // selectClips.
      const representedSources = new Set(budgeted.map((s) => s.sourceUrl));
      const missingSources = usableAssets.filter((a) => !representedSources.has(a.fileUrl));
      const topUps = missingSources
        .map((asset) => {
          const ownSegments = pooled.filter((s) => s.sourceUrl === asset.fileUrl);
          if (ownSegments.length === 0) return null;
          const best = scoreSegments(ownSegments, project.script!).sort(
            (a, b) => b.combinedScore - a.combinedScore
          )[0];
          return { ...best, end: Math.min(best.end, best.start + MAX_CLIP_DURATION) };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);
      const withTopUps = [...budgeted, ...topUps];
      // Struktur Hook -> Fasilitas (2026-08-05, permintaan Agus - "hook, peak, fasilitas,
      // cta"): klip skor TERTINGGI ditaruh PALING DEPAN sbg hook (paling "menjual" di 2-5
      // detik pertama, krusial utk retensi penonton short-form), sisanya diurutkan per
      // sumber file (bukan skor) supaya alur tiap klip dari file yg sama tetap kronologis
      // wajar, bukan loncat-loncat. Klip Pexels (destinationBroll, di bawah) jadi "peak" -
      // ditempel SETELAH bagian fasilitas ini, lihat renderFinalVideo (brollClips selalu
      // di akhir urutan).
      const [hook, ...restByScore] = [...withTopUps].sort((a, b) => b.combinedScore - a.combinedScore);
      const rest = restByScore.sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl) || a.start - b.start);
      selected = hook ? [hook, ...rest] : rest;
      selectedText = selected.map((s) => s.text).join(" ");
    }
    // YouTube Editorial Engine (2026-08-10) - project.youtubeMetadata SUDAH BERISI
    // judul/deskripsi SEO/hashtag/tag LENGKAP (dibuat youtubeEditorial.ts sebelum
    // project ini ada, lihat dailyContentPlanner.ts) - SKIP generateCaptionAndHashtags
    // sepenuhnya utk project ini (fungsi itu MENULIS ULANG skrip jadi "caption" gaya
    // Pelangi/hospitality, akan MERUSAK judul/SEO yang sudah dirancang khusus kalau
    // dipanggil di sini) - bangun `caption` LANGSUNG dari youtubeMetadata, brollKeywords
    // dari deriveBrollKeywordsFromScript (fungsi yg SAMA dipakai autoContent.ts utk
    // brand tanpa knowledge base) krn channel YouTube TIDAK PUNYA knowledge base brand
    // (fakta konten dokumenter itu pengetahuan umum, bukan data properti).
    const youtubeMeta: YoutubeMetadata | null = project.youtubeMetadata ? JSON.parse(project.youtubeMetadata) : null;

    let caption: string, hashtags: string[], brollKeywords: string[] | null, thumbnailText: string | null,
      structureTemplate: string, pillar: string | null, angle: ContentAngle | null,
      hookType: string | null, contentType: string | null, targetKeyword: string | null, keywordLevel: number | null, knowledgeUsed: string,
      visualDirection: string | null, ctaText: string | null, hookText: string | null,
      finalStructureOverused: boolean, finalHookTypeOverused: boolean;

    if (youtubeMeta) {
      const title = youtubeMeta.titles[youtubeMeta.selectedTitleIndex] || youtubeMeta.titles[0] || project.script.slice(0, 80);
      caption = buildYoutubeCaption(title, youtubeMeta.seoDescription, []);
      hashtags = youtubeMeta.hashtags;
      brollKeywords = await deriveBrollKeywordsFromScript(project.script);
      thumbnailText = youtubeMeta.thumbnailConcepts[0]?.text || null;
      structureTemplate = youtubeMeta.parentVideoTitle ? "YoutubeShort-Repurposed" : project.contentFormat === "youtube_shorts" ? "YoutubeShort" : "YoutubeDocumentary";
      // (2026-08-12, Fase 1b - bug nyata ditemukan: projects.pillar SELALU null utk
      // SEMUA project YouTube Editorial [27/27 project Animal Story & Co dicek langsung
      // ke DB], krn baris ini dulu HARDCODE null tanpa syarat, MENIMPA nilai yg sudah
      // benar diisi autoContent.ts saat insert dari daily_ideas.pillar [lihat
      // pickNextCategory/pickNextTopic di youtubeEditorial.ts, yg SUDAH memilih kategori
      // tapi dulu tidak pernah disimpan sampai ke sini]. Akibatnya performanceLearning.ts
      // yg group-by projects.pillar TIDAK PERNAH bisa hasilkan insight utk brand ini apa
      // pun data analytics yg terkumpul - kunci grouping-nya permanen null. Fix: PAKAI
      // nilai yg sudah di-insert (project.pillar), jangan timpa dgn null lagi.
      pillar = project.pillar;
      angle = null;
      // hookType null (2026-08-14) - konten YouTube Editorial py penamaan struktur
      // sendiri yg fixed/non-AI-classified (bukan dari VIDEO_STRUCTURE_TEMPLATES pool),
      // sama alasan angle/targetKeyword di bawah juga null di cabang ini.
      hookType = null;
      contentType = null;
      targetKeyword = null;
      keywordLevel = null;
      knowledgeUsed = "";
      // Content Brief (2026-08-26, PRD §12, Task Plan 6) - jalur YouTube Editorial tidak
      // panggil generateCaptionAndHashtags (caption dirakit manual dari youtubeMeta di
      // atas), jadi field ini tidak ada sumbernya di jalur ini - null, konsisten dgn
      // angle/hookType/dst lain di cabang ini.
      visualDirection = null;
      ctaText = null;
      hookText = null;
      finalStructureOverused = false;
      finalHookTypeOverused = false;
  } else {
    // Regenerasi terbatas (2026-08-14, PRD "AI Content Intelligence" Fase 1 - TIER 2) - kalau
    // struktur/hook/contentType yg dipilih TERBUKTI masih overused stlh generate, coba SEKALI
    // lagi dgn instruksi eksplisit menghindari itu. Maks 2 percobaan TOTAL (bukan
    // retry tak terbatas) - brand dgn pillar/topik yg genuinely sempit akan WAJAR
    // mengulang struktur kadang, memaksa retry tanpa batas cuma membakar biaya OpenAI
    // tanpa jaminan hasil beda (pool struktur terbatas, 5-7 opsi saja).
    const MAX_REGEN_ATTEMPTS = 2;
    const usageForRegenCheck = await getRecentStructureAndHookUsage(project.brandId);
    const contentTypeUsageForRegenCheck = await getRecentContentTypeUsage(project.brandId);
    // Content Clarity (2026-09-02, PRD "Agustap Studio Content Clarity") - REUSE loop
    // regen ini apa adanya (bukan bikin retry mechanism kedua), guard brand di sini
    // sendiri (bukan cuma di caller) krn ini titik masuk baru - brand lain 0% query
    // tambahan (agustapServiceCatalog tetap null, isClarityRelevant selalu false).
    const clarityActive = isAgustapExtensionActive(brand?.knowledgeSite);
    let agustapServiceCatalog: ServiceCatalog | null = null;
    if (clarityActive && brand?.serviceCatalog) {
      try {
        agustapServiceCatalog = JSON.parse(brand.serviceCatalog) as ServiceCatalog;
      } catch {
        agustapServiceCatalog = null;
      }
    }
    let avoidStructureNames: string[] = [];
    let avoidHookTypes: string[] = [];
    let avoidContentTypes: string[] = [];
    let avoidCaptionStyles: string[] = [];
    const avoidHashtags: string[] = project.brandId ? await getOverusedHashtags(project.brandId) : [];
    let attempt = 0;
    let generated: Awaited<ReturnType<typeof generateCaptionAndHashtags>>;
    let lastClarityResult: ClarityCheckResult | null = null;
    do {
      generated = await generateCaptionAndHashtags(
        brand?.name || "Brand",
        project.script,
        selectedText,
        brand?.knowledgeSite,
        brand?.manualKnowledge,
        durationConfig.target,
        brand?.contentPillars,
        project.brandId,
        avoidStructureNames,
        avoidHookTypes,
        avoidContentTypes,
        avoidHashtags,
        avoidCaptionStyles,
        brand
      );
      attempt += 1;
      let clarityFailed = false;
      if (clarityActive && generated.contentType) {
        const [ct] = await db.select().from(contentTypes).where(eq(contentTypes.name, generated.contentType));
        try {
          lastClarityResult = await checkContentClarity(
            { caption: generated.caption, promotionalIntensity: ct?.promotionalIntensity ?? 0 },
            agustapServiceCatalog
          );
          clarityFailed = !lastClarityResult.passed;
        } catch (err) {
          console.error("[processProject] gagal cek content clarity, lanjut tanpa cek (fail-open):", err);
        }
      }
      const overused =
        isStructureOverused(generated.structureTemplate, usageForRegenCheck) ||
        isHookTypeOverused(generated.hookType, usageForRegenCheck) ||
        (generated.contentType && isContentTypeOverused(generated.contentType, contentTypeUsageForRegenCheck)) ||
        clarityFailed;
      if (!overused || attempt >= MAX_REGEN_ATTEMPTS) break;
      console.warn(
        `[processProject] struktur "${generated.structureTemplate}" / hook "${generated.hookType}" / content type "${generated.contentType}" ` +
        `masih overused ATAU clarity FAIL (${lastClarityResult?.failureReason || "-"}) (percobaan ${attempt}/${MAX_REGEN_ATTEMPTS}), regenerate...`
      );
      avoidStructureNames = [...avoidStructureNames, generated.structureTemplate];
      if (generated.hookType) avoidHookTypes = [...avoidHookTypes, generated.hookType];
      if (generated.contentType) avoidContentTypes = [...avoidContentTypes, generated.contentType];
      if (generated.captionStyle) avoidCaptionStyles = [...avoidCaptionStyles, generated.captionStyle];

    } while (true);
    ({ caption, hashtags, brollKeywords, thumbnailText, structureTemplate, pillar, angle, hookType, contentType, targetKeyword, keywordLevel, knowledgeUsed, visualDirection, ctaText, hookText } = generated);
    // Retention Intelligence (2026-08-26, PRD §14, Task Plan 7) - recompute thd hasil AKHIR
    // (generated) SETELAH loop regen selesai - `overused` di dalam loop di atas scoped ke
    // tiap percobaan, bukan hasil final (kalau MAX_REGEN_ATTEMPTS habis, hasil akhir bisa
    // saja MASIH overused - itu justru info yg relevan utk retensi, bukan disembunyikan).
    finalStructureOverused = isStructureOverused(structureTemplate, usageForRegenCheck);
    finalHookTypeOverused = isHookTypeOverused(hookType, usageForRegenCheck);
    }
    // Price Source of Truth (2026-08-11, permintaan Agus - lihat priceValidator.ts &
    // catatan sama di jalur carousel di atas) - caption (jadi naskah voiceover, lihat
    // generateVoiceover di bawah) & thumbnailText dibersihkan dari klaim harga yg tidak
    // cocok persis dgn knowledgeUsed. Jalur youtubeMeta (knowledgeUsed="") otomatis
    // "tidak ada sumber resmi" - aman krn konten YouTube Editorial (Animal Story & Co dkk)
    // tidak pernah membahas harga Rupiah sama sekali (dokumenter Bahasa Inggris).
    caption = stripInvalidPrices(caption, knowledgeUsed);
    if (thumbnailText && !validatePriceClaims(thumbnailText, knowledgeUsed).valid) {
      thumbnailText = null;
    }

    // Kombinasi footage asli + Pexels (2026-08-05, permintaan Agus - "jika ada
    // pembahasan wisata seperti danau beratan kebun raya bedugul dan lainnya gunakan
    // pexels, jika menyangkut pelangi gunakan footage asli pelangi", rasio 7:3). Cuma
    // relevan kalau dasarnya footage ASLI (bukan footage stok - video "ide umum" tanpa
    // footage asli, lihat isStockFootage di atas, sudah 100% Pexels dari awal, tidak ada
    // yg perlu dikombinasi). Tiap landmark yg disebut skrip dapat klip Pexels sendiri,
    // ditempel sbg "peak"/highlight SETELAH bagian fasilitas footage asli (lihat
    // renderFinalVideo - brollClips selalu di akhir urutan splice).
    // Anti-monoton (2026-08-05, permintaan Agus - "footage pexels jangan monoton,
    // TikTok anggap konten berulang, ini penting sekali") - kumpulkan url footage asli
    // MAUPUN klip Pexels/Pixabay yg BARU dipakai brand ini (5 project video terakhir,
    // lihat footageVariety.ts), diteruskan ke pencarian B-roll di bawah supaya klip yg
    // sama tidak kepilih lagi persis di video berikutnya.
    const recentlyUsedUrls = await getRecentlyUsedFootageUrls(project.brandId);

    // Metadata lisensi (2026-08-08, PRD "YouTube Content & Monetization Safety System"
    // Section 16) - `source*` fields opsional krn footage foto-brand-sendiri
    // (imageToVideoClip di bawah) TIDAK PERNAH punya sumber Pexels/Pixabay, tetap
    // undefined utk klip itu (BENAR, bukan lisensi tidak diketahui - itu footage asli
    // milik brand sendiri, tidak perlu jejak lisensi pihak ketiga).
    let brollClips: DestinationBrollClip[] = [];
    // footageSource "internal" (2026-08-21, permintaan Agus - Harmoni Hills) - lewati
    // SEMUA pencarian Pexels/Pixabay, 100% footage bank brand sendiri.
    const internalOnly = (brand?.footageSource ?? "mixed") === "internal";
    if (!isStockFootage && !internalOnly) {
      const stockBudget = computeFootageBudgets(isDestinationContent(project.script), durationConfig.target).stockBudgetSeconds;
      brollClips = await fetchDestinationBrollClips(project.script, stockBudget, recentlyUsedUrls);
    }
    if (brollClips.length === 0 && brollKeywords && brollKeywords.length > 0 && !internalOnly) {
      // Fallback lama - skrip tidak menyebut landmark spesifik apa pun, tetap kasih 1
      // klip suasana umum spt sebelumnya (mis. "tropical homestay garden").
      const kw = pickBrollKeyword(brollKeywords, 0);
      const broll = await searchBrollVideo(kw, recentlyUsedUrls, undefined, agustapFootageBlock);
      if (broll) {
        brollClips = [{
          videoUrl: broll.videoUrl,
          durationSeconds: Math.min(broll.durationSeconds, 5),
          source: broll.source,
          sourceCreator: broll.creator,
          sourceUrl: broll.sourceUrl,
          sourceQuery: kw,
        }];
      }
    }

    // Variety via foto brand SENDIRI (2026-08-07, permintaan Agus - "footage jangan
    // monoton untuk semua brand... silahkan gunakan footage foto sebagai video tidak
    // apa namun tambahkan efek seperti zoom in zoom out pan" - laporan nyata: video
    // Pelangi kelihatan pakai footage yang sama terus). Root cause NYATA: bank video
    // brand manapun jauh lebih kecil drpd bank foto (mis. Pelangi 24 video vs 44 foto
    // saat ditemukan) - anti-monoton yg SUDAH ADA (recentlyUsedUrls, window 5 project
    // video terakhir) tetap kelihatan berulang kalau SATU-SATUNYA sumber cuma pool
    // video kecil itu. Sisipkan sampai 2 klip dari FOTO yang belum dipakai baru-baru
    // ini (anti-monoton SAMA, extend ke tipe foto), diubah jadi klip pendek via efek
    // zoom/pan (imageToClip.ts, variasi otomatis per foto - bukan cuma zoom-in-center
    // spt versi lama yang TIDAK PERNAH benar-benar disambungkan ke pipeline manapun).
    // MEMPERLUAS pool sumber visual (24+44), bukan menggantikan mekanisme yang sudah ada.
    if (!isStockFootage) {
      const bankPhotos = await db
        .select({ fileUrl: footageBank.fileUrl })
        .from(footageBank)
        .where(and(eq(footageBank.brandId, project.brandId), eq(footageBank.mediaType, "image")));
      const freshPhotos = bankPhotos.filter((p) => !recentlyUsedUrls.has(p.fileUrl));
      for (const photo of freshPhotos.slice(0, 2)) {
        try {
          const clip = await imageToVideoClip(photo.fileUrl, project.brandId);
          brollClips.push(clip);
          // Catat foto ASLI-nya (bukan URL klip mp4 hasil generate) sbg "dipakai" -
          // supaya anti-monoton (getRecentlyUsedFootageUrls) juga berlaku ke foto ini
          // di project berikutnya, sama perlakuan dgn raw_footage/broll_used lain.
          await db.insert(mediaAssets).values({
            id: newId("asset"),
            projectId: id,
            type: "broll_used",
            fileUrl: photo.fileUrl,
            durationSeconds: clip.durationSeconds,
            createdAt: new Date(),
          });
        } catch (err) {
          console.warn(`[processProject] gagal ubah foto ${photo.fileUrl} jadi klip zoom/pan, dilewati:`, err);
        }
      }
    }

    // Aturan KERAS (2026-08-05, permintaan Agus - "aturan konten video tidak boleh
    // kurang dari 40 detik" [saat target masih tetap 45s - sekarang skala proporsional
    // ikut durationConfig.min, lihat clipSelect.ts]) - BEDA dari durationConfig.target
    // (itu cuma titik tengah rencana budget SEBELUM tau durasi klip sungguhan - klip asli
    // sering lebih pendek dari nominal MAX_CLIP_DURATION, bug durasi berulang sebelumnya
    // justru dari sini). Top-up di SINI pakai durasi SUNGGUHAN (bukan estimasi), prioritas:
    // (1) footage ASLI dulu (selaras "video didominasi footage Pelangi"), (2) B-roll
    // generik kalau footage asli sudah habis, (3) GAGAL dgn pesan jelas kalau tetap kurang
    // - drpd diam2 kirim video di bawah standar yg diwajibkan.
    const currentTotalDuration = () =>
      selected.reduce((sum, seg) => sum + (seg.end - seg.start), 0) +
      brollClips.reduce((sum, c) => sum + c.durationSeconds, 0);
    // Margin aman (2026-08-05, ditemukan lewat tes nyata - durasi NOMINAL klip Pexels
    // [field "duration" dari API] kadang tidak sama persis dgn durasi FILE video kualitas
    // tertentu yg sungguhan diserve, jadi total durasi hasil RENDER akhir bisa sedikit di
    // bawah estimasi pre-render walau perhitungan nominal sudah pas di angka minimum).
    // Top-up di sini kejar target LEBIH TINGGI dari minimum sungguhan supaya varian kecil
    // itu tidak bikin hasil akhir jatuh di bawah minimum - pengecekan akhir (setelah
    // render, lihat rendered.durationSeconds di bawah) tetap pakai angka minimum ASLI.
    // Margin PROPORSIONAL (2026-08-14, bug nyata ditemukan pas migrasi Animal Story &
    // Co - long-form 46 klip, target min=240dtk, hasil render SUNGGUHAN cuma 223dtk
    // [meleset 20dtk] lalu ke-reject di gerbang post-render, padahal estimasi pre-render
    // sudah lolos +3dtk lama). Akar masalah: +3dtk FLAT tidak ikut skala jumlah klip -
    // drift nominal-vs-file-sungguhan (lihat catatan lengkap di dekat pemakaian di
    // bawah) terjadi PER KLIP, long-form butuh puluhan klip utk capai target vs
    // short-form cuma beberapa, jadi drift TOTAL long-form jauh lebih besar tapi
    // sebelumnya dikasih jaring pengaman SAMA persis.
    //
    // ITERASI KE-2 (2026-08-14, sama hari) - 8% (target 259dtk) TERNYATA masih kurang:
    // render nyata ke-2 hasilnya 236dtk (meleset tipis, 4dtk). 2 titik data nyata
    // (target 243->aktual 223 [drift 20dtk]; target 259->aktual 236 [drift 24dtk])
    // nunjukkin drift TIDAK terlalu proporsional ke besar target - lebih dekat ke
    // KONSTAN utk skala klip yg sama (~44-46 klip long-form ini), jadi menaikkan target
    // sedikit tidak banyak mengurangi drift absolut. Naikkan ke 15% (lantai tetap 3dtk,
    // short-form/Shorts tidak berubah) - target 240dtk jadi 276dtk, ksh ~12dtk buffer di
    // atas drift terburuk yg pernah diamati (24dtk). BELUM tervalidasi ulang dgn render
    // nyata ke-3 - kalau masih kurang, pertimbangkan pendekatan beda sama sekali
    // (mis. margin berdasar ESTIMASI jumlah klip, bukan persentase durasi target).
    const PRE_RENDER_TARGET_SECONDS = durationConfig.min + Math.max(3, Math.ceil(durationConfig.min * 0.15));

    if (!isStockFootage && currentTotalDuration() < PRE_RENDER_TARGET_SECONDS) {
      // Tarik segmen ASLI TAMBAHAN dari pool lengkap (bukan cuma yg lolos budget/ambang
      // skor awal) - urut skor tertinggi dulu, sama logikanya dgn fallback selectClips.
      const usedKeys = new Set(selected.map((s) => `${s.sourceUrl}|${s.start}`));
      const remainingScored = scoreSegments(
        pooled.filter((s) => !usedKeys.has(`${s.sourceUrl}|${s.start}`)),
        project.script
      ).sort((a, b) => b.combinedScore - a.combinedScore);
      for (const seg of remainingScored) {
        if (currentTotalDuration() >= PRE_RENDER_TARGET_SECONDS) break;
        const cappedEnd = Math.min(seg.end, seg.start + MAX_CLIP_DURATION);
        selected.push({ ...seg, end: cappedEnd });
      }
    }

    if (currentTotalDuration() < PRE_RENDER_TARGET_SECONDS && brollKeywords && brollKeywords.length > 0 && !internalOnly) {
      // Footage asli sudah habis (atau ini jalur 100% stok) - top-up pakai B-roll
      // GENERIK tambahan (bukan destinasi spesifik - itu sengaja dibatasi 1 klip per
      // landmark, lihat destinationBroll.ts). Exclude set terus bertambah tiap iterasi
      // supaya klip TIDAK berulang dlm video yg sama (anti-monoton berlaku jg di sini).
      //
      // Batas percobaan DISKALAKAN ke besar gap yg perlu diisi (2026-08-06, permintaan
      // Agus - opsi durasi 3/5/8 menit utk YT) - SEBELUM ini angka tetap 8 (cukup utk
      // target lama 30-90dtk, gap biasanya kecil), TIDAK CUKUP kalau real footage Pelangi
      // (cuma ~3,5 menit total di seluruh bank saat ini) jauh di bawah target long-form -
      // gap bisa berapa menit, butuh puluhan klip B-roll utk diisi. +10 margin (klip
      // stok sering < MAX_CLIP_DURATION nominal, lihat catatan durasi NOMINAL vs FILE
      // sungguhan di atas) - tetap berhenti wajar kalau searchBrollVideo kehabisan hasil
      // baru (return null, `if (!broll) break`), bukan infinite loop.
      const usedBrollUrls = new Set([...recentlyUsedUrls, ...brollClips.map((c) => c.videoUrl)]);
      const gapSeconds = Math.max(0, PRE_RENDER_TARGET_SECONDS - currentTotalDuration());
      const maxAttempts = Math.ceil(gapSeconds / MAX_CLIP_DURATION) + 10;
      let attempts = 0;
      while (currentTotalDuration() < PRE_RENDER_TARGET_SECONDS && attempts < maxAttempts) {
        // pickBrollKeyword (2026-09-07, laporan Agus "footage jangan monoton") - GANTI
        // teratur antar variant keyword tiap iterasi, bukan query yg sama berulang -
        // lihat catatan lengkap di deriveBrollKeywords.ts.
        const kw = pickBrollKeyword(brollKeywords, attempts);
        attempts += 1;
        const broll = await searchBrollVideo(kw, usedBrollUrls, undefined, agustapFootageBlock);
        if (!broll) break;
        usedBrollUrls.add(broll.videoUrl);
        brollClips.push({
          videoUrl: broll.videoUrl,
          durationSeconds: Math.min(broll.durationSeconds, MAX_CLIP_DURATION),
          source: broll.source,
          sourceCreator: broll.creator,
          sourceUrl: broll.sourceUrl,
          sourceQuery: kw,
        });
      }
    }

    // internalOnly (2026-08-21, permintaan Agus - "gunakan foto + vidio untuk buat
    // kontenya jadi lebih variatif ... sampai aku tambahkan footagenya") - brand dgn
    // footageSource="internal" tidak punya B-roll eksternal utk top-up (semua loop
    // Pexels/Pixabay di atas di-guard), jadi gap durasi diisi dari FOTO bank brand
    // sendiri (klip zoom/pan via imageToVideoClip, sama mekanisme dgn blok 2-foto di
    // atas tapi TANPA cap 2) sampai target tercapai ATAU foto segar habis. Foto yg
    // sudah diubah di project ini (blok 2-foto) dideteksi drp mediaAssets broll_used
    // supaya tidak diproses dobel. Sifat SEMENTARA smpai bank video Harmoni cukup -
    // ponytail: kalau bank video sudah besar, blok ini bisa dibuang tanpa efek samping.
    if (internalOnly && currentTotalDuration() < PRE_RENDER_TARGET_SECONDS) {
      const photosUsedThisProject = new Set(
        (
          await db
            .select({ fileUrl: mediaAssets.fileUrl })
            .from(mediaAssets)
            .where(and(eq(mediaAssets.projectId, id), eq(mediaAssets.type, "broll_used")))
        ).map((a) => a.fileUrl)
      );
      const bankPhotos = await db
        .select({ fileUrl: footageBank.fileUrl })
        .from(footageBank)
        .where(and(eq(footageBank.brandId, project.brandId), eq(footageBank.mediaType, "image")));
      const freshPhotos = bankPhotos.filter(
        (p) => !recentlyUsedUrls.has(p.fileUrl) && !photosUsedThisProject.has(p.fileUrl)
      );
      for (const photo of freshPhotos) {
        if (currentTotalDuration() >= PRE_RENDER_TARGET_SECONDS) break;
        try {
          const clip = await imageToVideoClip(photo.fileUrl, project.brandId);
          brollClips.push(clip);
          await db.insert(mediaAssets).values({
            id: newId("asset"),
            projectId: id,
            type: "broll_used",
            fileUrl: photo.fileUrl,
            durationSeconds: clip.durationSeconds,
            createdAt: new Date(),
          });
        } catch (err) {
          console.warn(`[processProject] gagal ubah foto ${photo.fileUrl} jadi klip zoom/pan (internalOnly), dilewati:`, err);
        }
      }
    }

    // Auto-Fix Ladder (2026-08-12, Fase 2b PRD Animal Story & Co section 9/10/21/22/42)
    // - SEBELUM ini durasi kurang = reject LANGSUNG di sini, walau top-up di atas cuma
    // gagal krn 1 query B-roll SEMPIT (mis. nama spesies jarang) kehabisan hasil di
    // Pexels/Pixabay - bukan berarti genuinely "footage tidak tersedia" (searchPexelsVideo
    // sendiri SUDAH toleran soal pengulangan klip, lihat catatan di pexels.ts - gap
    // sebenarnya ada di KEYWORD-nya, bukan exclusion). effectiveMinDuration dipakai GANTI
    // durationConfig.min utk SISA fungsi ini (cek post-render + quality checker) supaya
    // keputusan "terima durasi lebih pendek" konsisten di semua gerbang, bukan cuma di sini.
    let effectiveMinDuration = durationConfig.min;

    // Langkah 1: broaden keyword B-roll & ulang top-up SEKALI (hanya kalau ini benar2
    // jalur B-roll - brollKeywords null utk cabang lain yg tidak relevan).
    if (currentTotalDuration() < effectiveMinDuration && brollKeywords && brollKeywords.length > 0 && !internalOnly) {
      const semula = brollKeywords.join(" / ");
      autoFixLog.push({
        step: "footage_insufficient",
        action: `broaden keyword B-roll (semula: "${semula}", ~${Math.round(currentTotalDuration())}dtk dari ${effectiveMinDuration}dtk)`,
        result: "mencoba",
      });
      try {
        const broaderKeywords = await deriveBrollKeywordsFromScript(project.script, true);
        const usedBrollUrls2 = new Set([...recentlyUsedUrls, ...brollClips.map((c) => c.videoUrl)]);
        const gapSeconds2 = Math.max(0, PRE_RENDER_TARGET_SECONDS - currentTotalDuration());
        const maxAttempts2 = Math.ceil(gapSeconds2 / MAX_CLIP_DURATION) + 10;
        let attempts2 = 0;
        while (currentTotalDuration() < PRE_RENDER_TARGET_SECONDS && attempts2 < maxAttempts2) {
          const kw = pickBrollKeyword(broaderKeywords, attempts2);
          attempts2 += 1;
          const broll = await searchBrollVideo(kw, usedBrollUrls2, undefined, agustapFootageBlock);
          if (!broll) break;
          usedBrollUrls2.add(broll.videoUrl);
          brollClips.push({
            videoUrl: broll.videoUrl,
            durationSeconds: Math.min(broll.durationSeconds, MAX_CLIP_DURATION),
            source: broll.source,
            sourceCreator: broll.creator,
            sourceUrl: broll.sourceUrl,
            sourceQuery: kw,
          });
        }
        autoFixLog[autoFixLog.length - 1].result =
          currentTotalDuration() >= effectiveMinDuration
            ? `berhasil (keyword baru: "${broaderKeywords.join(" / ")}", ~${Math.round(currentTotalDuration())}dtk)`
            : `masih kurang (~${Math.round(currentTotalDuration())}dtk)`;
      } catch (err) {
        autoFixLog[autoFixLog.length - 1].result = `gagal dicoba: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // Langkah 2: MASIH kurang setelah broaden - kalau sudah CUKUP DEKAT (>=85% target
    // minimum ASLI), terima durasi lebih pendek drpd reject (PRD section 25: "graceful
    // degradation drpd hard stop"). Di bawah 85% dianggap genuinely "footage tidak
    // tersedia" (salah satu alasan reject SAH yg PRD sendiri sebutkan) - JANGAN diterima
    // asal-asalan (video 2 menit yg harusnya 8 menit bukan degradasi wajar, itu video
    // lain).
    const GRACEFUL_DEGRADE_RATIO = 0.85;
    if (currentTotalDuration() < effectiveMinDuration) {
      const ratio = currentTotalDuration() / durationConfig.min;
      if (ratio >= GRACEFUL_DEGRADE_RATIO) {
        autoFixLog.push({
          step: "footage_insufficient",
          action: `terima durasi lebih pendek drpd reject (~${Math.round(currentTotalDuration())}dtk = ${Math.round(ratio * 100)}% dari target minimum ${durationConfig.min}dtk)`,
          result: "diterima",
        });
        effectiveMinDuration = Math.floor(currentTotalDuration());
      } else {
        throw new Error(
          `Footage/B-roll yg tersedia tidak cukup utk capai minimum ${durationConfig.min} detik ` +
            `(cuma dapat ~${Math.round(currentTotalDuration())} detik, ${Math.round(ratio * 100)}% dari target - sudah dicoba broaden keyword B-roll) ` +
            `- upload lebih banyak footage asli, atau coba ide/skrip lain.`
        );
      }
    }

    // Subtitle PRESISI (2026-08-06, permintaan Agus - "perbaiki subtitle agar presisi
    // dengan dubing sehingga penonton tidak bingung") - SEBELUM ini SRT dibangun dari
    // buildCaptionSrt() (bagi caption 8 kata/blok, sebar RATA sepanjang durasi FOOTAGE)
    // SEBELUM audio TTS-nya bahkan digenerate - dijamin drift krn durasi bicara TTS
    // asli (pacing alami, jeda kalimat) HAMPIR PASTI beda dari estimasi rata itu, makin
    // parah utk caption panjang (video 3-8 menit). Sekarang: generate TTS DULU di sini
    // (bukan di dalam renderFinalVideo lagi), transkripsi ULANG audio itu (Whisper,
    // sama endpoint dgn transcribeFootage) utk dapat timestamp ASLI dari audio yg
    // BENERAN diputar, baru bangun SRT dari situ - presisi krn sumbernya audio asli,
    // bukan estimasi. Fallback ke cara lama HANYA kalau Whisper gagal (mis. API down
    // sesaat) - subtitle kurang presisi tetap lebih baik drpd video gagal total.
    // narrationText (2026-08-10, bug nyata ditemukan - verifikasi langsung ke file
    // video: silencedetect nunjukkan 163 detik SUNYI dari total 243 detik). Akar
    // masalah: `caption` utk cabang youtube-editorial SENGAJA dibangun dari
    // youtubeMetadata (judul+deskripsi SEO, lihat komentar di atas dekat `if
    // (youtubeMeta)`) - BUKAN skrip dokumenter, supaya SEO/judul yg sudah dirancang
    // khusus tidak "diperbaiki ulang" jadi caption gaya Pelangi. Tapi
    // generateVoiceover(caption) di bawah ini TERTINGGAL dari desain lama (Pelangi/
    // Laundry, dari SEBELUM YouTube Editorial ada) yg asumsi `caption` == narasi -
    // akibatnya voiceover Animal Story & Co membacakan deskripsi SEO pendek (~80dtk)
    // bukan skrip dokumenter asli (project.script, ratusan detik), sisa durasi video
    // (dari target footage) jadi SUNYI TOTAL. Utk cabang generic (Pelangi/Laundry)
    // `caption` TETAP dipakai apa adanya (desain lama itu sudah benar & terverifikasi
    // - caption di sana MEMANG ditulis dari project.script sbg prosa natural yg cocok
    // dibacakan, lihat generateCaptionAndHashtags).
    const narrationText = youtubeMeta ? project.script! : caption;
    const totalDuration = currentTotalDuration();
    const voiceoverBuffer = await generateVoiceover(narrationText);
    let srt: string;
    // wordTimings (2026-08-10, Subtitle Designer) - dari transkripsi yg SAMA (1
    // panggilan Whisper, tidak ada biaya tambahan) - dipakai renderFinalVideo utk
    // caption "kata per kata" gaya TikTok/YT Shorts. Kosong = fallback ke srt statis
    // di bawah (ffmpeg.ts otomatis pakai jalur non-animasi kalau ini kosong).
    let wordTimings: Awaited<ReturnType<typeof transcribeAudioBuffer>>["words"] = [];
    try {
      const transcription = await transcribeAudioBuffer(voiceoverBuffer);
      srt = buildSrtFromTranscriptSegments(transcription.segments);
      wordTimings = transcription.words;
    } catch (err) {
      console.error("[processProject] gagal transkripsi ulang audio TTS utk subtitle presisi, fallback ke estimasi rata:", err);
      srt = buildCaptionSrt(narrationText, totalDuration);
    }

    // Duplicate/Repetition Detector (2026-08-08, PRD Section 9-10) - sama pola dgn
    // cabang carousel di atas, lihat catatan lengkap di sana & contentSimilarity.ts.
    let similarity: { embedding: number[]; similarityScore: number; similarToProjectId: string | null } | null = null;
    try {
      similarity = await checkContentSimilarity(project.brandId, caption, id);
    } catch (err) {
      console.error("[processProject] gagal hitung content similarity, dilewati:", err);
    }

    // Fact Check Engine (2026-08-08, PRD Section 12) - sama pola dgn cabang carousel di
    // atas, lihat catatan lengkap di sana & factCheck.ts.
    let factCheck: { confidence: number; unsupportedClaims: string[] } | null = null;
    try {
      factCheck = await factCheckCaption(caption, knowledgeUsed);
    } catch (err) {
      console.error("[processProject] gagal fact-check caption, dilewati:", err);
    }

    // Retention Intelligence (2026-08-26, PRD §14, Task Plan 7) - durationConfig.target
    // (BUKAN rendered.durationSeconds - render belum terjadi di titik ini) dipakai krn itu
    // JUGA basis targetWords/lengthInstruction saat caption ditulis (generateContent.ts),
    // konsisten dgn asumsi yg sama. null utk jalur youtubeMeta (hookText null di sana).
    const retentionRisks = hookText
      ? analyzeRetentionRisk({
          hookText,
          totalDurationSeconds: durationConfig.target,
          hookType,
          structureOverused: finalStructureOverused,
          hookTypeOverused: finalHookTypeOverused,
          similarityScore: similarity?.similarityScore ?? null,
        })
      : null;

    // Status TETAP "processing" di sini (BUKAN "ready" lagi, 2026-08-10 - bug nyata:
    // renderFinalVideo() di bawah bisa makan waktu MENIT [footage panjang/looping], dan
    // cron/auto-publish men-scan status="ready" tiap 10-15 menit. Kalau status di-flip
    // DI SINI, ada jendela balapan senyata itu di mana cron bisa nemu project "ready"
    // tapi final_video BELUM ke-insert [masih di tengah render], langsung ditandai
    // "failed" [orchestrate.ts, "Belum ada aset final"] walau generate-nya SUKSES -
    // insiden nyata: proj_Nq9-4_f9QoAI, render final_video selesai 15 menit SETELAH
    // status ini sempat "ready" duluan. Status baru di-flip ke "ready" SETELAH
    // final_video benar2 ke-insert di bawah (lihat dekat akhir fungsi ini).
    await db
      .update(projects)
      .set({
        transcript: JSON.stringify(segments),
        clipSelection: JSON.stringify(selected),
        generatedCaption: caption,
        generatedHashtags: JSON.stringify(hashtags),
        pillar,
        angle,
        hookType,
        contentTypeId: contentType,
        structureTemplate,
        targetKeyword,
        keywordLevel,
        visualDirection,
        ctaText,
        retentionRisks: retentionRisks && retentionRisks.length > 0 ? JSON.stringify(retentionRisks) : null,
        captionEmbedding: similarity ? JSON.stringify(similarity.embedding) : null,
        similarityScore: similarity?.similarityScore ?? null,
        similarToProjectId: similarity?.similarToProjectId ?? null,
        factCheckConfidence: factCheck?.confidence ?? null,
        factCheckFlags: factCheck && factCheck.unsupportedClaims.length > 0 ? JSON.stringify(factCheck.unsupportedClaims) : null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    await db.insert(mediaAssets).values({
      id: newId("asset"),
      projectId: id,
      type: "subtitle_file",
      fileUrl: `data:text/plain;base64,${Buffer.from(srt).toString("base64")}`,
      durationSeconds: null,
      createdAt: new Date(),
    });

    // AI Director (2026-08-10, PRD "AI Content Editing Engine", modul prioritas #1
    // pilihan Agus) - GPT baca narrationText (SAMA teks yg jadi voiceover di atas,
    // bukan panggilan terpisah/beda konteks), tentukan motion/transisi per klip
    // berdasar ARC narasi (tenang->membangun->klimaks->penutup), bukan round-robin
    // acak (fallback lama, TETAP jadi fallback kalau panggilan GPT ini gagal - lihat
    // aiDirector.ts). Gagal TIDAK BOLEH menggagalkan render (peningkatan kualitas,
    // bukan syarat wajib) - planEdit sendiri sudah try/catch internal & balik fallback.
    const clipCount = selected.length + brollClips.length;
    const directorDecision = await planEdit(narrationText, clipCount, project.brandId, brand?.stylePreset);
    const musicUrl = await pickMusicTrack(project.brandId, directorDecision.musicMood).catch((err) => {
      console.error("[processProject] gagal ambil track Music Bank, lanjut tanpa musik:", err);
      return null;
    });
    // Music Beat Sync (2026-08-10, PRD Roadmap V3) - deteksi beat SEKALI di sini
    // (bukan di ffmpeg.ts) krn musicUrl baru diketahui di titik ini, & biar sejalan dgn
    // pola motions/transitions/musicUrl lain yg semua dihitung di processProject.ts
    // lalu diteruskan apa adanya ke renderFinalVideo. Gagal deteksi (audio corrupt/
    // format aneh) TIDAK BOLEH gagalkan render - render lanjut TANPA beat sync (video
    // tetap py musik, cuma cut/sticker tidak "on-beat"), bukan menahan seluruh video.
    const musicBeats = musicUrl
      ? await detectBeats(musicUrl, 180).catch((err) => {
          console.error("[processProject] gagal deteksi beat musik, lanjut tanpa beat sync:", err);
          return { beatTimestamps: [] as number[], firstBeatSeconds: null };
        })
      : { beatTimestamps: [] as number[], firstBeatSeconds: null };
    // CTA dinamis (2026-08-10, lihat ctaEngine.ts) - konteks dari sinyal yg SUDAH ada
    // (youtubeMeta/isYoutubeShorts, dihitung di atas), bukan field baru.
    const ctaContext: CtaContext = youtubeMeta ? (isYoutubeShorts ? "youtube_shorts" : "youtube_longform") : "generic";
    // Graphic Overlay - Stat Card (2026-08-10, preset editing Animal Story & Co - lihat
    // statExtractor.ts) - HANYA jalan kalau preset ini benar2 minta grading/motion
    // subtle (documentary) - "energetic"/"minimal" TIDAK diberi stat card (belum
    // diminta utk preset itu, proporsional - jangan tambah elemen visual ke brand yg
    // tidak minta). positionFraction (0-1 dari GPT) dipetakan ke clipIndex SAMA
    // teknik proporsional dgn energyLevels di aiDirector.ts.
    const rawStats = brand?.stylePreset === "documentary" ? await extractStatOverlays(narrationText) : [];
    const statOverlays = rawStats.map((s) => ({
      label: s.label,
      value: s.value,
      clipIndex: Math.min(clipCount - 1, Math.max(0, Math.floor(s.positionFraction * clipCount))),
      iconCategory: s.iconCategory,
    }));
    // Lower Third (2026-08-10, "Overlay System PRD" Category A) - SAMA gating dgn stat
    // card (cuma preset "documentary"), panggilan GPT terpisah kecil (nama+tagline
    // subjek, bukan angka - beda tujuan dari statExtractor).
    const lowerThird = brand?.stylePreset === "documentary" ? await extractLowerThird(narrationText) : null;
    // Comparison Bar (2026-08-10) - REUSE stat "weight" yg SUDAH diekstrak di atas
    // (nol panggilan GPT tambahan) - HANYA jalan kalau nilainya bisa di-parse ke
    // satuan berat dikenal (lihat comparisonBar.ts kenapa TIDAK ditampilkan kalau
    // parsing gagal, drpd bar salah skala).
    const weightStat = statOverlays.find((s) => s.iconCategory === "weight");
    const weightKg = weightStat ? parseWeightToKg(weightStat.value) : null;
    const comparisonBar = weightStat && weightKg !== null
      ? { label: weightStat.label, value: weightStat.value, kg: weightKg, clipIndex: weightStat.clipIndex }
      : null;

    // renderWithSubtitles (2026-08-12, Fase 2c) - dijadikan closure (semula 1 pemanggilan
    // inline) supaya BISA dipanggil ulang dgn srtContent/wordTimings BEDA tanpa duplikasi
    // ~40 baris param - dipakai retry subtitle-only di bawah (lihat Quality Checker).
    // Semua param LAIN (klip, motion, transisi, musik, overlay) TETAP sama persis antar
    // panggilan - retry ini murni soal subtitle, bukan pilih ulang footage/durasi (itu
    // ranah Fase 2b, sudah selesai di atas sblm render pertama ini).
    const renderWithSubtitles = (srtForRender: string, wordTimingsForRender: typeof wordTimings) => {
      // PRD v1.1 §5 Final QC Checklist (2026-08-22) — jaring pengaman TERAKHIR sebelum render.
      // Semua cek wajib PASS agar render diizinkan. Gagal = throw Error + log ke autoFixLog.
      const qcErrors: string[] = [];
      // [ ] Voiceover tidak memiliki angka numerik
      const narrationTts = angkaKeKata(narrationText);
      if (/\d/.test(narrationTts)) qcErrors.push("Voiceover mengandung angka numerik (larangan PRD v1.1 §1)");
      // [ ] Tidak ada duplicate Pexels footage
      const pexelsIds = brollClips.map((c) => c.pexelsVideoId).filter((v): v is string => !!v);
      if (new Set(pexelsIds).size !== pexelsIds.length) qcErrors.push("Duplicate Pexels video ID terdeteksi (PRD v1.1 §3)");
      // [ ] Setiap scene memiliki footage (selected.length > 0)
      if (selected.length === 0) qcErrors.push("Tidak ada scene footage terpilih");
      // [ ] Footage relevan dengan narasi (heuristik: minimal 1 brollClip per project yg butuh B-roll)
      if (!isStockFootage && brollClips.length === 0 && !internalOnly) {
        qcErrors.push("Tidak ada B-roll footage meskipun project butuh stock footage");
      }
      // [ ] Visual cukup bervariasi (heuristik: minimal 2 klip unik jika > 30 detik)
      const uniqueClips = new Set(brollClips.map((c) => c.videoUrl)).size;
      if (durationConfig.target > 30 && uniqueClips < 2) qcErrors.push("Visual terlalu monoton (klip unik < 2)");

      if (qcErrors.length > 0) {
        const errMsg = `Final QC GAGAL: ${qcErrors.join("; ")}`;
        autoFixLog.push({ step: "final_qc", action: "Final QC Checklist", result: errMsg });
        throw new Error(errMsg);
      }

      return renderFinalVideo({
        projectId: id,
        brandId: project.brandId,
        segments: selected,
        srtContent: srtForRender,
        wordTimings: wordTimingsForRender,
        brollClips,
        // AI Dubbing - GANTI TOTAL suara asli (lihat memory proyek, keputusan eksplisit
        // Agus). Audio-nya SUDAH digenerate di atas (perlu ada LEBIH DULU drpd subtitle
        // presisi dibangun) - di sini tinggal diteruskan, bukan generate baru lagi.
        voiceoverAudioBuffer: voiceoverBuffer,
        motions: directorDecision.motions,
        transitions: directorDecision.transitions,
        musicUrl,
        musicBeatTimestamps: musicBeats.beatTimestamps,
        stickerClipIndex: directorDecision.stickerClipIndex,
        motionIntensity: directorDecision.motionIntensity,
        colorGrade: directorDecision.colorGrade,
        statOverlays,
        lowerThird,
        comparisonBar,
        // Logo brand OPSIONAL (2026-08-05, permintaan Agus) - lihat catatan lengkap di
        // cabang carousel di atas, sama alasannya.
        logoUrl: brand?.logoUrl,
        // Orientasi (2026-08-05, permintaan Agus - "landscape atau potrait ini utk
        // kebutuhan YT") - setting per-brand, default "portrait" kalau belum di-set.
        // YT Shorts (2026-08-10) SELALU portrait, override setting brand - lihat
        // isYoutubeShorts di atas.
        orientation: isYoutubeShorts ? "portrait" : brand?.videoOrientation,
        // Batas keras 60dtk (2026-08-10, permintaan Agus - "jangan buat short diatas 1
        // menit ini aturannya") - jaring pengaman TERAKHIR di render (bukan gantikan
        // durationConfig.target=60 di atas yg cuma target lunak saat pemilihan klip).
        maxDurationSeconds: isYoutubeShorts ? 60 : undefined,
        // Overlay Engine (2026-08-10, PRD "AI Content Editing Engine") - progress bar
        // ikut Style Preset (2026-08-10, DIREVISI dari hardcode true - lihat
        // stylePreset.ts, preset documentary/minimal mematikannya). CTA dinamis per
        // konteks platform (2026-08-10 - lihat ctaEngine.ts kenapa TETAP bukan
        // GPT-generated per-video, cuma rotasi deterministik dari pool kecil sesuai
        // konvensi platform: Subscribe utk YouTube, Follow utk Reels/TikTok/Shorts
        // non-YouTube).
        showProgressBar: directorDecision.showProgressBar,
        ctaText: pickCtaText(id, ctaContext),
      });
    };
    let rendered = await renderWithSubtitles(srt, wordTimings);

    // Jaring pengaman TERAKHIR (2026-08-05) - cek durasi SUNGGUHAN hasil render (ffprobe,
    // bukan estimasi pre-render) tetap >= minimum wajib. Ditemukan lewat tes nyata: durasi
    // NOMINAL klip Pexels kadang beda dari durasi FILE sungguhan yg diserve, jadi estimasi
    // pre-render (sudah dikasih margin, lihat PRE_RENDER_TARGET_SECONDS di atas) bisa
    // meleset. Render yg SUDAH JADI tapi ternyata di bawah standar tetap DIBUANG (bukan
    // dipublikasikan diam2 melanggar aturan "tidak boleh kurang dari 40 detik") - biaya
    // render yg terbuang lebih baik drpd konten yg melanggar aturan keras yg diminta Agus.
    // effectiveMinDuration (2026-08-12, Fase 2b) - BUKAN durationConfig.min lagi kalau
    // Auto-Fix Ladder di atas sudah menerima durasi lebih pendek drpd reject (lihat
    // catatan lengkap dekat definisinya) - keputusan degradasi HARUS konsisten sampai
    // ke gerbang post-render ini, bukan cuma di cek pre-render lalu tetap ke-reject di
    // sini dgn angka minimum ASLI yg sudah sengaja dilonggarkan.
    //
    // Toleransi 120dtk (2026-08-14, keputusan bisnis Agus langsung) - SEBELUM ini gerbang
    // ZERO tolerance (meleset walau 1dtk = reject total, buang biaya render PENUH -
    // insiden nyata: video long-form 47 menit render, meleset cuma 4dtk dari minimum
    // 240dtk, dibuang semua). Narasi/skrip TETAP utuh & akurat walau footage sedikit lebih
    // pendek dari target (drift nominal-vs-file, bukan narasi terpotong) - Agus eksplisit
    // OK durasi kurang SAMPAI 120dtk drpd terus2an reject render yg sebenarnya sudah
    // pantas dipakai. Di atas 120dtk kurang dianggap genuinely bermasalah (bukan cuma
    // drift wajar) - tetap reject spt sebelumnya.
    const POST_RENDER_DURATION_TOLERANCE_SECONDS = 120;
    if (rendered.durationSeconds < effectiveMinDuration - POST_RENDER_DURATION_TOLERANCE_SECONDS) {
      throw new Error(
        `Video hasil render cuma ${rendered.durationSeconds} detik, di bawah minimum ` +
          `${effectiveMinDuration} detik (toleransi ${POST_RENDER_DURATION_TOLERANCE_SECONDS}dtk) yg diwajibkan - ` +
          `durasi nyata sumber footage beda dari metadata - coba generate ulang.`
      );
    }

    // Quality Checker (2026-08-10, PRD "AI Content Editing Engine" - dibangun LANGSUNG
    // stlh insiden nyata: 3 video lama dgn narasi rusak [163dtk sunyi] sempat ke-publish
    // otomatis krn TIDAK ADA pemeriksaan yg menahannya sblm status "ready". Cek di sini
    // JADI GERBANG WAJIB - gagal cek -> "failed" (BUKAN "ready"), tidak pernah tampil
    // sbg draft yg terlihat siap padahal cacat, apalagi ke-auto-publish.
    // Fase 2c (2026-08-12) - DIPINDAH ke sini (semula di akhir, SETELAH chapter/thumbnail/
    // broll-tracking) supaya retry di bawah TIDAK perlu mengulang kerja itu 2x, dan biar
    // gagal-cepat sblm biaya thumbnail extraction terbuang percuma di video yg akan
    // ditolak. SEKALIGUS ditambah retry utk issue subtitle (SRT kosong/baris kepanjangan):
    // catatan jujur - subtitle di-BAKAR ke video (lihat ffmpeg.ts "Bakar subtitle"), BUKAN
    // track terpisah, jadi retry ini TETAP render ulang (bukan literally "tanpa render
    // ulang" seperti asumsi awal di rencana) - tapi tetap jauh lebih murah dari retry
    // footage/durasi (Fase 2b, TIDAK diulang di sini): nol panggilan API berbayar baru
    // KECUALI 1x Whisper transkripsi ulang (audio yg SUDAH ada), semua input render lain
    // (klip, motion, transisi, musik, overlay) dipakai ULANG apa adanya lewat
    // renderWithSubtitles(). Issue silence/durasi/black-frame yg PARAH (bukan borderline -
    // lihat SILENCE_WARN_MAX_SECONDS dkk di qualityChecker.ts) TIDAK diretry di sini
    // (butuh footage BEDA, bukan cuma subtitle - reselect footage stlh render selesai
    // butuh restrukturisasi pipeline lebih besar, belum aman dilakukan di pass ini) -
    // tetap hard_reject, selaras daftar alasan reject SAH milik PRD sendiri sendiri
    // ("render/audio total failure").
    let qualityCheck = await runVideoQualityChecks(rendered.videoUrl, rendered.durationSeconds, effectiveMinDuration, srt);
    if (!qualityCheck.passed) {
      const hardRejectIssues = qualityCheck.structured.filter((i) => i.fixability === "hard_reject");
      const subtitleIssues = qualityCheck.structured.filter((i) => i.fixability === "retry_subtitle_only");

      if (hardRejectIssues.length === 0 && subtitleIssues.length > 0) {
        autoFixLog.push({
          step: "subtitle_quality",
          action: `transkripsi ulang audio + render ulang subtitle (issue: ${subtitleIssues.map((i) => i.code).join(", ")})`,
          result: "mencoba",
        });
        try {
          const retryTranscription = await transcribeAudioBuffer(voiceoverBuffer);
          const retrySrt = buildSrtFromTranscriptSegments(retryTranscription.segments);
          const retryRendered = await renderWithSubtitles(retrySrt, retryTranscription.words);
          const retryCheck = await runVideoQualityChecks(
            retryRendered.videoUrl,
            retryRendered.durationSeconds,
            effectiveMinDuration,
            retrySrt
          );
          if (retryCheck.passed) {
            autoFixLog[autoFixLog.length - 1].result = "berhasil";
            rendered = retryRendered;
            srt = retrySrt;
            wordTimings = retryTranscription.words;
            qualityCheck = retryCheck;
            await db.insert(mediaAssets).values({
              id: newId("asset"),
              projectId: id,
              type: "subtitle_file",
              fileUrl: `data:text/plain;base64,${Buffer.from(retrySrt).toString("base64")}`,
              durationSeconds: null,
              createdAt: new Date(),
            });
          } else {
            autoFixLog[autoFixLog.length - 1].result = `masih gagal stlh retry: ${retryCheck.issues.join("; ")}`;
            qualityCheck = retryCheck;
          }
        } catch (err) {
          autoFixLog[autoFixLog.length - 1].result = `gagal dicoba: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    if (!qualityCheck.passed) {
      await db
        .update(projects)
        .set({ status: "failed", errorMessage: `Quality Check gagal: ${qualityCheck.issues.join("; ")}`, updatedAt: new Date() })
        .where(eq(projects.id, id));
      throw new Error(`Quality Check gagal: ${qualityCheck.issues.join("; ")}`);
    }

    // Chapter YouTube (2026-08-10) - BARU bisa dihitung SEKARANG, durasi render ASLI
    // baru diketahui di titik ini (chapterLabels dari youtubeEditorial.ts TANPA
    // timestamp - lihat distributeChapters kenapa estimasi SEBELUM render tidak
    // dipakai, sama alasan persis dgn "Subtitle PRESISI" 2026-08-06: jangan estimasi
    // kalau bisa pakai angka nyata). Update caption YANG SUDAH TERSIMPAN (di-set
    // sebelum render di atas) supaya blok chapter ikut masuk sebelum publish.
    if (youtubeMeta?.chapterLabels && youtubeMeta.chapterLabels.length > 0) {
      const chapters = distributeChapters(youtubeMeta.chapterLabels, rendered.durationSeconds);
      const title = youtubeMeta.titles[youtubeMeta.selectedTitleIndex] || youtubeMeta.titles[0] || project.script.slice(0, 80);
      caption = buildYoutubeCaption(title, youtubeMeta.seoDescription, chapters);
      const updatedMeta: YoutubeMetadata = { ...youtubeMeta, chapters };
      delete updatedMeta.chapterLabels;
      await db
        .update(projects)
        .set({ generatedCaption: caption, youtubeMetadata: JSON.stringify(updatedMeta), updatedAt: new Date() })
        .where(eq(projects.id, id));
    }

    await db.insert(mediaAssets).values({
      id: newId("asset"),
      projectId: id,
      type: "final_video",
      fileUrl: rendered.videoUrl,
      durationSeconds: rendered.durationSeconds,
      createdAt: new Date(),
    });

    // Catat klip Pexels/Pixabay yg baru dipakai (anti-monoton, lihat
    // getRecentlyUsedFootageUrls di atas) - dibaca project VIDEO berikutnya brand ini
    // supaya klip yg sama tidak kepilih lagi persis. Ikut simpan metadata lisensi
    // (source/creator/url, 2026-08-08 Section 16 PRD YouTube Safety) kalau klip ini
    // dari Pexels/Pixabay - undefined utk klip dari footage foto brand sendiri
    // (imageToVideoClip di atas), otomatis tersimpan null (tidak perlu jejak lisensi
    // pihak ketiga utk footage milik sendiri).
    for (const c of brollClips) {
      await db.insert(mediaAssets).values({
        id: newId("asset"),
        projectId: id,
        type: "broll_used",
        fileUrl: c.videoUrl,
        durationSeconds: c.durationSeconds,
        source: c.source,
        sourceCreator: c.sourceCreator,
        sourceUrl: c.sourceUrl,
        sourceQuery: c.sourceQuery,
        createdAt: new Date(),
      });
    }

    // Thumbnail dari potongan video ASLI, TANPA biaya generate gambar (2026-08-10,
    // permintaan Agus - "jangan ada biaya thumbnail, gunakan potongan video terbaik saja")
    // - GANTI dari generateThumbnail() (Nano Banana 2, $0.08/gambar + teks overlay AI).
    // thumbnailText (konsep teks dari youtubeEditorial.ts) TIDAK DIPAKAI LAGI di sini -
    // dibiarkan tetap dihasilkan di tempat lain (masih relevan sbg ide, cuma tidak
    // dibakar ke gambar).
    //
    // Diaktifkan 2026-09-07 (audit "AI Konten Fase 7-10" - thumbnailScoring.ts sudah
    // dibangun sejak PRD §15/Task Plan 7 tapi TIDAK PERNAH dipanggil dari pipeline ini,
    // cuma extractThumbnailFrame single-frame lama yg jalan) - sekarang ambil BEBERAPA
    // kandidat frame dari jendela hook (extractThumbnailCandidates, tetap 100% FFmpeg
    // lokal/gratis) lalu 1 panggilan vision murah (gpt-4.1-mini, BUKAN image-generation)
    // memilih yg paling menarik jadi thumbnail - biaya vision-teks jauh lebih kecil dari
    // generate gambar, dan tetap nol biaya di tahap ekstraksi framenya sendiri.
    {
      const [ytAccount] = await db
        .select()
        .from(socialAccounts)
        .where(and(eq(socialAccounts.brandId, project.brandId), eq(socialAccounts.platform, "youtube")));
      if (ytAccount) {
        const candidateUrls = await extractThumbnailCandidates(rendered.videoUrl, rendered.durationSeconds, project.brandId, id);
        const scored = await scoreThumbnailCandidates(candidateUrls, caption, brand.name);
        const thumbnailUrl = scored[0]?.url || candidateUrls[0];
        await db.insert(mediaAssets).values({
          id: newId("asset"),
          projectId: id,
          type: "thumbnail",
          fileUrl: thumbnailUrl,
          durationSeconds: null,
          createdAt: new Date(),
        });
      }
    }

    await db
      .update(projects)
      .set({
        status: "ready",
        // Auto-Fix Ladder (2026-08-12, Fase 2b) - dicatat walau HASIL AKHIRNYA sukses,
        // bukan cuma dicatat pas gagal. "0 attempts" (autoFixLog kosong) TIDAK ditulis
        // apa-apa (biarkan null, konsisten dgn project lama) - cuma isi kalau genuinely
        // ada langkah auto-fix yg dicoba.
        ...(autoFixLog.length > 0 ? { autoFixAttempts: autoFixLog.length, autoFixLog: JSON.stringify(autoFixLog) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    return { caption, hashtags, clipCount: selected.length, structureTemplate };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(projects)
      .set({
        status: "failed",
        errorMessage: message,
        ...(autoFixLog.length > 0 ? { autoFixAttempts: autoFixLog.length, autoFixLog: JSON.stringify(autoFixLog) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));
    throw err;
  }
  });
}

// Lock per-projectId (2026-08-14, temuan #1 Lampiran D ENGINEERING_SAFETY.md / audit
// kontenpilot §4/§6) - cegah processProject() dipanggil DOBEL utk project YANG SAMA scr
// bersamaan (klik dobel tombol "Proses"/"Coba Lagi", atau retry manual balapan dgn cron
// yg masih memproses project ini). Pipeline di dalam processProjectInner() SEPENUHNYA
// berbayar (OpenAI+fal.ai+TTS+ffmpeg) - dobel proses = dobel biaya nyata + 2 render
// ffmpeg bersaingan cgroup FFMPEG_MEMORY_MAX/CPUQuota yg sama, bukan cuma bug data.
// Melindungi SEMUA 3 caller sekaligus krn lock dipasang DI SINI (bukan di tiap call
// site): /api/projects/[id]/process, /api/projects/[id]/retry (cabang belum ada final
// asset), dan runAutoContent() (autoContent.ts, dipakai cron/auto-generate + tombol
// manual "⚡") - project BARU dari runAutoContent selalu dapat id baru jadi lock ini
// TIDAK relevan/tidak konflik utk jalur itu (proteksi dobel-proses brand yg sama ada di
// lock brandAutoContentLockKey terpisah, lihat cron/auto-generate/route.ts) - lock ini
// murni menutup celah "2 panggilan utk PROJECT ID yg SAMA persis".
//
// REJECT jelas (LockBusyError, caller HTTP map ke 409), BUKAN skip diam2 - beda dari
// lock brand-level di cron (skip cleanly krn itu proses background otomatis) - di sini
// SELALU dipicu aksi manual/retry sadar, Agus/UI perlu tahu kalau panggilannya tidak
// diproses drpd diam2 tidak terjadi apa-apa.
export async function processProject(id: string): Promise<ProcessResult> {
  const lockKey = projectProcessLockKey(id);
  if (!tryAcquireLock(lockKey)) {
    throw new LockBusyError(
      lockKey,
      "Project ini sedang diproses (generate/render) oleh proses lain - tunggu sampai selesai sebelum mencoba lagi."
    );
  }
  try {
    return await processProjectInner(id);
  } finally {
    releaseLock(lockKey);
  }
}

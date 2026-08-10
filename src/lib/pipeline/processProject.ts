import { db } from "@/db";
import { projects, mediaAssets, brands, socialAccounts, footageBank } from "@/db/schema";
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
import { generateVoiceover } from "@/lib/ai/dubbing";
// Render video LOKAL via FFmpeg (2026-08-05, permintaan Agus - "migrasi agar prosesnya
// free") - GANTI dari cloudinary.ts (makan kredit berbayar) ke ffmpeg.ts (gratis, pakai
// CPU server sendiri). Signature SAMA PERSIS, cuma ganti sumber import.
import { renderFinalVideo } from "@/lib/render/ffmpeg";
import { imageToVideoClip } from "@/lib/render/imageToClip";
import { generatePosterCopy } from "@/lib/ai/posterCopy";
import { applyPosterDesign } from "@/lib/ai/posterDesign";
import { generateThumbnail } from "@/lib/ai/thumbnail";
import { searchBrollVideo } from "@/lib/assets/broll";
import { fetchDestinationBrollClips, isDestinationContent, type DestinationBrollClip } from "@/lib/ai/destinationBroll";
import { getRecentlyUsedFootageUrls, getRemoteFileSizeBytes, MAX_FOOTAGE_BYTES } from "@/lib/ai/footageVariety";
import { applyLogoToImage } from "@/lib/ai/logoOverlay";
import { checkContentSimilarity } from "@/lib/ai/contentSimilarity";
import { factCheckCaption } from "@/lib/ai/factCheck";
import { deriveBrollKeywordsFromScript } from "@/lib/ai/deriveBrollKeywords";
import { distributeChapters, type YoutubeMetadata } from "@/lib/ai/youtubeEditorial";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import { newId } from "@/lib/ids";

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
export async function processProject(id: string): Promise<ProcessResult> {
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) throw new Error("Project tidak ditemukan");

  try {
    if (!project.script) throw new Error("Project belum punya script/brief");

    const rawFootageAssets = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.projectId, id), eq(mediaAssets.type, "raw_footage")));
    if (rawFootageAssets.length === 0) throw new Error("Belum ada footage mentah utk project ini");
    // jalur video BISA >1 file sekaligus (2026-08-05, permintaan Agus - "dominasi footage
    // Pelangi" perlu digabung dari beberapa klip, 1 file asli sering terlalu pendek
    // sendirian) - lihat pooling multi-source di bawah. rawFootage (tunggal) tetap dipakai
    // sbg representatif utk thumbnail & cek stok-atau-tidak.
    const [rawFootage] = rawFootageAssets;

    const [brand] = await db.select().from(brands).where(eq(brands.id, project.brandId));
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
      const { caption, hashtags, promoText, pillar, angle, targetKeyword, keywordLevel, knowledgeUsed } = await generateCaptionForImages(
        brand?.name || "Brand",
        project.script,
        photoUrls,
        brand?.knowledgeSite,
        brand?.manualKnowledge
      );

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
      const posterCopy = await generatePosterCopy(brand?.name || "Brand", project.script);
      const coverUrl = await applyPosterDesign({
        brandId: project.brandId,
        projectId: id,
        imageUrl: photoUrls[0],
        copy: posterCopy,
        brandProfile: brand?.posterBrandProfile,
      });
      const finalImageUrls = photoUrls.length === 1 ? [coverUrl] : [coverUrl, ...photoUrls.slice(1)];

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
          targetKeyword,
          keywordLevel,
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
    let pooled: (Awaited<ReturnType<typeof transcribeFootage>>[number] & { sourceUrl: string })[] = [];

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
      const footageBudgets = computeFootageBudgets(isDestinationContent(project.script), durationConfig.target);
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

    let caption: string, hashtags: string[], brollKeywords: string | null, thumbnailText: string | null,
      structureTemplate: string, pillar: string | null, angle: ContentAngle | null,
      targetKeyword: string | null, keywordLevel: number | null, knowledgeUsed: string;

    if (youtubeMeta) {
      const title = youtubeMeta.titles[youtubeMeta.selectedTitleIndex] || youtubeMeta.titles[0] || project.script.slice(0, 80);
      caption = buildYoutubeCaption(title, youtubeMeta.seoDescription, []);
      hashtags = youtubeMeta.hashtags;
      brollKeywords = await deriveBrollKeywordsFromScript(project.script);
      thumbnailText = youtubeMeta.thumbnailConcepts[0]?.text || null;
      structureTemplate = youtubeMeta.parentVideoTitle ? "YoutubeShort-Repurposed" : project.contentFormat === "youtube_shorts" ? "YoutubeShort" : "YoutubeDocumentary";
      pillar = null;
      angle = null;
      targetKeyword = null;
      keywordLevel = null;
      knowledgeUsed = "";
    } else {
      ({ caption, hashtags, brollKeywords, thumbnailText, structureTemplate, pillar, angle, targetKeyword, keywordLevel, knowledgeUsed } = await generateCaptionAndHashtags(
        brand?.name || "Brand",
        project.script,
        selectedText,
        brand?.knowledgeSite,
        brand?.manualKnowledge,
        durationConfig.target
      ));
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
    if (!isStockFootage) {
      const stockBudget = computeFootageBudgets(isDestinationContent(project.script), durationConfig.target).stockBudgetSeconds;
      brollClips = await fetchDestinationBrollClips(project.script, stockBudget, recentlyUsedUrls);
    }
    if (brollClips.length === 0 && brollKeywords) {
      // Fallback lama - skrip tidak menyebut landmark spesifik apa pun, tetap kasih 1
      // klip suasana umum spt sebelumnya (mis. "tropical homestay garden").
      const broll = await searchBrollVideo(brollKeywords, recentlyUsedUrls);
      if (broll) {
        brollClips = [{
          videoUrl: broll.videoUrl,
          durationSeconds: Math.min(broll.durationSeconds, 5),
          source: broll.source,
          sourceCreator: broll.creator,
          sourceUrl: broll.sourceUrl,
          sourceQuery: brollKeywords,
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
    const PRE_RENDER_TARGET_SECONDS = durationConfig.min + 3;

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

    if (currentTotalDuration() < PRE_RENDER_TARGET_SECONDS && brollKeywords) {
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
        attempts += 1;
        const broll = await searchBrollVideo(brollKeywords, usedBrollUrls);
        if (!broll) break;
        usedBrollUrls.add(broll.videoUrl);
        brollClips.push({
          videoUrl: broll.videoUrl,
          durationSeconds: Math.min(broll.durationSeconds, MAX_CLIP_DURATION),
          source: broll.source,
          sourceCreator: broll.creator,
          sourceUrl: broll.sourceUrl,
          sourceQuery: brollKeywords,
        });
      }
    }

    if (currentTotalDuration() < durationConfig.min) {
      throw new Error(
        `Footage/B-roll yg tersedia tidak cukup utk capai minimum ${durationConfig.min} detik ` +
          `(cuma dapat ~${Math.round(currentTotalDuration())} detik) - upload lebih banyak footage asli, atau coba ide/skrip lain.`
      );
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
    const totalDuration = currentTotalDuration();
    const voiceoverBuffer = await generateVoiceover(caption);
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
      srt = buildCaptionSrt(caption, totalDuration);
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
        targetKeyword,
        keywordLevel,
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

    const rendered = await renderFinalVideo({
      projectId: id,
      brandId: project.brandId,
      segments: selected,
      srtContent: srt,
      wordTimings,
      brollClips,
      // AI Dubbing - GANTI TOTAL suara asli (lihat memory proyek, keputusan eksplisit
      // Agus). Audio-nya SUDAH digenerate di atas (perlu ada LEBIH DULU drpd subtitle
      // presisi dibangun) - di sini tinggal diteruskan, bukan generate baru lagi.
      voiceoverAudioBuffer: voiceoverBuffer,
      // Logo brand OPSIONAL (2026-08-05, permintaan Agus) - lihat catatan lengkap di
      // cabang carousel di atas, sama alasannya.
      logoUrl: brand?.logoUrl,
      // Orientasi (2026-08-05, permintaan Agus - "landscape atau potrait ini utk
      // kebutuhan YT") - setting per-brand, default "portrait" kalau belum di-set.
      // YT Shorts (2026-08-10) SELALU portrait, override setting brand - lihat
      // isYoutubeShorts di atas.
      orientation: isYoutubeShorts ? "portrait" : brand?.videoOrientation,
    });

    // Jaring pengaman TERAKHIR (2026-08-05) - cek durasi SUNGGUHAN hasil render (ffprobe,
    // bukan estimasi pre-render) tetap >= minimum wajib. Ditemukan lewat tes nyata: durasi
    // NOMINAL klip Pexels kadang beda dari durasi FILE sungguhan yg diserve, jadi estimasi
    // pre-render (sudah dikasih margin +3dtk, lihat PRE_RENDER_TARGET_SECONDS di atas) bisa
    // meleset. Render yg SUDAH JADI tapi ternyata di bawah standar tetap DIBUANG (bukan
    // dipublikasikan diam2 melanggar aturan "tidak boleh kurang dari 40 detik") - biaya
    // render yg terbuang lebih baik drpd konten yg melanggar aturan keras yg diminta Agus.
    if (rendered.durationSeconds < durationConfig.min) {
      throw new Error(
        `Video hasil render cuma ${rendered.durationSeconds} detik, di bawah minimum ` +
          `${durationConfig.min} detik yg diwajibkan (estimasi pre-render meleset - ` +
          `durasi nyata sumber footage beda dari metadata) - coba generate ulang.`
      );
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

    if (thumbnailText) {
      const [ytAccount] = await db
        .select()
        .from(socialAccounts)
        .where(and(eq(socialAccounts.brandId, project.brandId), eq(socialAccounts.platform, "youtube")));
      if (ytAccount) {
        const thumbnailUrl = await generateThumbnail({
          brandId: project.brandId,
          projectId: id,
          rawFootageUrl: rawFootage.fileUrl,
          thumbnailText,
        });
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

    await db.update(projects).set({ status: "ready", updatedAt: new Date() }).where(eq(projects.id, id));

    return { caption, hashtags, clipCount: selected.length, structureTemplate };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(projects)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(projects.id, id));
    throw err;
  }
}

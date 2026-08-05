import { db } from "@/db";
import { projects, mediaAssets, brands, socialAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { transcribeFootage } from "@/lib/ai/transcribe";
import {
  selectClips,
  scoreSegments,
  REAL_FOOTAGE_BUDGET_SECONDS,
  STOCK_FOOTAGE_BUDGET_SECONDS,
  MAX_CLIP_DURATION,
} from "@/lib/ai/clipSelect";
import { generateCaptionAndHashtags, generateCaptionForImages, buildCaptionSrt } from "@/lib/ai/generateContent";
// Render video LOKAL via FFmpeg (2026-08-05, permintaan Agus - "migrasi agar prosesnya
// free") - GANTI dari cloudinary.ts (makan kredit berbayar) ke ffmpeg.ts (gratis, pakai
// CPU server sendiri). Signature SAMA PERSIS, cuma ganti sumber import.
import { renderFinalVideo } from "@/lib/render/ffmpeg";
import { applyPromoOverlay } from "@/lib/ai/promoOverlay";
import { generatePosterCopy } from "@/lib/ai/posterCopy";
import { applyPosterDesign } from "@/lib/ai/posterDesign";
import { generateThumbnail } from "@/lib/ai/thumbnail";
import { searchBrollVideo } from "@/lib/assets/broll";
import { fetchDestinationBrollClips } from "@/lib/ai/destinationBroll";
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

    if (project.type === "carousel") {
      const photoUrls = rawFootageAssets.map((a) => a.fileUrl);
      const { caption, hashtags, promoText } = await generateCaptionForImages(
        brand?.name || "Brand",
        project.script,
        photoUrls
      );

      // Foto TUNGGAL pakai "Pelangi Homestay Poster Design System v1" (2026-08-05, master
      // prompt lengkap dari Agus) - poster penuh (headline/CTA/badge/benefit dgn gaya
      // brand konsisten), BUKAN cuma badge kecil 1 pojok - lihat posterDesign.ts. Carousel
      // multi-foto TETAP pakai applyPromoOverlay lama (badge kecil di foto pertama SAJA
      // kalau ada promo) - master prompt ini eksplisit "hanya untuk single foto".
      const finalImageUrls =
        photoUrls.length === 1
          ? [
              await applyPosterDesign({
                brandId: project.brandId,
                projectId: id,
                imageUrl: photoUrls[0],
                copy: await generatePosterCopy(brand?.name || "Brand", project.script),
              }),
            ]
          : await Promise.all(
              photoUrls.map((url, i) =>
                promoText && i === 0
                  ? applyPromoOverlay({ brandId: project.brandId, projectId: id, imageUrl: url, promoText })
                  : Promise.resolve(url)
              )
            );

      await db
        .update(projects)
        .set({
          status: "ready",
          generatedCaption: caption,
          generatedHashtags: JSON.stringify(hashtags),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id));

      // Foto tunggal SELALU tetap poster foto (2026-08-05, permintaan Agus - single
      // post harus pakai foto asli apa adanya + overlay teks promo kalau ada, BUKAN
      // diubah jadi video) - sama persis carousel multi-foto di bawah, tidak ada lagi
      // percabangan khusus foto tunggal. Efek zoom-ke-video (applyZoomToImage) yang
      // dulu otomatis jalan di sini sudah DIHAPUS dari alur ini per keputusan Agus ini
      // (supersede keputusan sebelumnya "bangun untuk foto saja" - Ken Burns zoom).
      for (const url of finalImageUrls) {
        await db.insert(mediaAssets).values({
          id: newId("asset"),
          projectId: id,
          type: "final_image",
          fileUrl: url,
          durationSeconds: null,
          createdAt: new Date(),
        });
      }

      return { caption, hashtags, promoText, photoCount: finalImageUrls.length };
    }

    const isStockFootage = rawFootageAssets.every((a) => isStockFootageUrl(a.fileUrl));

    type SourcedSegment = Awaited<ReturnType<typeof selectClips>>[number] & { sourceUrl: string };
    let segments: Awaited<ReturnType<typeof transcribeFootage>>;
    let selected: SourcedSegment[];
    let selectedText: string;

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
      // Kumpulkan footage dari SEMUA file asli sekaligus (2026-08-05, permintaan Agus -
      // "1 video didominasi footage Pelangi", rasio 7:3 - 1 file asli sendirian sering
      // terlalu pendek [ada yg cuma ~4 detik] utk isi 70% dari target 30-60 detik).
      // Transkrip tiap file terpisah, tandai asal file-nya (sourceUrl) supaya
      // renderFinalVideo tahu tiap klip terpilih harus dipotong dari file MANA.
      const pooled: (Awaited<ReturnType<typeof transcribeFootage>>[number] & { sourceUrl: string })[] = [];
      segments = [];
      for (const asset of rawFootageAssets) {
        const t = await transcribeFootage(asset.fileUrl);
        segments = segments.concat(t);
        pooled.push(...t.map((s) => ({ ...s, sourceUrl: asset.fileUrl })));
      }
      const budgeted = selectClips(pooled, project.script, REAL_FOOTAGE_BUDGET_SECONDS);
      // Pastikan SEMUA file yg Agus sediakan ikut terwakili (2026-08-05, bug nyata
      // ditemukan lewat tes live - selectClips cuma fallback ke 1 klip TERBAIK dari
      // SELURUH pool kalau tidak ada yg lolos ambang skor, bukan per-file - 4 klip asli
      // disediakan tapi cuma 1 yg kepakai krn footage lain tanpa narasi jelas semuanya
      // kalah skor dari yg 1 itu). Video yg "didominasi footage Pelangi" (permintaan
      // Agus) HARUS menyertakan tiap file yg disediakan, bukan cuma yg skornya
      // kebetulan tertinggi - top-up klip terbaik PER FILE yg belum terwakili di hasil
      // selectClips.
      const representedSources = new Set(budgeted.map((s) => s.sourceUrl));
      const missingSources = rawFootageAssets.filter((a) => !representedSources.has(a.fileUrl));
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
    const { caption, hashtags, brollKeywords, thumbnailText, structureTemplate } = await generateCaptionAndHashtags(
      brand?.name || "Brand",
      project.script,
      selectedText
    );

    // Kombinasi footage asli + Pexels (2026-08-05, permintaan Agus - "jika ada
    // pembahasan wisata seperti danau beratan kebun raya bedugul dan lainnya gunakan
    // pexels, jika menyangkut pelangi gunakan footage asli pelangi", rasio 7:3). Cuma
    // relevan kalau dasarnya footage ASLI (bukan footage stok - video "ide umum" tanpa
    // footage asli, lihat isStockFootage di atas, sudah 100% Pexels dari awal, tidak ada
    // yg perlu dikombinasi). Tiap landmark yg disebut skrip dapat klip Pexels sendiri,
    // ditempel sbg "peak"/highlight SETELAH bagian fasilitas footage asli (lihat
    // renderFinalVideo - brollClips selalu di akhir urutan splice).
    let brollClips: Array<{ videoUrl: string; durationSeconds: number }> = [];
    if (!isStockFootage) {
      brollClips = await fetchDestinationBrollClips(project.script, STOCK_FOOTAGE_BUDGET_SECONDS);
    }
    if (brollClips.length === 0 && brollKeywords) {
      // Fallback lama - skrip tidak menyebut landmark spesifik apa pun, tetap kasih 1
      // klip suasana umum spt sebelumnya (mis. "tropical homestay garden").
      const broll = await searchBrollVideo(brollKeywords);
      if (broll) {
        brollClips = [{ videoUrl: broll.videoUrl, durationSeconds: Math.min(broll.durationSeconds, 5) }];
      }
    }

    // Subtitle dibuat dari CAPTION (bukan transkrip asli lagi) - krn AI Dubbing (di
    // bawah) MENGGANTI TOTAL audio dgn TTS membaca caption, subtitle jg HARUS teks yg
    // sama, bukan transkrip asli yg sudah tidak match dgn audio barunya.
    const totalDuration =
      selected.reduce((sum, seg) => sum + (seg.end - seg.start), 0) +
      brollClips.reduce((sum, c) => sum + c.durationSeconds, 0);
    const srt = buildCaptionSrt(caption, totalDuration);

    await db
      .update(projects)
      .set({
        status: "ready",
        transcript: JSON.stringify(segments),
        clipSelection: JSON.stringify(selected),
        generatedCaption: caption,
        generatedHashtags: JSON.stringify(hashtags),
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
      brollClips,
      // AI Dubbing - GANTI TOTAL suara asli (lihat memory proyek, keputusan eksplisit
      // Agus), reuse caption yg sudah di-generate sbg naskah narasi - tidak perlu
      // panggilan GPT terpisah.
      voiceoverText: caption,
    });

    await db.insert(mediaAssets).values({
      id: newId("asset"),
      projectId: id,
      type: "final_video",
      fileUrl: rendered.videoUrl,
      durationSeconds: rendered.durationSeconds,
      createdAt: new Date(),
    });

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

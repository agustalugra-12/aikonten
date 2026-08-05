import { db } from "@/db";
import { projects, mediaAssets, brands, socialAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { transcribeFootage } from "@/lib/ai/transcribe";
import { selectClips } from "@/lib/ai/clipSelect";
import { generateCaptionAndHashtags, generateCaptionForImages, buildCaptionSrt } from "@/lib/ai/generateContent";
import { renderFinalVideo } from "@/lib/render/cloudinary";
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
    const [rawFootage] = rawFootageAssets; // jalur video selalu 1 file - carousel di bawah utk banyak foto

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

    const isStockFootage = isStockFootageUrl(rawFootage.fileUrl);

    let segments: Awaited<ReturnType<typeof transcribeFootage>>;
    let selected: ReturnType<typeof selectClips>;
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
        },
      ];
      // Tidak ada transkrip asli - caption/hashtag digenerate dari SKRIP/IDE saja (masih
      // cukup, krn ini jalur ide UMUM yg tidak butuh detail spesifik properti).
      selectedText = "";
    } else {
      segments = await transcribeFootage(rawFootage.fileUrl);
      selected = selectClips(segments, project.script);
      selectedText = selected.map((s) => s.text).join(" ");
    }
    const { caption, hashtags, brollKeywords, thumbnailText } = await generateCaptionAndHashtags(
      brand?.name || "Brand",
      project.script,
      selectedText
    );

    // Kombinasi footage asli + Pexels (2026-08-05, permintaan Agus - "jika ada
    // pembahasan wisata seperti danau beratan kebun raya bedugul dan lainnya gunakan
    // pexels, jika menyangkut pelangi gunakan footage asli pelangi"). Cuma relevan
    // kalau dasarnya footage ASLI (bukan footage stok - video "ide umum" tanpa footage
    // asli, lihat isStockFootage di atas, sudah 100% Pexels dari awal, tidak ada yg
    // perlu dikombinasi). Tiap landmark yg disebut skrip dapat klip Pexels sendiri,
    // ditempel MENDAMPINGI klip asli Pelangi (lihat renderFinalVideo - klip pertama
    // selalu footage asli).
    let brollClips: Array<{ videoUrl: string; durationSeconds: number }> = [];
    if (!isStockFootage) {
      brollClips = await fetchDestinationBrollClips(project.script);
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
      rawFootageUrl: rawFootage.fileUrl,
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

    return { caption, hashtags, clipCount: selected.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(projects)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(projects.id, id));
    throw err;
  }
}

import { db } from "@/db";
import { projects, mediaAssets, brands, socialAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { transcribeFootage } from "@/lib/ai/transcribe";
import { selectClips } from "@/lib/ai/clipSelect";
import { generateCaptionAndHashtags, generateCaptionForImages, buildCaptionSrt } from "@/lib/ai/generateContent";
import { renderFinalVideo, applyZoomToImage } from "@/lib/render/cloudinary";
import { applyPromoOverlay } from "@/lib/ai/promoOverlay";
import { generateThumbnail } from "@/lib/ai/thumbnail";
import { searchBrollVideo } from "@/lib/assets/broll";
import { newId } from "@/lib/ids";
import { publishProject } from "@/lib/publish/orchestrate";

export type ProcessResult = {
  caption: string;
  hashtags: string[];
  promoText?: string | null;
  photoCount?: number;
  clipCount?: number;
};

// Pipeline Fase 1 (lihat memory proyek) - DIPAKAI BERSAMA oleh
// POST /api/projects/[id]/process (dipicu manual dari NewProjectDialog) MAUPUN
// POST /api/brands/[id]/auto-content ("⚡ Konten Otomatis", lihat matchFootageBank.ts)
// - SATU implementasi, bukan duplikat kode. Dua jalur beda tergantung project.type:
// - "video": transkripsi -> pemilihan klip otomatis (heuristik deterministik, BUKAN
//   vision-AI) -> caption/hashtag/subtitle -> render video final (splice+subtitle via
//   Cloudinary) -> thumbnail (kalau ada YouTube) -> publish.
// - "carousel" (foto): TIDAK ada transkrip/render - foto mentah LANGSUNG jadi aset
//   final, caption dibuat dari analisis foto asli (vision model).
// Keduanya LANGSUNG lanjut publishProject() otomatis (full-auto, TIDAK ADA jeda
// approval - keputusan eksplisit Agus).
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

      const finalImageUrls = await Promise.all(
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

      // Efek zoom (lihat memory proyek) - CUMA berlaku foto TUNGGAL, bukan carousel
      // multi-foto (Cloudinary zoompan cuma jalan di 1 gambar diam, menyambung banyak
      // klip zoom = kompleksitas splice penuh spt video, di luar scope ini). Foto
      // tunggal jadi VIDEO pendek (final_video), bukan final_image lagi.
      if (finalImageUrls.length === 1) {
        const zoomVideoUrl = await applyZoomToImage(finalImageUrls[0], 4);
        await db.insert(mediaAssets).values({
          id: newId("asset"),
          projectId: id,
          type: "final_video",
          fileUrl: zoomVideoUrl,
          durationSeconds: 4,
          createdAt: new Date(),
        });
      } else {
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
      }

      await publishProject(id);

      return { caption, hashtags, promoText, photoCount: finalImageUrls.length };
    }

    const segments = await transcribeFootage(rawFootage.fileUrl);
    const selected = selectClips(segments, project.script);
    const selectedText = selected.map((s) => s.text).join(" ");
    const { caption, hashtags, brollKeywords, thumbnailText } = await generateCaptionAndHashtags(
      brand?.name || "Brand",
      project.script,
      selectedText
    );

    let brollVideoUrl: string | undefined;
    let brollDurationSeconds: number | undefined;
    if (brollKeywords) {
      const broll = await searchBrollVideo(brollKeywords);
      if (broll) {
        brollVideoUrl = broll.videoUrl;
        brollDurationSeconds = Math.min(broll.durationSeconds, 5);
      }
    }

    // Subtitle dibuat dari CAPTION (bukan transkrip asli lagi) - krn AI Dubbing (di
    // bawah) MENGGANTI TOTAL audio dgn TTS membaca caption, subtitle jg HARUS teks yg
    // sama, bukan transkrip asli yg sudah tidak match dgn audio barunya.
    const totalDuration =
      selected.reduce((sum, seg) => sum + (seg.end - seg.start), 0) + (brollDurationSeconds || 0);
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
      brollVideoUrl,
      brollDurationSeconds,
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

    await publishProject(id);

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

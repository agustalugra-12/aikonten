import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, mediaAssets, brands, socialAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { transcribeFootage } from "@/lib/ai/transcribe";
import { selectClips } from "@/lib/ai/clipSelect";
import { generateCaptionAndHashtags, generateCaptionForImages, buildSrtSubtitles } from "@/lib/ai/generateContent";
import { renderFinalVideo } from "@/lib/render/cloudinary";
import { applyPromoOverlay } from "@/lib/ai/promoOverlay";
import { generateThumbnail } from "@/lib/ai/thumbnail";
import { searchBrollVideo } from "@/lib/assets/broll";
import { newId } from "@/lib/ids";
import { publishProject } from "@/lib/publish/orchestrate";

// Orkestrasi pipeline Fase 1 (lihat PRD diskusi & task list). Dua jalur beda tergantung
// project.type:
// - "video": transkripsi -> pemilihan klip otomatis (heuristik deterministik, BUKAN
//   vision-AI) -> caption/hashtag/subtitle -> render video final (splice+subtitle via
//   Cloudinary) -> publish.
// - "carousel" (foto): TIDAK ada transkrip/render - foto mentah LANGSUNG jadi aset
//   final, caption dibuat dari analisis foto asli (vision model) - lihat
//   generateCaptionForImage.
// Keduanya LANGSUNG lanjut publishProject() otomatis (full-auto, TIDAK ADA jeda
// approval - keputusan eksplisit Agus, lihat memory project_kontenpilot_ai.md).
//
// Kalau rendering/generate gagal, exception-nya ditangkap oleh catch-all di bawah -
// project ditandai "failed" dgn errorMessage jelas, publishProject() TIDAK dipanggil.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  if (!project.script) {
    return NextResponse.json({ error: "Project belum punya script/brief" }, { status: 400 });
  }

  const rawFootageAssets = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.projectId, id), eq(mediaAssets.type, "raw_footage")));
  if (rawFootageAssets.length === 0) {
    return NextResponse.json({ error: "Belum ada footage mentah utk project ini" }, { status: 400 });
  }
  const [rawFootage] = rawFootageAssets; // jalur video selalu 1 file - lihat carousel di bawah utk banyak foto

  const [brand] = await db.select().from(brands).where(eq(brands.id, project.brandId));

  try {
    // Konten foto (type "carousel") - TIDAK ada audio utk ditranskrip, jadi skip
    // transcribe/clipSelect/render sepenuhnya. Foto mentah yg diupload LANGSUNG jadi
    // aset final (foto asli sudah "final", tidak perlu disambung/dipotong spt video) -
    // caption dibuat dari analisis foto asli (vision), bukan cuma teks skrip.
    if (project.type === "carousel") {
      const photoUrls = rawFootageAssets.map((a) => a.fileUrl);
      const { caption, hashtags, promoText } = await generateCaptionForImages(
        brand?.name || "Brand",
        project.script,
        photoUrls
      );

      // Kalau skrip menyebut harga/promo, tempel badge-nya HANYA di foto PERTAMA
      // (cover) via GPT Image (edit bermask - foto asli TIDAK diubah di luar area
      // badge, lihat promoOverlay.ts) - foto lain di carousel dipakai apa adanya,
      // tidak semua foto perlu badge yg sama.
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

      await publishProject(id);

      return NextResponse.json({ ok: true, caption, hashtags, promoText, photoCount: finalImageUrls.length });
    }

    const segments = await transcribeFootage(rawFootage.fileUrl);
    const selected = selectClips(segments, project.script);
    const selectedText = selected.map((s) => s.text).join(" ");
    const { caption, hashtags, brollKeywords, thumbnailText } = await generateCaptionAndHashtags(
      brand?.name || "Brand",
      project.script,
      selectedText
    );
    const srt = buildSrtSubtitles(selected);

    // B-roll Pexels/Pixabay "pendamping" (lihat PRD diskusi) - OPSIONAL, kalau gagal/
    // tidak ketemu JANGAN gagalkan seluruh proses, video tetap jalan tanpa B-roll.
    // Dibatasi maks 5 detik biar cuma jadi tambahan, bukan mendominasi video.
    let brollVideoUrl: string | undefined;
    let brollDurationSeconds: number | undefined;
    if (brollKeywords) {
      const broll = await searchBrollVideo(brollKeywords);
      if (broll) {
        brollVideoUrl = broll.videoUrl;
        brollDurationSeconds = Math.min(broll.durationSeconds, 5);
      }
    }

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
    });

    await db.insert(mediaAssets).values({
      id: newId("asset"),
      projectId: id,
      type: "final_video",
      fileUrl: rendered.videoUrl,
      durationSeconds: rendered.durationSeconds,
      createdAt: new Date(),
    });

    // Thumbnail Engine - CUMA jalan kalau brand ini punya akun YouTube tersambung
    // (satu2nya platform yg butuh thumbnail terpisah, lihat memory proyek) - jangan
    // buang panggilan GPT Image kalau videonya tidak akan pernah dipublish ke YouTube.
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

    return NextResponse.json({ ok: true, caption, hashtags, clipCount: selected.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(projects)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(projects.id, id));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

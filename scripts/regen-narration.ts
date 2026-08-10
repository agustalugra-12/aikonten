import "dotenv/config";
import { db } from "../src/db";
import { projects, brands, mediaAssets } from "../src/db/schema";
import { eq, and } from "drizzle-orm";
import { newId } from "../src/lib/ids";
import { generateVoiceover } from "../src/lib/ai/dubbing";
import { transcribeAudioBuffer } from "../src/lib/ai/transcribe";
import { buildSrtFromTranscriptSegments, buildCaptionSrt } from "../src/lib/ai/generateContent";
import { renderFinalVideo } from "../src/lib/render/ffmpeg";
import { distributeChapters, type YoutubeMetadata } from "../src/lib/ai/youtubeEditorial";

// Regenerasi TARGET (2026-08-10) - perbaiki 6 video Animal Story & Co yg dirender
// SEBELUM fix bug voiceover (caption SEO dipakai sbg narasi, bukan project.script -
// lihat commit 32b8d7a). HANYA regenerasi audio+subtitle+render ULANG (reuse
// clip_selection & broll_used YANG SUDAH ADA di DB, TIDAK re-search footage/re-generate
// caption/hashtag/judul SEO - itu semua SUDAH BENAR, cuma audio-nya yg salah) - hemat
// biaya GPT+footage-search, cuma bayar TTS (perlu, wajib benar) + Whisper (murah) +
// render (CPU server, gratis).
const PROJECT_IDS = [
  "proj_Nq9-4_f9QoAI",
  "proj_xOVnqf_6tZ3t",
  "proj_cAKPmbYp3bZF",
  "proj_tA4VstbYxmaj",
  "proj_loIJvNLf7wZ7",
  "proj_F4D-9AzC6F5H",
];

async function regenOne(projectId: string) {
  console.log(`\n=== ${projectId} ===`);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("project tidak ditemukan");
  const [brand] = await db.select().from(brands).where(eq(brands.id, project.brandId));

  const clipSelection = JSON.parse(project.clipSelection || "[]");
  if (clipSelection.length === 0) throw new Error("clip_selection kosong, tidak bisa regenerasi tanpa re-search footage");

  const brollAssets = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.projectId, projectId), eq(mediaAssets.type, "broll_used")));
  const brollClips = brollAssets.map((a) => ({
    videoUrl: a.fileUrl,
    durationSeconds: a.durationSeconds || 5,
    source: a.source || undefined,
    sourceCreator: a.sourceCreator || undefined,
    sourceUrl: a.sourceUrl || undefined,
    sourceQuery: a.sourceQuery || undefined,
  }));

  console.log(`clip asli: ${clipSelection.length}, broll: ${brollClips.length}`);
  console.log(`generateVoiceover dari project.script (${project.script!.length} chars)...`);
  const voiceoverBuffer = await generateVoiceover(project.script!);

  let srt: string;
  let wordTimings: Awaited<ReturnType<typeof transcribeAudioBuffer>>["words"] = [];
  try {
    const transcription = await transcribeAudioBuffer(voiceoverBuffer);
    srt = buildSrtFromTranscriptSegments(transcription.segments);
    wordTimings = transcription.words;
  } catch (err) {
    console.error("whisper re-transcribe gagal, fallback estimasi rata:", err);
    // estimasi kasar durasi dari clip+broll yg ada, cuma utk fallback SRT
    const roughDuration =
      clipSelection.reduce((s: number, c: { start: number; end: number }) => s + (c.end - c.start), 0) +
      brollClips.reduce((s, c) => s + c.durationSeconds, 0);
    srt = buildCaptionSrt(project.script!, roughDuration);
  }

  console.log("render ulang video...");
  const rendered = await renderFinalVideo({
    projectId,
    brandId: project.brandId,
    segments: clipSelection,
    srtContent: srt,
    wordTimings,
    brollClips,
    voiceoverAudioBuffer: voiceoverBuffer,
    logoUrl: brand?.logoUrl,
    orientation: brand?.videoOrientation,
  });
  console.log(`render selesai: ${rendered.durationSeconds}s (sebelumnya beda krn audio salah)`);

  // Update chapter timestamps mengikuti durasi BARU (label chapter tetap sama, cuma
  // waktunya menyesuaikan durasi video yg mungkin berubah krn video-loop-fix skrng
  // aktif utk audio yg jauh lebih panjang dari sebelumnya).
  if (project.youtubeMetadata) {
    const meta: YoutubeMetadata = JSON.parse(project.youtubeMetadata);
    if (meta.chapters && meta.chapters.length > 0) {
      const labels = meta.chapters.map((c) => c.label);
      const newChapters = distributeChapters(labels, rendered.durationSeconds);
      const title = meta.titles[meta.selectedTitleIndex] || meta.titles[0];
      const chapterBlock = newChapters.map((c) => `${c.time} ${c.label}`).join("\n");
      const newCaption = `${title}\n\n${meta.seoDescription}\n\n${chapterBlock}`;
      meta.chapters = newChapters;
      await db
        .update(projects)
        .set({ youtubeMetadata: JSON.stringify(meta), generatedCaption: newCaption, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    }
  }

  // Ganti aset final_video & subtitle_file LAMA (yg salah) - hapus dulu baru insert baru,
  // supaya publishProject() (pakai assets.find, ambil yg PERTAMA) tidak balik ke versi lama.
  await db
    .delete(mediaAssets)
    .where(and(eq(mediaAssets.projectId, projectId), eq(mediaAssets.type, "final_video")));
  await db
    .delete(mediaAssets)
    .where(and(eq(mediaAssets.projectId, projectId), eq(mediaAssets.type, "subtitle_file")));

  await db.insert(mediaAssets).values({
    id: newId("asset"),
    projectId,
    type: "subtitle_file",
    fileUrl: `data:text/plain;base64,${Buffer.from(srt).toString("base64")}`,
    durationSeconds: null,
    createdAt: new Date(),
  });
  await db.insert(mediaAssets).values({
    id: newId("asset"),
    projectId,
    type: "final_video",
    fileUrl: rendered.videoUrl,
    durationSeconds: rendered.durationSeconds,
    createdAt: new Date(),
  });

  await db
    .update(projects)
    .set({ status: "ready", errorMessage: null, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  console.log(`✅ ${projectId} selesai diregenerasi, status='ready'`);
}

async function main() {
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of PROJECT_IDS) {
    try {
      await regenOne(id);
      results.push({ id, ok: true });
    } catch (err) {
      console.error(`❌ ${id} gagal:`, err);
      results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  console.log("\n=== RINGKASAN ===");
  console.table(results);
  process.exit(0);
}

main();

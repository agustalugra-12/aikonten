import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, mediaAssets, brands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { transcribeFootage } from "@/lib/ai/transcribe";
import { selectClips } from "@/lib/ai/clipSelect";
import { generateCaptionAndHashtags, buildSrtSubtitles } from "@/lib/ai/generateContent";
import { newId } from "@/lib/ids";
import { publishProject } from "@/lib/publish/orchestrate";

// Orkestrasi pipeline Fase 1 (lihat PRD diskusi & task list): transkripsi -> pemilihan
// klip otomatis (heuristik deterministik, BUKAN vision-AI) -> caption/hashtag/subtitle
// -> LANGSUNG lanjut publishProject() otomatis (full-auto, TIDAK ADA jeda approval -
// keputusan eksplisit Agus, lihat memory project_kontenpilot_ai.md).
//
// publishProject() sendiri akan gagal dgn jelas kalau aset final (video/gambar hasil
// rendering) belum ada - lihat orchestrate.ts - krn rendering trim+concat+subtitle via
// Cloudinary/Replicate BELUM diimplementasikan (task terpisah, butuh kredensial nyata
// dari Agus yg belum ada). Artefak teks (transcript/clipSelection/caption/hashtags/SRT)
// tetap lengkap & tersimpan begitu status jadi "ready", siap dipakai begitu rendering
// ada.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) {
    return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }
  if (!project.script) {
    return NextResponse.json({ error: "Project belum punya script/brief" }, { status: 400 });
  }

  const [rawFootage] = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.projectId, id));
  if (!rawFootage) {
    return NextResponse.json({ error: "Belum ada footage mentah utk project ini" }, { status: 400 });
  }

  const [brand] = await db.select().from(brands).where(eq(brands.id, project.brandId));

  try {
    const segments = await transcribeFootage(rawFootage.fileUrl);
    const selected = selectClips(segments, project.script);
    const selectedText = selected.map((s) => s.text).join(" ");
    const { caption, hashtags } = await generateCaptionAndHashtags(
      brand?.name || "Brand",
      project.script,
      selectedText
    );
    const srt = buildSrtSubtitles(selected);

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

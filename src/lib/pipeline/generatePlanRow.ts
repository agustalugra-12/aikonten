import { db } from "@/db";
import { contentPlan, projects, brands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runAutoContent } from "./autoContent";

type Row = typeof contentPlan.$inferSelect;

// Core generate 1 baris Planner (2026-10-05, Fase 3 manual + auto-cron). TANPA lock -
// caller yang kelola (manual endpoint bungkus withLock; cron auto-generate SUDAH pegang
// brandAutoContentLockKey brand ini, jadi tak boleh ambil lock lagi -> deadlock). Pakai
// teks editan owner: script=scriptBrief||hook||topic, override caption/hashtag, write-back
// setelan per-baris (orientasi/jumlah/footage). Update baris -> digenerate + projectId.
export async function runPlanRowGenerate(row: Row): Promise<string> {
  const script = (row.scriptBrief || row.hook || row.topic || "").trim();
  if (!script) throw new Error("Baris belum punya hook/topik/skrip untuk digenerate.");

  const brandPatch: Record<string, unknown> = {};
  if (row.orientation) brandPatch.videoOrientation = row.orientation;
  if (row.carouselCount) brandPatch.carouselPhotosPerPost = row.carouselCount;
  if (row.footageSource) brandPatch.footageSource = row.footageSource;
  // (2026-10-07) Durasi per-baris: video pakai videoDuration baris kalau diatur (preset valid),
  // narasi otomatis ikut panjang durasi (word-count target di generateCaptionAndHashtags).
  if (row.contentType === "video" && row.videoDuration) {
    const [brandRow] = await db.select().from(brands).where(eq(brands.id, row.brandId));
    const effOri = row.orientation || brandRow?.videoOrientation || "portrait";
    const allowedDur = effOri === "landscape" ? [30, 60, 90, 180, 300, 480] : [30, 60];
    if (allowedDur.includes(row.videoDuration)) brandPatch.videoDurationTarget = row.videoDuration;
  }
  if (Object.keys(brandPatch).length > 0) {
    await db.update(brands).set(brandPatch).where(eq(brands.id, row.brandId));
  }

  const r = await runAutoContent(
    row.brandId,
    script,
    row.contentType,
    undefined,
    undefined,
    undefined,
    row.pillar || undefined,
    undefined,
    undefined,
    undefined,
    row.carouselVisual === "ai" || row.carouselVisual === "footage" ? row.carouselVisual : undefined
  );

  const projPatch: Record<string, unknown> = {};
  if (row.draftCaption && row.draftCaption.trim()) projPatch.generatedCaption = row.draftCaption.trim();
  if (row.draftHashtags && row.draftHashtags.trim()) {
    const tags = row.draftHashtags.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
    if (tags.length > 0) projPatch.generatedHashtags = JSON.stringify(tags);
  }
  if (Object.keys(projPatch).length > 0) {
    await db.update(projects).set(projPatch).where(eq(projects.id, r.projectId));
  }

  await db
    .update(contentPlan)
    .set({ projectId: r.projectId, status: "digenerate", updatedAt: new Date() })
    .where(eq(contentPlan.id, row.id));
  return r.projectId;
}

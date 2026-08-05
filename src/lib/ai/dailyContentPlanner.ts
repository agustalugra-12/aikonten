import { db } from "@/db";
import { dailyIdeas, brands, projects } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { suggestContentIdeas, todayDateKeyWita } from "./researchTopics";
import { newId } from "@/lib/ids";

// AI Content Planner (2026-08-05, permintaan Agus, PRD "AI Content Brain" modul 10 -
// "setiap pagi AI membuat 10 ide"). Digenerate SEKALI per hari (lazy - saat pertama
// kali dashboard/panel dibuka hari itu, BUKAN cron terjadwal - KontenPilot AI belum
// punya infra cron sama sekali, beda dari ai-chat-bot/web-pelangi yg sudah py systemd
// timer, jadi ini pola paling sederhana yg mencapai hasil praktis sama: "10 ide segar
// tiap hari" tanpa nambah komponen infra baru) & DIPERSIST (dailyIdeas) supaya
// konsisten sepanjang hari - refresh halaman tidak menghasilkan batch baru yg beda.
const DAILY_IDEA_COUNT = 10;

export type DailyIdea = {
  id: string;
  idea: string;
  used: boolean;
};

export async function getOrGenerateDailyIdeas(brandId: string): Promise<DailyIdea[]> {
  const today = todayDateKeyWita();

  const existing = await db
    .select()
    .from(dailyIdeas)
    .where(and(eq(dailyIdeas.brandId, brandId), eq(dailyIdeas.date, today)));
  if (existing.length > 0) {
    return existing.map((r) => ({ id: r.id, idea: r.idea, used: r.used }));
  }

  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) throw new Error("Brand tidak ditemukan");

  // Histori lebih lebar drpd "Ide Konten" on-demand (15 -> 30 skrip terakhir) - batch
  // 10 ide sekaligus butuh lebih banyak konteks anti-pengulangan drpd cuma 3-5 ide.
  const recentProjects = await db
    .select({
      script: projects.script, pillar: projects.pillar, angle: projects.angle,
      targetKeyword: projects.targetKeyword, keywordLevel: projects.keywordLevel,
    })
    .from(projects)
    .where(eq(projects.brandId, brandId))
    .orderBy(desc(projects.createdAt))
    .limit(30);
  const recentScripts = recentProjects.map((p) => p.script).filter((s): s is string => !!s);
  // Duplicate Checker, Content Pillar, & Keyword Priority NYATA (2026-08-05) - kirim
  // klasifikasi ASLI (bukan cuma teks skrip mentah) supaya distribusi pilar/angle/
  // keyword SEBENARNYA dipertimbangkan, lihat buildDistributionBlock &
  // buildKeywordPriorityBlock di researchTopics.ts/keywordPriority.ts.
  const recentClassifications = recentProjects.map((p) => ({
    pillar: p.pillar, angle: p.angle, targetKeyword: p.targetKeyword, keywordLevel: p.keywordLevel,
  }));

  const ideas = await suggestContentIdeas(
    brand.name, brand.description, recentScripts, DAILY_IDEA_COUNT, recentClassifications
  );

  const now = new Date();
  const rows = ideas.map((idea) => ({
    id: newId("idea"),
    brandId,
    date: today,
    idea,
    used: false,
    createdAt: now,
  }));
  if (rows.length > 0) {
    await db.insert(dailyIdeas).values(rows);
  }
  return rows.map((r) => ({ id: r.id, idea: r.idea, used: r.used }));
}

export async function forceRegenerateDailyIdeas(brandId: string): Promise<DailyIdea[]> {
  const today = todayDateKeyWita();
  await db.delete(dailyIdeas).where(and(eq(dailyIdeas.brandId, brandId), eq(dailyIdeas.date, today)));
  return getOrGenerateDailyIdeas(brandId);
}

export async function markDailyIdeaUsed(ideaId: string): Promise<void> {
  await db.update(dailyIdeas).set({ used: true }).where(eq(dailyIdeas.id, ideaId));
}

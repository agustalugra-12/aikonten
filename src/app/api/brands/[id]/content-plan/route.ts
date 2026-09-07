import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dailyIdeas, projects, contentTypes } from "@/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import { getMediumPerformance, classifyIdeaExperimentTier } from "@/lib/ai/contentVariety";
import { parseStoredPlatformFitScores } from "@/lib/ai/dailyContentPlanner";
import { getUserId, getOwnedBrand } from "@/lib/session";

// Content Planning Engine (2026-08-19, PRD "AI Content Intelligence" §22-23) - SCOPE
// DIKURANGI dari PRD asli: PRD minta planning berbasis SWOT+Competitor+Audience+Content
// Goal+Historical Performance+Content Diversity - SWOT/Competitor masih BLOCKED
// (keputusan bisnis Agus soal sumber data, lihat docs/HANDOFF_OPENCODE_2026-08-18.md).
// Versi ini murni VIEW read-only atas data yang SUDAH ADA (dailyIdeas = ide belum
// diproduksi, projects = konten sudah/sedang diproduksi) dalam 1 tabel kronologis -
// TIDAK mengubah pipeline generate/produksi sama sekali (itu resiko jauh lebih besar,
// di luar scope pass ini). Historical Performance & Content Diversity SUDAH otomatis
// tercermin krn keduanya sudah mempengaruhi dailyIdeas/projects yang di-query di sini.
const DEFAULT_WINDOW_DAYS = 14;

type PlanRow = {
  id: string;
  kind: "idea" | "project";
  date: string;
  contentType: string | null;
  pillar: string | null;
  topicOrHook: string;
  structure: string | null;
  status: string;
  // Experiment Engine (2026-08-25, PRD §24, observational - lihat catatan lengkap di
  // contentVariety.ts's classifyIdeaExperimentTier) - null utk row "project" (konten
  // sudah diproduksi, tier cuma relevan sblm produksi).
  experimentTier: "proven" | "variation" | "experiment" | null;
  // Platform Fit Score (2026-08-26, PRD §19, Task Plan 5) - {} utk row "project" (skor
  // ini soal ide sblm produksi, lihat researchTopics.ts's ScoredIdea).
  platformFitScores: Record<string, number>;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  const { id: brandId } = await params;
  if (!(await getOwnedBrand(userId, brandId))) {
    return NextResponse.json({ error: "Brand tidak ditemukan" }, { status: 404 });
  }
  const days = Number(req.nextUrl.searchParams.get("days")) || DEFAULT_WINDOW_DAYS;
  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const windowStartDateStr = windowStart.toISOString().slice(0, 10);

  const ideas = await db
    .select()
    .from(dailyIdeas)
    .where(and(eq(dailyIdeas.brandId, brandId), gte(dailyIdeas.date, windowStartDateStr)))
    .orderBy(desc(dailyIdeas.date));
  const mediumPerf = await getMediumPerformance(brandId);

  const proj = await db
    .select({
      id: projects.id,
      createdAt: projects.createdAt,
      status: projects.status,
      pillar: projects.pillar,
      hookType: projects.hookType,
      structureTemplate: projects.structureTemplate,
      script: projects.script,
      contentTypeName: contentTypes.name,
    })
    .from(projects)
    .leftJoin(contentTypes, eq(projects.contentTypeId, contentTypes.id))
    .where(and(eq(projects.brandId, brandId), gte(projects.createdAt, windowStart)))
    .orderBy(desc(projects.createdAt));

  const rows: PlanRow[] = [
    ...ideas.map((i): PlanRow => ({
      id: i.id,
      kind: "idea",
      date: i.date,
      contentType: i.contentType,
      pillar: null,
      topicOrHook: i.idea,
      structure: null,
      status: i.used ? "Sudah dipakai" : "Belum dipakai",
      experimentTier: classifyIdeaExperimentTier(i.contentType, mediumPerf),
      platformFitScores: parseStoredPlatformFitScores(i.platformFitScores),
    })),
    ...proj.map((p): PlanRow => ({
      id: p.id,
      kind: "project",
      date: p.createdAt.toISOString().slice(0, 10),
      contentType: p.contentTypeName,
      pillar: p.pillar,
      topicOrHook: p.hookType || (p.script || "").slice(0, 100),
      structure: p.structureTemplate,
      status: p.status,
      experimentTier: null,
      platformFitScores: {},
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return NextResponse.json({ windowDays: days, rows });
}

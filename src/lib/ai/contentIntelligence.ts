import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq, desc, isNotNull, gte } from "drizzle-orm";

// Content Intelligence Score (PRD §36) - skor kualitas konten berdasarkan
// data yang sudah ada (deterministic, bukan AI-based). Bisa ditingkatkan
// nanti dengan AI-based scoring kalau diperlukan.

export type ScoreDimension = {
  name: string;
  score: number; // 0-100
  weight: number; // bobot relative
};

export type ContentIntelligenceResult = {
  dimensions: ScoreDimension[];
  overallScore: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
};

const DIMENSION_WEIGHTS = {
  strategyFit: 0.20,
  hookQuality: 0.15,
  contentDiversity: 0.20,
  visualQuality: 0.15,
  brandFit: 0.15,
  ctaQuality: 0.10,
  productionQuality: 0.05,
};

const RECENT_WINDOW = 20;

export async function calculateContentIntelligence(
  brandId: string,
  project: {
    pillar?: string | null;
    hookType?: string | null;
    structureTemplate?: string | null;
    similarityScore?: number | null;
    generatedCaption?: string | null;
    contentType?: string | null;
  }
): Promise<ContentIntelligenceResult> {
  // Ambil data histori untuk diversity check
  const recent = await db
    .select({
      pillar: projects.pillar,
      hookType: projects.hookType,
      structureTemplate: projects.structureTemplate,
      contentTypeId: projects.contentTypeId,
    })
    .from(projects)
    .where(and(eq(projects.brandId, brandId), eq(projects.status, "published")))
    .orderBy(desc(projects.createdAt))
    .limit(RECENT_WINDOW);

  // 1. Strategy Fit (0-100): apakah pillar sesuai distribusi target
  const pillarCounts = new Map<string, number>();
  for (const r of recent) {
    if (r.pillar) pillarCounts.set(r.pillar, (pillarCounts.get(r.pillar) || 0) + 1);
  }
  const currentPillarCount = project.pillar ? (pillarCounts.get(project.pillar) || 0) : 0;
  const strategyFit = Math.max(0, 100 - currentPillarCount * 15); // makin sering dipakai, makin rendah

  // 2. Hook Quality (0-100): berdasarkan variety hook type
  const hookTypes = new Set(recent.map((r) => r.hookType).filter(Boolean));
  const hookQuality = Math.min(100, hookTypes.size * 20 + 20); // lebih banyak variety = lebih bagus

  // 3. Content Diversity (0-100): kombinasi pillar + structure + contentType variety
  const structures = new Set(recent.map((r) => r.structureTemplate).filter(Boolean));
  const contentTypes = new Set(recent.map((r) => r.contentTypeId).filter(Boolean));
  const contentDiversity = Math.min(100, (pillarCounts.size * 15 + structures.size * 10 + contentTypes.size * 15) + 20);

  // 4. Visual Quality (0-100): inverse dari similarity score (lower similarity = better)
  const similarity = project.similarityScore ?? 0;
  const visualQuality = Math.max(0, 100 - similarity);

  // 5. Brand Fit (0-100): apakah pillar termasuk daftar brand
  const brandFit = project.pillar ? 85 : 50; // sederhana: ada pillar = 85, tidak = 50

  // 6. CTA Quality (0-100): apakah caption mengandung CTA
  const caption = (project.generatedCaption || "").toLowerCase();
  const hasCTA = /chat\s*admin|hubungi|wa\s*admin|pesan|booking|kunjungi|klik/i.test(caption);
  const ctaQuality = hasCTA ? 90 : 40;

  // 7. Production Quality (0-100): berdasarkan content type
  const productionQuality = project.contentType ? 85 : 70;

  // Hitung overall score
  const dimensions: ScoreDimension[] = [
    { name: "Strategy Fit", score: strategyFit, weight: DIMENSION_WEIGHTS.strategyFit },
    { name: "Hook Quality", score: hookQuality, weight: DIMENSION_WEIGHTS.hookQuality },
    { name: "Content Diversity", score: contentDiversity, weight: DIMENSION_WEIGHTS.contentDiversity },
    { name: "Visual Quality", score: visualQuality, weight: DIMENSION_WEIGHTS.visualQuality },
    { name: "Brand Fit", score: brandFit, weight: DIMENSION_WEIGHTS.brandFit },
    { name: "CTA Quality", score: ctaQuality, weight: DIMENSION_WEIGHTS.ctaQuality },
    { name: "Production Quality", score: productionQuality, weight: DIMENSION_WEIGHTS.productionQuality },
  ];

  const overallScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0)
  );

  let grade: ContentIntelligenceResult["grade"] = "F";
  if (overallScore >= 90) grade = "A";
  else if (overallScore >= 80) grade = "B";
  else if (overallScore >= 70) grade = "C";
  else if (overallScore >= 60) grade = "D";

  return { dimensions, overallScore, grade };
}

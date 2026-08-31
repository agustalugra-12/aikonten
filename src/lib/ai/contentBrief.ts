// Content Brief (PRD §12, Task Plan 6) - VIEW yg DIRAKIT dari data yg SUDAH ADA, bukan
// entity baru/panggilan AI baru (per instruksi PRD sendiri: "upgrade existing brief...
// jangan buat sistem brief kedua"). objective/targetAudience dari Content DNA brand
// (Plan 5), platform dari socialAccounts brand (SEMUA yg terhubung - app ini publish ke
// semua akun sekaligus, tidak ada publish selektif per platform), sisanya dari kolom
// project yg sudah diklasifikasi generateCaptionAndHashtags/generateCaptionForImages
// (pillar/angle/hookType/structureTemplate/visualDirection/ctaText) + daily_ideas yg
// dibawa masuk saat ide jadi project (ideaScore/ideaReasoning, lihat autoContent.ts).
export type ContentBrief = {
  objective: string | null;
  targetAudience: string | null;
  platforms: string[];
  pillar: string | null;
  topic: string | null;
  angle: string | null;
  hook: string | null;
  coreMessage: string | null;
  storytellingStructure: string | null;
  visualDirection: string | null;
  cta: string | null;
  referencePatterns: string | null;
  score: number | null;
  // Retention Intelligence (2026-08-26, PRD §14, Task Plan 7) - lihat retentionIntelligence.ts.
  retentionRisks: string[];
};

export function buildContentBrief(
  project: {
    script: string | null;
    pillar: string | null;
    angle: string | null;
    hookType: string | null;
    structureTemplate: string | null;
    generatedCaption: string | null;
    visualDirection: string | null;
    ctaText: string | null;
    ideaScore: number | null;
    ideaReasoning: string | null;
    retentionRisks: string | null;
  },
  brand: { contentGoals: string | null; targetAudience: string | null } | null,
  connectedPlatforms: string[]
): ContentBrief {
  return {
    objective: brand?.contentGoals ?? null,
    targetAudience: brand?.targetAudience ?? null,
    platforms: connectedPlatforms,
    pillar: project.pillar,
    topic: project.script,
    angle: project.angle,
    hook: project.hookType,
    coreMessage: project.generatedCaption,
    storytellingStructure: project.structureTemplate,
    visualDirection: project.visualDirection,
    cta: project.ctaText,
    referencePatterns: project.ideaReasoning,
    score: project.ideaScore,
    retentionRisks: parseRetentionRisks(project.retentionRisks),
  };
}

function parseRetentionRisks(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

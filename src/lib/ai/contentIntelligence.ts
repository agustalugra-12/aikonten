import { db } from "@/db";
import { projects, brands } from "@/db/schema";
import { and, eq, desc, isNotNull, gte } from "drizzle-orm";
import { getOpenAIClient } from "./openaiClient";
import { buildBrandIdentityBlock } from "./generateContent";

// Content Intelligence Score (PRD §36, "Creative Director" role §13) - skor kualitas
// konten. Direvisi 2026-08-25 (Task Plan 2) - 3 dari 7 dimensi ASLI cuma heuristik yg
// tidak benar2 mengukur apa yg diklaim (lihat catatan judgeCreativeQuality di bawah),
// diganti penilaian AI beneran (gpt-4.1-mini, pola sama dgn trendAdaptation.ts/
// competitorAnalysis.ts - 1 panggilan per invocation, JSON-structured, fallback aman
// kalau API gagal). strategyFit/contentDiversity/visualQuality TETAP deterministic -
// itu real distribution/similarity check, AI tidak perlu menebak angka yg sudah bisa
// dihitung pasti dari DB.

export type ScoreDimension = {
  name: string;
  score: number; // 0-100
  weight: number; // bobot relative
};

export type ContentIntelligenceResult = {
  dimensions: ScoreDimension[];
  overallScore: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  // AI Creative Director reasoning (2026-08-25) - opsional, belum ada UI consumer, tapi
  // datanya sudah tersedia utk DraftReview.tsx pakai belakangan kalau Agus mau.
  creativeReasoning: string;
};

// productionQuality DIHAPUS (2026-08-25) - binary contentType?85:70, nyaris selalu 85
// di titik pipeline ini (contentType SELALU sudah keisi), bobotnya cuma noise. 0.05-nya
// dipindah ke contentDiversity (satu2nya dimensi deterministic lain yg BENAR2 variatif).
// Exported (bukan cuma internal) - dipakai scripts/verify-content-intelligence.ts biar
// verify beneran import fungsi asli, bukan duplikat logic yg bisa nyimpang.
export const DIMENSION_WEIGHTS = {
  strategyFit: 0.20,
  hookQuality: 0.15,
  contentDiversity: 0.25,
  visualQuality: 0.15,
  brandFit: 0.15,
  ctaQuality: 0.10,
};

const RECENT_WINDOW = 20;

type CreativeQualityJudgment = { hookQuality: number; brandFit: number; ctaQuality: number; reasoning: string };

export function clampScore(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback;
}

// AI Creative Director judgment (2026-08-25, PRD §13) - 3 dimensi yg heuristik LAMA tidak
// bisa ukur beneran: hookQuality (lama = variasi hook brand-wide, BUKAN kekuatan hook
// project INI), brandFit (lama = binary ada-pillar-atau-tidak), ctaQuality (lama = regex
// keyword presence, bukan efektivitas/kealamian). AI baca caption/script project INI
// langsung, jauh lebih dekat ke maksud aslinya. Return heuristicFallback kalau AI gagal
// (API down dll) - JANGAN gagalkan seluruh skor cuma krn 1 panggilan AI gagal, pola sama
// dgn try/catch best-effort di dailyContentPlanner.ts's Context Firewall.
async function judgeCreativeQuality(
  brandName: string,
  brandContext: string,
  script: string | null,
  caption: string | null,
  hookType: string | null,
  heuristicFallback: CreativeQualityJudgment
): Promise<CreativeQualityJudgment> {
  if (!caption && !script) return heuristicFallback;
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            `Kamu Creative Director untuk brand "${brandName}". Konteks brand: ${brandContext || "(tidak ada deskripsi brand)"}.\n\n` +
            "Nilai SATU konten (script + caption final) di 3 dimensi (0-100 tiap dimensi):\n" +
            "- hookQuality: seberapa KUAT hook/pembuka konten INI menarik perhatian di 3 detik/baris " +
            "pertama (bukan soal variasi tipe hook, murni kekuatan hook konten ini sendiri).\n" +
            "- brandFit: seberapa cocok gaya bahasa/angle konten ini dgn identitas brand di atas.\n" +
            "- ctaQuality: seberapa natural & efektif call-to-action-nya (BUKAN sekadar ada/tidaknya " +
            "kata kunci CTA - CTA yg maksa/generik dinilai rendah walau ada kata kuncinya).\n" +
            "reasoning: alasan singkat gabungan ketiganya (maks 25 kata, boleh Bahasa Indonesia).",
        },
        {
          role: "user",
          content:
            `Hook type yg dipakai: ${hookType || "(tidak ada)"}\n` +
            `Script/brief: ${(script || "(tidak ada)").slice(0, 1000)}\n` +
            `Caption final: ${(caption || "(tidak ada)").slice(0, 1000)}\n\n` +
            `Balas HARUS JSON valid (tanpa markdown code fence): {"hookQuality": 0-100, ` +
            `"brandFit": 0-100, "ctaQuality": 0-100, "reasoning": "..."}`,
        },
      ],
      temperature: 0.3,
    });
    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned);
    return {
      hookQuality: clampScore(parsed?.hookQuality, heuristicFallback.hookQuality),
      brandFit: clampScore(parsed?.brandFit, heuristicFallback.brandFit),
      ctaQuality: clampScore(parsed?.ctaQuality, heuristicFallback.ctaQuality),
      reasoning: typeof parsed?.reasoning === "string" ? parsed.reasoning : heuristicFallback.reasoning,
    };
  } catch (err) {
    console.error("[contentIntelligence] gagal judgeCreativeQuality, pakai fallback heuristik:", err);
    return heuristicFallback;
  }
}

export async function calculateContentIntelligence(
  brandId: string,
  project: {
    pillar?: string | null;
    hookType?: string | null;
    structureTemplate?: string | null;
    similarityScore?: number | null;
    generatedCaption?: string | null;
    contentType?: string | null;
    script?: string | null;
  }
): Promise<ContentIntelligenceResult> {
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
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

  // Fallback heuristik (dipakai kalau AI judgment gagal) - PERSIS logic lama.
  const hookTypesSeen = new Set(recent.map((r) => r.hookType).filter(Boolean));
  const hookQualityFallback = Math.min(100, hookTypesSeen.size * 20 + 20);
  const brandFitFallback = project.pillar ? 85 : 50;
  const captionLower = (project.generatedCaption || "").toLowerCase();
  const hasCTA = /chat\s*admin|hubungi|wa\s*admin|pesan|booking|kunjungi|klik/i.test(captionLower);
  const ctaQualityFallback = hasCTA ? 90 : 40;

  // 2-4. Hook Quality / Brand Fit / CTA Quality - dinilai AI (Creative Director, §13),
  // fallback ke heuristik lama kalau AI gagal (lihat judgeCreativeQuality di atas).
  // Content DNA (2026-08-26, PRD §4, Task Plan 5) - brandContext SEBELUM ini cuma
  // description||knowledgeSite (nyaris kosong utk brand tanpa description) - sekarang
  // pakai field identitas terstruktur juga kalau ada, jauh lebih kaya utk judgment brandFit.
  const brandContext = (brand?.description || "") + buildBrandIdentityBlock(brand);
  const judged = await judgeCreativeQuality(
    brand?.name || "",
    brandContext || brand?.knowledgeSite || "",
    project.script ?? null,
    project.generatedCaption ?? null,
    project.hookType ?? null,
    { hookQuality: hookQualityFallback, brandFit: brandFitFallback, ctaQuality: ctaQualityFallback, reasoning: "" }
  );
  const { hookQuality, brandFit, ctaQuality, reasoning } = judged;

  // 3. Content Diversity (0-100): kombinasi pillar + structure + contentType variety
  const structures = new Set(recent.map((r) => r.structureTemplate).filter(Boolean));
  const contentTypes = new Set(recent.map((r) => r.contentTypeId).filter(Boolean));
  const contentDiversity = Math.min(100, (pillarCounts.size * 15 + structures.size * 10 + contentTypes.size * 15) + 20);

  // 4. Visual Quality (0-100): inverse dari similarity score (lower similarity = better)
  const similarity = project.similarityScore ?? 0;
  const visualQuality = Math.max(0, 100 - similarity);

  // Hitung overall score
  const dimensions: ScoreDimension[] = [
    { name: "Strategy Fit", score: strategyFit, weight: DIMENSION_WEIGHTS.strategyFit },
    { name: "Hook Quality", score: hookQuality, weight: DIMENSION_WEIGHTS.hookQuality },
    { name: "Content Diversity", score: contentDiversity, weight: DIMENSION_WEIGHTS.contentDiversity },
    { name: "Visual Quality", score: visualQuality, weight: DIMENSION_WEIGHTS.visualQuality },
    { name: "Brand Fit", score: brandFit, weight: DIMENSION_WEIGHTS.brandFit },
    { name: "CTA Quality", score: ctaQuality, weight: DIMENSION_WEIGHTS.ctaQuality },
  ];

  const overallScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0)
  );

  let grade: ContentIntelligenceResult["grade"] = "F";
  if (overallScore >= 90) grade = "A";
  else if (overallScore >= 80) grade = "B";
  else if (overallScore >= 70) grade = "C";
  else if (overallScore >= 60) grade = "D";

  return { dimensions, overallScore, grade, creativeReasoning: reasoning };
}

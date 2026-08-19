import { eq } from "drizzle-orm";
import { db } from "@/db";
import { brands, competitors } from "@/db/schema";
import { getOpenAIClient } from "./openaiClient";
import { generateCompetitorIntelligence } from "./competitorAnalysis";
import { getMonthlyReportData } from "@/lib/reports/monthlyReportData";
import {
  getRecentPillarUsage,
  getRecentStructureAndHookUsage,
  buildPillarAvoidInstruction,
  buildHookAvoidInstruction,
} from "./contentVariety";
import { pillarTargetPercentForSite, PELANGI_PILLARS, GENERIC_PILLARS } from "./generateContent";

// AI Content Planning Engine - versi PENUH (2026-08-19, PRD "AI Content Intelligence"
// §22-23, lanjutan dari versi read-only c5dad80 setelah SWOT/Competitor unblocked
// e4264c2). PRD asli minta 6 sinyal (SWOT + Competitor + Audience + Content Goal +
// Historical Performance + Content Diversity) - Audience & Content Goal TIDAK ADA
// sumber data di codebase ini sama sekali (dicek 2026-08-19, sama disiplin dgn 5
// metrik PRD §32 yg sengaja tidak difabrikasi di monthlyReportData.ts) - dibangun
// pakai 4 sinyal yg REAL: SWOT+Competitor (competitorAnalysis.ts, sudah ada),
// Historical Performance (monthlyReportData.ts, sudah ada), Content Diversity
// (contentVariety.ts avoid-instruction, sudah ada - pola sama TIER 1-3, BUKAN
// mekanisme baru).
//
// NON-BINDING by design (konsisten pola SELURUH AI call lain di app ini): fungsi ini
// HANYA mengembalikan draf saran, TIDAK PERNAH menulis ke manualIdeas sendiri - staf
// yang klik "Terima" per saran (lihat POST /api/brands/[id]/manual-ideas varian JSON)
// baru masuk manualIdeas (mekanisme FIFO yg SUDAH ADA, dikonsumsi otomatis oleh
// dailyContentPlanner - tidak ada pipeline baru yg dibuat di sini).
export type ContentPlanSuggestion = {
  pillar: string;
  topic: string;
  hookType: string;
  reasoning: string;
};

const SUGGESTION_COUNT = 5;

export async function generateContentPlanSuggestions(brandId: string): Promise<ContentPlanSuggestion[]> {
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) return [];

  const [comps, ownPerformance, pillarUsage, hookUsage] = await Promise.all([
    db.select().from(competitors).where(eq(competitors.brandId, brandId)),
    getMonthlyReportData(brandId, 30),
    getRecentPillarUsage(brandId),
    getRecentStructureAndHookUsage(brandId),
  ]);

  const intelligence = await generateCompetitorIntelligence(brand.name, comps, ownPerformance);

  const pillarList = brand.knowledgeSite === "pelangi" ? PELANGI_PILLARS : GENERIC_PILLARS;
  const targetPercent = pillarTargetPercentForSite(brand.knowledgeSite, brand.contentPillars);
  const pillarAvoid = buildPillarAvoidInstruction(pillarUsage.counts, targetPercent, pillarUsage.windowSize);
  const hookAvoid = buildHookAvoidInstruction(hookUsage.hookTypeCounts);

  const performaRingkas = `
Total konten tayang (30 hari terakhir): ${ownPerformance.totalContent}
Total views: ${ownPerformance.totalViews}
Konten terbaik: ${ownPerformance.bestContent ? `"${ownPerformance.bestContent.captionSnippet}" (${ownPerformance.bestContent.views} views)` : "tidak ada data"}
Konten terlemah: ${ownPerformance.worstContent ? `"${ownPerformance.worstContent.captionSnippet}" (${ownPerformance.worstContent.views} views)` : "tidak ada data"}
Performa per Pilar: ${ownPerformance.byPillar.map((b) => `${b.label} (${b.avgViews} views rata2)`).join(", ") || "tidak ada data"}
`.trim();

  const swotRingkas = [
    intelligence.swot.opportunity.length > 0 ? `Opportunity: ${intelligence.swot.opportunity.join("; ")}` : null,
    intelligence.swot.weakness.length > 0 ? `Weakness: ${intelligence.swot.weakness.join("; ")}` : null,
    intelligence.contentGap.opportunities.length > 0 ? `Content Gap (belum digarap kompetitor): ${intelligence.contentGap.opportunities.join("; ")}` : null,
  ].filter(Boolean).join("\n") || "(belum ada catatan kompetitor - lewati sinyal ini)";

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content:
          `Kamu perencana konten sosial media untuk brand "${brand.name}". Sarankan ${SUGGESTION_COUNT} ide ` +
          "konten BARU berdasarkan HANYA data yang diberikan di bawah (performa nyata brand, SWOT/content gap " +
          "kompetitor jika ada, dan instruksi variasi pilar/hook yang wajib dipatuhi). JANGAN mengarang fakta " +
          "kompetitor atau performa di luar yang diberikan. Pilar HARUS salah satu dari daftar yang diberikan. " +
          `Daftar pilar valid: ${pillarList.join(", ")}.` +
          (pillarAvoid ? ` ${pillarAvoid}` : "") +
          (hookAvoid ? ` ${hookAvoid}` : ""),
      },
      {
        role: "user",
        content:
          `PERFORMA BRAND (30 hari terakhir):\n${performaRingkas}\n\n` +
          `SINYAL KOMPETITOR/SWOT:\n${swotRingkas}\n\n` +
          `Balas HARUS JSON valid (tanpa markdown code fence): {"suggestions": [{"pillar": "...", ` +
          `"topic": "topik/ide konten spesifik, 1 kalimat", "hookType": "curiosity|problem|contrarian|question|story|data|warning|direct_benefit|mystery|comparison", ` +
          `"reasoning": "kenapa ide ini relevan sekarang, maks 20 kata, sebutkan sinyal yang dipakai"}]}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    return suggestions
      .filter((s: unknown): s is ContentPlanSuggestion => {
        const cand = s as Partial<ContentPlanSuggestion>;
        return typeof cand?.pillar === "string" && typeof cand?.topic === "string" && typeof cand?.hookType === "string";
      })
      .slice(0, SUGGESTION_COUNT)
      .map((s: ContentPlanSuggestion) => ({
        pillar: s.pillar,
        topic: s.topic,
        hookType: s.hookType,
        reasoning: typeof s.reasoning === "string" ? s.reasoning : "",
      }));
  } catch {
    return [];
  }
}

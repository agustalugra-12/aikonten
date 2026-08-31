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
import { pillarTargetPercentForSite, PELANGI_PILLARS, GENERIC_PILLARS, HOOK_TYPES } from "./generateContent";

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
  // Content Strategist explanation (2026-08-26, PRD §11, Task Plan 6) - reasoning di atas
  // TETAP ringkasan singkat (backward compatible), 4 field ini pecahannya biar Agus liat
  // penalaran per-dimensi. whyPlatform SENGAJA tidak ada field terpisah - app ini publish
  // ke SEMUA akun terhubung sekaligus (tidak ada publish selektif per platform), jadi
  // "why platform" spesifik akan cuma karangan; platform fit sudah dicover Plan 5's
  // platformFitScores di tahap idea-scoring (suggestScoredContentIdeas), bukan di sini.
  whyNow: string;
  whyAudience: string;
  whyBrand: string;
  risk: string;
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
          `hookType WAJIB SALAH SATU PERSIS dari: ${HOOK_TYPES.map((h) => `"${h}"`).join(", ")} - jangan ` +
          `pakai istilah lain di luar daftar itu.\n\n` +
          "Utk tiap saran, JUGA pecah penalarannya jadi 4 bagian terpisah (semua maks 15 kata, " +
          "Bahasa Indonesia, spesifik & jujur - bukan pujian generik):\n" +
          "- whyNow: kenapa PAS diusulkan sekarang (sinyal performa/kompetitor/gap terkini)\n" +
          "- whyAudience: kenapa relevan utk audiens brand ini\n" +
          "- whyBrand: kenapa cocok sama identitas/pilar brand ini\n" +
          "- risk: potensi resiko/kelemahan ide ini (JANGAN dikosongkan cuma krn ide bagus - " +
          "selalu ada trade-off, mis. 'topik sudah agak sering diangkat' atau 'butuh data " +
          "konkret yg mungkin belum ada')\n\n" +
          `Balas HARUS JSON valid (tanpa markdown code fence): {"suggestions": [{"pillar": "...", ` +
          `"topic": "topik/ide konten spesifik, 1 kalimat", "hookType": "...", ` +
          `"reasoning": "ringkasan singkat kenapa ide ini relevan sekarang, maks 20 kata", ` +
          `"whyNow": "...", "whyAudience": "...", "whyBrand": "...", "risk": "..."}]}`,
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
        // Backstop kode (2026-08-19) - prompt sudah instruksikan daftar hook baku, tapi
        // model sesekali improvisasi istilah sendiri (mis. "engagement", bukan salah
        // satu HOOK_TYPES) - sama disiplin dgn normalizeHookType di generateContent.ts,
        // jangan percaya prompt sendirian. Fallback "curiosity" (paling netral/aman)
        // drpd buang seluruh saran cuma krn label hook meleset.
        hookType: (HOOK_TYPES as readonly string[]).includes(s.hookType) ? s.hookType : "curiosity",
        reasoning: typeof s.reasoning === "string" ? s.reasoning : "",
        whyNow: typeof s.whyNow === "string" ? s.whyNow : "",
        whyAudience: typeof s.whyAudience === "string" ? s.whyAudience : "",
        whyBrand: typeof s.whyBrand === "string" ? s.whyBrand : "",
        risk: typeof s.risk === "string" ? s.risk : "",
      }));
  } catch {
    return [];
  }
}

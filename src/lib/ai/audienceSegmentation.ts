import { getOpenAIClient } from "./openaiClient";
import type { MonthlyReportData } from "@/lib/reports/monthlyReportData";

// Audience Segmentation (PRD P2) - Kelompokkan konten berdasarkan performa
// dimensi (pillar/type/hook/structure) untuk mengidentifikasi segmen audiens
// yang memiliki preferensi serupa. Zero cost: reuse gpt-4.1-mini, tanpa model ML
// atau clustering matematika.

export type SegmentProfile = {
  label: string;
  description: string;
  pillar: string;
  contentType: string;
  hookType: string;
  avgViews: number;
  avgEngagementRate: number;
  contentCount: number;
  performanceTier: "high" | "medium" | "low";
  recommendation: "scale_up" | "maintain" | "optimize" | "phase_out";
};

export type AudienceSegmentationResult = {
  segments: SegmentProfile[];
  summary: string;
  totalAnalyzed: number;
};

const EMPTY_RESULT: AudienceSegmentationResult = {
  segments: [],
  summary: "Tidak cukup data untuk segmentasi audiens (minimal 5 konten tayang).",
  totalAnalyzed: 0,
};

export async function generateAudienceSegmentation(
  brandName: string,
  ownPerformance: MonthlyReportData,
): Promise<AudienceSegmentationResult> {
  if (ownPerformance.totalContent < 5) {
    return EMPTY_RESULT;
  }

  const systemPrompt = "Kamu adalah analis data audiens konten sosial media. "
    + "Tugasmu: dari data performa brand berikut, kelompokkan konten menjadi 3-5 "
    + "segmen audiens berdasarkan kombinasi pillar, content type, hook type, "
    + "dan structure yang memiliki performa serupa. Fokus pada avgViews dan "
    + "avgEngagementRate. Hasilkan 2-5 segmen dengan label singkat dan "
    + "rekomendasi action (scale_up/maintain/optimize/phase_out). ";

  const userPrompt = "BRAND: " + brandName + "\n\n"
    + "PERFORMA PER PILAR: " + ownPerformance.byPillar.map((b) => b.label + "(" + b.avgViews + "v," + b.count + "c)").join(" | ")
    + "\nPERFORMA PER TIPE KONTEN: " + ownPerformance.byContentType.map((b) => b.label + "(" + b.avgViews + "v," + b.count + "c)").join(" | ")
    + "\nPERFORMA PER HOOK: " + ownPerformance.byHookType.map((b) => b.label + "(" + b.avgViews + "v," + b.count + "c)").join(" | ")
    + "\nPERFORMA PER STRUKTUR: " + ownPerformance.byStructure.map((b) => b.label + "(" + b.avgViews + "v," + b.count + "c)").join(" | ")
    + "\nTOTAL KONTEN TAYANG (" + ownPerformance.windowDays + " hari): " + ownPerformance.totalContent
    + "\nAVG ENGAGEMENT RATE: " + (ownPerformance.avgEngagementRate !== null ? ownPerformance.avgEngagementRate.toFixed(2) + "%" : "tidak ada data")
    // Bug nyata 2026-08-20 (sesi OpenCode model gratisan yang macet): prompt sebelumnya
    // TIDAK PERNAH minta output JSON sama sekali, beda dari pola yang sudah baku di
    // competitorAnalysis.ts/trendAdaptation.ts - GPT balas prosa bebas, JSON.parse selalu
    // gagal, jatuh ke catch -> EMPTY_RESULT diam-diam SETIAP KALI dipanggil (fitur ini
    // sebenarnya tidak pernah bisa menghasilkan segmen apa pun sejak awal dibuat).
    + "\n\nBalas HARUS JSON valid (tanpa markdown code fence): {\"segments\": ["
    + "{\"label\": \"...\", \"description\": \"...\", \"pillar\": \"...\", \"contentType\": \"...\", "
    + "\"hookType\": \"...\", \"avgViews\": 0, \"avgEngagementRate\": 0, \"contentCount\": 0, "
    + "\"performanceTier\": \"high|medium|low\", \"recommendation\": \"scale_up|maintain|optimize|phase_out\"}"
    + "], \"summary\": \"...\"}";

  const client = getOpenAIClient();

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const segments: SegmentProfile[] = Array.isArray(parsed?.segments)
      ? parsed.segments
          .filter(
            (s: Record<string, unknown>) =>
              typeof s?.label === "string" && s.label.length > 0 &&
              typeof s?.pillar === "string" &&
              typeof s?.contentType === "string" &&
              typeof s?.hookType === "string" &&
              typeof s?.avgViews === "number" &&
              typeof s?.avgEngagementRate === "number" &&
              typeof s?.contentCount === "number" &&
              typeof s?.performanceTier === "string" &&
              ["high", "medium", "low"].includes(s.performanceTier) &&
              typeof s?.recommendation === "string" &&
              ["scale_up", "maintain", "optimize", "phase_out"].includes(s.recommendation)
          )
          .map((s: Record<string, unknown>) => ({
            label: String(s.label),
            description: typeof s?.description === "string" ? String(s.description) : s.label + " segment",
            pillar: String(s.pillar),
            contentType: String(s.contentType),
            hookType: String(s.hookType),
            avgViews: Number(s.avgViews),
            avgEngagementRate: typeof s?.avgEngagementRate === "number" ? Number(s.avgEngagementRate) : 0,
            contentCount: Number(s.contentCount),
            performanceTier: String(s.performanceTier) as SegmentProfile["performanceTier"],
            recommendation: String(s.recommendation) as SegmentProfile["recommendation"],
          }))
          .sort((a: SegmentProfile, b: SegmentProfile) => b.avgViews - a.avgViews)
          .slice(0, 5)
      : [];
    return {
      segments: segments,
      summary: typeof parsed?.summary === "string" ? parsed.summary : "Analisis segmentasi selesai.",
      totalAnalyzed: ownPerformance.totalContent,
    };
  } catch {
    return EMPTY_RESULT;
  }
}

export const SEGMENT_PERFORMANCE_TIERS: Record<SegmentProfile["performanceTier"], string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-red-100 text-red-800",
};

export const SEGMENT_RECOMMENDATION_LABELS: Record<SegmentProfile["recommendation"], string> = {
  scale_up: "Scale Up",
  maintain: "Pertahankan",
  optimize: "Optimize",
  phase_out: "Phase Out",
};
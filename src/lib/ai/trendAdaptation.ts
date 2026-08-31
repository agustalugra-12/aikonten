import { getOpenAIClient } from "./openaiClient";
import type { MonthlyReportData } from "@/lib/reports/monthlyReportData";

// Trend Adaptation (PRD §40) - AI infer tren dari data performa brand SENDIRI
// (bukan scraping API eksternal). Zero cost baru - reuse gpt-4.1-mini, pola sama
// dgn competitorAnalysis.ts. Data sumber: monthlyReportData (breakdown per pillar/
// content type/hook/structure) + competitorNotes (apa yg kompetitor sudah lakukan).
//
// "Trend" dalam konteks ini = pola performa yg menonjol dari data brand sendiri
// (mis. "konten educational dgn hook curiosity konsisten dpt views tinggi" atau
// "kompetitor mulai banyak bikin UGC" dari catatan staf). BUKAN trend eksternal
// real-time (Twitter trending, Google Trends) - itu butuh API berbayar.

export type TrendOpportunity = {
  trend: string;
  relevanceScore: number;      // 0-100, seberapa relevan dgn brand ini
  competitorUsage: "none" | "some" | "many"; // dari catatan kompetitor
  audienceRelevance: "low" | "medium" | "high"; // dari data engagement
  recommendation: "act_now" | "monitor" | "ignore";
  reasoning: string;
  // Context Firewall (2026-08-25, PRD "AI Konten Intelligence & Agency Upgrade" §5) -
  // sumbu KEDUA terpisah dari relevanceScore/recommendation di atas. Topik tren ini
  // sendiri bisa TIDAK relevan (recommendation="ignore") TAPI mekanisme di baliknya
  // (gaya hook, pacing, format) tetap bisa diadaptasi - PRD contoh persis: "topiknya
  // tidak relevan, tapi hook curiosity-nya punya mekanisme yang bisa diadaptasi".
  // null = benar2 tidak ada apa pun yang bisa diambil (IRRELEVANT murni). Diisi
  // walaupun recommendation="act_now"/"monitor" kalau ada mekanisme spesifik yang
  // bisa ditonjolkan (opsional di kasus itu, wajib dicoba di kasus "ignore").
  mechanismNote: string | null;
  // Trend Lifecycle Stage (2026-08-26, PRD §8, Task Plan 5) - sumbu KETIGA, terpisah dari
  // relevanceScore/recommendation (action-oriented: apa yg harus dilakukan) & mechanismNote
  // (Context Firewall §5). Ini soal SIKLUS HIDUP tren itu sendiri - tren yg sama2
  // relevanceScore tinggi bisa "rising" (baru mulai naik, worth act_now) atau "saturated"
  // (sudah terlalu banyak dipakai, act_now-nya beresiko generik) - recommendation TETAP
  // dihitung dari relevanceScore spt sebelumnya, trendStage cuma KONTEKS TAMBAHAN di
  // reasoning (prompt diminta pertimbangkan stage saat kasih reasoning, BUKAN gating baru).
  trendStage: "emerging" | "rising" | "saturated" | "declining" | "irrelevant";
};

export type TrendAdaptationResult = {
  trends: TrendOpportunity[];
  summary: string;
};

const EMPTY_RESULT: TrendAdaptationResult = {
  trends: [],
  summary: "Tidak ada data cukup untuk mendeteksi tren.",
};

// Context Firewall (2026-08-25, PRD §5, Task 1 Plan 1) - fungsi MURNI (dipisah dari
// dailyContentPlanner.ts supaya bisa diverifikasi tanpa DB/API, pola sama dgn
// contentVariety.ts's tally*/classify* functions). Ini FILTER-nya: buang tren yg
// genuinely tidak relevan (recommendation="ignore" DAN tidak ada mechanismNote) -
// topiknya TIDAK PERNAH dikirim ke prompt ide. Sisanya dikembalikan sbg string pendek:
// mechanismNote (kalau ada) atau "trend - reasoning" (kasus act_now/monitor biasa).
export function filterTrendsForContextFirewall(trends: TrendOpportunity[]): string[] {
  return trends
    .filter((t) => t.recommendation !== "ignore" || t.mechanismNote !== null)
    .map((t) => t.mechanismNote ?? `${t.trend} - ${t.reasoning}`);
}

export async function generateTrendAdaptation(
  brandName: string,
  competitors: { name: string; notes: string | null }[],
  ownPerformance: MonthlyReportData,
): Promise<TrendAdaptationResult> {
  // Guard: minimal ada data performa (pola sama dgn competitorAnalysis.ts)
  if (ownPerformance.totalContent < 3) {
    return EMPTY_RESULT;
  }

  const client = getOpenAIClient();

  const performaSendiri = `
Total konten tayang (${ownPerformance.windowDays} hari terakhir): ${ownPerformance.totalContent}
Total views: ${ownPerformance.totalViews}
Rata-rata engagement: ${ownPerformance.avgEngagementRate !== null ? ownPerformance.avgEngagementRate.toFixed(2) + "%" : "tidak ada data"}
Performa per Pilar: ${ownPerformance.byPillar.map((b) => `${b.label} (${b.avgViews} views rata2, ${b.count}x)`).join(", ") || "tidak ada data"}
Performa per Tipe Konten: ${ownPerformance.byContentType.map((b) => `${b.label} (${b.avgViews} views rata2, ${b.count}x)`).join(", ") || "tidak ada data"}
Performa per Hook: ${ownPerformance.byHookType.map((b) => `${b.label} (${b.avgViews} views rata2, ${b.count}x)`).join(", ") || "tidak ada data"}
Performa per Struktur: ${ownPerformance.byStructure.map((b) => `${b.label} (${b.avgViews} views rata2, ${b.count}x)`).join(", ") || "tidak ada data"}
Best content: ${ownPerformance.bestContent ? `"${ownPerformance.bestContent.captionSnippet.slice(0, 80)}..." (${ownPerformance.bestContent.views} views)` : "tidak ada data"}
Worst content: ${ownPerformance.worstContent ? `"${ownPerformance.worstContent.captionSnippet.slice(0, 80)}..." (${ownPerformance.worstContent.views} views)` : "tidak ada data"}
`.trim();

  const catatanKompetitor = competitors
    .filter((c) => (c.notes || "").trim().length > 10)
    .map((c) => `### ${c.name}\n${c.notes}`)
    .join("\n\n");

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          `Kamu analis strategi konten sosial media untuk brand "${brandName}". Kamu ` +
          "HANYA boleh menggunakan 2 sumber fakta yang diberikan di bawah: (1) data " +
          "performa brand sendiri yang sudah nyata (views, engagement, best/worst content), " +
          "(2) catatan kompetitor yang DITULIS STAF secara manual. JANGAN PERNAH mengarang " +
          "angka/fakta di luar data yang diberikan.\n\n" +
          "TUGAS: Identifikasi pola-pola menonjol (tren internal brand) dari data performa. " +
          "Contoh: 'konten educational dgn hook curiosity konsisten dpt views tinggi', " +
          "'pilar A underperforming meski sudah 5x dipakai', 'kompetitor mulai banyak " +
          "bikin UGC' (dari catatan staf). Untuk setiap tren, tentukan:\n" +
          "- relevanceScore (0-100): seberapa relevan/bermanfaat utk brand ini\n" +
          "- competitorUsage: 'none'/'some'/'many' (dari catatan kompetitor)\n" +
          "- audienceRelevance: 'low'/'medium'/'high' (dari data engagement)\n" +
          "- recommendation: 'act_now' (relevanceScore >=70 + engagement tinggi), " +
          "'monitor' (relevanceScore 40-69), atau 'ignore' (relevanceScore <40)\n" +
          "- trendStage: siklus hidup tren ini SENDIRI (BEDA dari recommendation di atas) - " +
          "'emerging' (baru mulai muncul, data masih sedikit), 'rising' (performa meningkat " +
          "konsisten), 'saturated' (sudah terlalu sering dipakai brand ini/kompetitor, makin " +
          "generik), 'declining' (performa mulai menurun), 'irrelevant' (tidak sesuai brand " +
          "ini sama sekali). Pertimbangkan stage ini di reasoning - mis. tren 'saturated' " +
          "walau relevanceScore tinggi TETAP layak diberi catatan hati2 di reasoning\n" +
          "- reasoning: alasan singkat (maks 20 kata)\n" +
          "- mechanismNote: KHUSUS kalau recommendation='ignore' - coba cari 1 MEKANISME " +
          "yang tetap bisa diadaptasi walau topiknya sendiri tidak relevan (mis. gaya " +
          "hook/pacing/format penyampaian, BUKAN topiknya). Contoh cara berpikir: 'topik " +
          "X tidak relevan utk brand ini, TAPI cara membuka dgn curiosity gap di 3 detik " +
          "pertama bisa diadaptasi'. Isi string singkat (maks 15 kata) HANYA kalau benar2 " +
          "ada mekanisme jelas, kalau tidak ada apa pun yang bisa diambil isi null (JANGAN " +
          "dipaksakan cari mekanisme kalau memang tidak ada).\n\n" +
          "Hasilkan 2-5 tren paling signifikan. Jangan dipaksakan kalau data tidak cukup " +
          "- lebih baik 2 tren bermakna dari 5 tren generik. Kategori yg tidak ada data " +
          "yg layak → array kosong.",
      },
      {
        role: "user",
        content:
          `PERFORMA BRAND SENDIRI:\n${performaSendiri}\n\n` +
          (catatanKompetitor ? `CATATAN KOMPETITOR:\n${catatanKompetitor}\n\n` : "") +
          `Balas HARUS JSON valid (tanpa markdown code fence): {"trends": [{"trend": "...", ` +
          `"relevanceScore": 0-100, "competitorUsage": "none|some|many", ` +
          `"audienceRelevance": "low|medium|high", "recommendation": "act_now|monitor|ignore", ` +
          `"trendStage": "emerging|rising|saturated|declining|irrelevant", ` +
          `"reasoning": "...", "mechanismNote": "..." atau null}], "summary": "ringkasan 1-2 kalimat"}`,
      },
    ],
    temperature: 0.4,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const trends: TrendOpportunity[] = Array.isArray(parsed?.trends)
      ? parsed.trends
          .filter((t: Record<string, unknown>) => typeof t?.trend === "string" && t.trend.length > 0)
          .map((t: Record<string, unknown>) => ({
            trend: String(t.trend),
            relevanceScore: typeof t.relevanceScore === "number" ? Math.min(100, Math.max(0, t.relevanceScore)) : 50,
            competitorUsage: ["none", "some", "many"].includes(String(t.competitorUsage)) ? String(t.competitorUsage) as TrendOpportunity["competitorUsage"] : "none",
            audienceRelevance: ["low", "medium", "high"].includes(String(t.audienceRelevance)) ? String(t.audienceRelevance) as TrendOpportunity["audienceRelevance"] : "low",
            recommendation: ["act_now", "monitor", "ignore"].includes(String(t.recommendation)) ? String(t.recommendation) as TrendOpportunity["recommendation"] : "monitor",
            trendStage: ["emerging", "rising", "saturated", "declining", "irrelevant"].includes(String(t.trendStage))
              ? String(t.trendStage) as TrendOpportunity["trendStage"]
              : "emerging",
            reasoning: String(t.reasoning || ""),
            mechanismNote: typeof t.mechanismNote === "string" && t.mechanismNote.trim().length > 0 ? t.mechanismNote.trim() : null,
          }))
      : [];
    return {
      trends: trends.slice(0, 5),
      summary: typeof parsed?.summary === "string" ? parsed.summary : "Analisis tren selesai.",
    };
  } catch {
    return EMPTY_RESULT;
  }
}

// Label & warna untuk UI (pola sama dgn contentVariety.ts, fatigueSummary.tsx)
export const TREND_RECOMMENDATION_LABELS: Record<TrendOpportunity["recommendation"], string> = {
  act_now: "Segera Eksekusi",
  monitor: "Pantau",
  ignore: "Abai",
};

export const TREND_RECOMMENDATION_COLORS: Record<TrendOpportunity["recommendation"], string> = {
  act_now: "bg-green-100 text-green-800",
  monitor: "bg-yellow-100 text-yellow-800",
  ignore: "bg-gray-100 text-gray-800",
};

export const TREND_COMPETITOR_LABELS: Record<TrendOpportunity["competitorUsage"], string> = {
  none: "Belum ada kompetitor",
  some: "Beberapa kompetitor",
  many: "Banyak kompetitor",
};

export const TREND_STAGE_LABELS: Record<TrendOpportunity["trendStage"], string> = {
  emerging: "Baru Muncul",
  rising: "Sedang Naik",
  saturated: "Jenuh",
  declining: "Menurun",
  irrelevant: "Tidak Relevan",
};

export const TREND_STAGE_COLORS: Record<TrendOpportunity["trendStage"], string> = {
  emerging: "bg-blue-100 text-blue-800",
  rising: "bg-green-100 text-green-800",
  saturated: "bg-orange-100 text-orange-800",
  declining: "bg-red-100 text-red-800",
  irrelevant: "bg-gray-100 text-gray-800",
};

export const TREND_AUDIENCE_LABELS: Record<TrendOpportunity["audienceRelevance"], string> = {
  low: "Relevansi rendah",
  medium: "Relevansi sedang",
  high: "Relevansi tinggi",
};

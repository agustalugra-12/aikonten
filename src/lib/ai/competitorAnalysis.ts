import { getOpenAIClient } from "./openaiClient";
import type { MonthlyReportData } from "@/lib/reports/monthlyReportData";

// Competitor Content Gap + SWOT Intelligence (2026-08-19, PRD §5-8, "kerjakan tanpa API
// berbayar" - keputusan Agus). AI di sini TIDAK PERNAH diberi akses browsing/API
// kompetitor apa pun - satu-satunya sumber fakta kompetitor adalah `competitorNotes`
// (catatan manual staf, PERSIS apa adanya) + `ownPerformance` (data performa brand
// SENDIRI yang sudah real, dari monthlyReportData.ts). Prompt eksplisit melarang
// mengarang fakta di luar itu - pola sama dgn seluruh AI call lain di app ini (rangkum
// data asli, jangan jadi sumber fakta).
export type Competitor = { id: string; name: string; notes: string | null };

export type CompetitorIntelligence = {
  contentGap: { competitorDoing: string[]; competitorMissing: string[]; opportunities: string[] };
  swot: { strength: string[]; weakness: string[]; opportunity: string[]; threat: string[] };
};

const EMPTY_RESULT: CompetitorIntelligence = {
  contentGap: { competitorDoing: [], competitorMissing: [], opportunities: [] },
  swot: { strength: [], weakness: [], opportunity: [], threat: [] },
};

export async function generateCompetitorIntelligence(
  brandName: string,
  competitors: Competitor[],
  ownPerformance: MonthlyReportData
): Promise<CompetitorIntelligence> {
  // Tidak ada kompetitor sama sekali dgn catatan berarti - jangan paksa AI menyimpulkan
  // dari kekosongan (pola sama dgn guard "data < 3" di monthlyStrategicRecommendation).
  const withNotes = competitors.filter((c) => (c.notes || "").trim().length > 10);
  if (withNotes.length === 0) {
    return EMPTY_RESULT;
  }

  const client = getOpenAIClient();
  const catatanKompetitor = withNotes
    .map((c) => `### ${c.name}\n${c.notes}`)
    .join("\n\n");
  const performaSendiri = `
Total konten tayang (${ownPerformance.windowDays} hari terakhir): ${ownPerformance.totalContent}
Total views: ${ownPerformance.totalViews}
Rata-rata engagement: ${ownPerformance.avgEngagementRate !== null ? ownPerformance.avgEngagementRate.toFixed(2) + "%" : "tidak ada data"}
Performa per Pilar: ${ownPerformance.byPillar.map((b) => `${b.label} (${b.avgViews} views rata2)`).join(", ") || "tidak ada data"}
Performa per Tipe Konten: ${ownPerformance.byContentType.map((b) => `${b.label} (${b.avgViews} views rata2)`).join(", ") || "tidak ada data"}
`.trim();

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          `Kamu analis strategi konten sosial media untuk brand "${brandName}". Kamu ` +
          "HANYA boleh menggunakan 2 sumber fakta yang diberikan di bawah: (1) catatan " +
          "kompetitor yang DITULIS STAF secara manual, (2) data performa brand sendiri " +
          "yang sudah nyata. JANGAN PERNAH mengarang angka/fakta kompetitor di luar " +
          "catatan yang diberikan - kalau catatan tidak menyebutkan sesuatu, JANGAN " +
          "diasumsikan/ditebak. Hasilkan: (A) Content Gap - apa yang kompetitor SERING " +
          "lakukan (dari catatan), apa yang JARANG/TIDAK PERNAH mereka lakukan (dari " +
          "catatan), dan peluang konten yang bisa diisi brand ini; (B) SWOT brand ini " +
          "(Strength/Weakness/Opportunity/Threat) berdasar kombinasi performa nyata " +
          "brand sendiri VS catatan kompetitor. Tiap item singkat (maks 15 kata), " +
          "spesifik, bukan generik. Kategori yang tidak ada yang layak disebut → array " +
          "kosong, jangan dipaksakan.",
      },
      {
        role: "user",
        content:
          `CATATAN KOMPETITOR (ditulis staf manual):\n${catatanKompetitor}\n\n` +
          `PERFORMA BRAND SENDIRI:\n${performaSendiri}\n\n` +
          `Balas HARUS JSON valid (tanpa markdown code fence): {"contentGap": ` +
          `{"competitorDoing": ["..."], "competitorMissing": ["..."], "opportunities": ["..."]}, ` +
          `"swot": {"strength": ["..."], "weakness": ["..."], "opportunity": ["..."], "threat": ["..."]}}`,
      },
    ],
    temperature: 0.4,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    return {
      contentGap: {
        competitorDoing: Array.isArray(parsed?.contentGap?.competitorDoing) ? parsed.contentGap.competitorDoing : [],
        competitorMissing: Array.isArray(parsed?.contentGap?.competitorMissing) ? parsed.contentGap.competitorMissing : [],
        opportunities: Array.isArray(parsed?.contentGap?.opportunities) ? parsed.contentGap.opportunities : [],
      },
      swot: {
        strength: Array.isArray(parsed?.swot?.strength) ? parsed.swot.strength : [],
        weakness: Array.isArray(parsed?.swot?.weakness) ? parsed.swot.weakness : [],
        opportunity: Array.isArray(parsed?.swot?.opportunity) ? parsed.swot.opportunity : [],
        threat: Array.isArray(parsed?.swot?.threat) ? parsed.swot.threat : [],
      },
    };
  } catch {
    return EMPTY_RESULT;
  }
}

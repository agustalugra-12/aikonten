import { getOpenAIClient } from "./openaiClient";
import type { MonthlyReportData } from "@/lib/reports/monthlyReportData";

// Monthly Strategic Recommendation (2026-08-19, PRD §33) - AI membaca breakdown performa
// NYATA (bukan mengarang) dari monthlyReportData.ts, menghasilkan rekomendasi
// Continue/Reduce/Stop/Increase/Test. Pola sama dgn buildPerformanceInsightBlock di
// performanceLearning.ts - AI cuma MERANGKUM data asli jadi bahasa manusia, tidak pernah
// diminta mengarang angka.
export type StrategicRecommendation = {
  continue: string[];
  reduce: string[];
  stop: string[];
  increase: string[];
  test: string[];
};

const EMPTY_RECOMMENDATION: StrategicRecommendation = { continue: [], reduce: [], stop: [], increase: [], test: [] };

export async function generateStrategicRecommendation(data: MonthlyReportData): Promise<StrategicRecommendation> {
  // Data terlalu sedikit utk kesimpulan bermakna - JUJUR kembalikan kosong, JANGAN
  // paksa AI menyimpulkan dari sampel kecil yg menyesatkan (pola sama persis dgn guard
  // "withData.length < 3" di buildPerformanceInsightBlock).
  if (data.byContentType.length === 0 && data.byPillar.length === 0) {
    return EMPTY_RECOMMENDATION;
  }

  const client = getOpenAIClient();
  const ringkasan = `
Total konten tayang: ${data.totalContent}
Total views: ${data.totalViews}
Rata-rata engagement rate: ${data.avgEngagementRate !== null ? data.avgEngagementRate.toFixed(2) + "%" : "tidak ada data"}

Performa per Tipe Konten (rata-rata views):
${data.byContentType.map((b) => `- ${b.label}: ${b.avgViews} views (${b.count} konten)`).join("\n") || "(tidak ada data)"}

Performa per Pilar:
${data.byPillar.map((b) => `- ${b.label}: ${b.avgViews} views (${b.count} konten)`).join("\n") || "(tidak ada data)"}

Performa per Tipe Hook:
${data.byHookType.map((b) => `- ${b.label}: ${b.avgViews} views (${b.count} konten)`).join("\n") || "(tidak ada data)"}

Performa per Struktur Video:
${data.byStructure.map((b) => `- ${b.label}: ${b.avgViews} views (${b.count} konten)`).join("\n") || "(tidak ada data)"}
`.trim();

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "Kamu analis strategi konten sosial media. Berdasar data performa NYATA yang " +
          "diberikan (JANGAN mengarang angka di luar data ini), hasilkan rekomendasi " +
          "strategis dalam 5 kategori: continue (konten yang harus diteruskan, performa " +
          "baik), reduce (konten yang harus dikurangi, performa di bawah rata-rata), " +
          "stop (konten yang tidak efektif sama sekali), increase (konten dengan peluang " +
          "besar, layak ditambah porsi), test (kombinasi baru yang belum dicoba, layak " +
          "diuji). Tiap item singkat (maks 12 kata), spesifik menyebut nama tipe/pilar/" +
          "hook/struktur dari data, bukan saran generik. Kalau suatu kategori memang " +
          "tidak ada yang layak disebut, kembalikan array kosong untuk kategori itu - " +
          "JANGAN dipaksakan mengisi.",
      },
      {
        role: "user",
        content:
          `${ringkasan}\n\nBalas HARUS JSON valid (tanpa markdown code fence): ` +
          `{"continue": ["..."], "reduce": ["..."], "stop": ["..."], "increase": ["..."], "test": ["..."]}`,
      },
    ],
    temperature: 0.4,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    return {
      continue: Array.isArray(parsed.continue) ? parsed.continue : [],
      reduce: Array.isArray(parsed.reduce) ? parsed.reduce : [],
      stop: Array.isArray(parsed.stop) ? parsed.stop : [],
      increase: Array.isArray(parsed.increase) ? parsed.increase : [],
      test: Array.isArray(parsed.test) ? parsed.test : [],
    };
  } catch {
    // Fail-soft (2026-08-19, sama disiplin dgn guard lain di codebase ini) - JSON invalid
    // dari model TIDAK BOLEH menjatuhkan seluruh laporan bulanan, tampilkan tanpa
    // rekomendasi drpd error total.
    return EMPTY_RECOMMENDATION;
  }
}

import { getOpenAIClient } from "./openaiClient";
import type { MonthlyReportData } from "@/lib/reports/monthlyReportData";

// Competitor Content Gap + SWOT Intelligence (2026-08-19, PRD §5-8, "kerjakan tanpa API
// berbayar" - keputusan Agus). AI di sini TIDAK PERNAH diberi akses browsing/API
// kompetitor apa pun - sumber fakta kompetitor HANYA data yang sudah tersimpan di tabel
// `competitors` + `ownPerformance` (data performa brand SENDIRI yang sudah real, dari
// monthlyReportData.ts). Prompt eksplisit melarang mengarang fakta di luar itu - pola
// sama dgn seluruh AI call lain di app ini (rangkum data asli, jangan jadi sumber fakta).
//
// REVISI 2026-11-07 (cacat nyata, kena SEMUA tenant - ditemukan saat audit agustap studio):
//   1. Saringan dulu HANYA `notes.length > 10` -> pembanding yang sudah DINONAKTIFKAN
//      (benchmark_active=0) tetap ikut masuk prompt. Sekarang WAJIB aktif.
//   2. Prompt dulu HANYA memakai `name` + `notes`. Padahal substansi pola konten ada di
//      `benchmark_profile` (hook/storytelling/angle/ritme/CTA/visual/audiens) + `role`,
//      dan keduanya TIDAK PERNAH dibaca. Sekarang dipakai sebagai sumber fakta utama.
//   3. `notes` di tabel ini sering berisi KETERANGAN ASAL DATA (mis. "[ANALISIS DARI
//      ARTIKEL PIHAK KETIGA ...]", "[SEED MANUAL ...]"), bukan pengamatan konten. Dulu
//      AI memparafrasekannya sebagai perilaku kompetitor (terbukti: "menggunakan
//      video-native", "menerapkan analisis gaya yang kredibel" - itu metode pengumpulan
//      data, bukan perilaku). Sekarang notes diberi label tegas sbg metadata + prompt
//      melarang memperlakukannya sebagai temuan.
export type Competitor = {
  id: string;
  name: string;
  notes: string | null;
  // Creator Benchmark (nullable - brand yang cuma pakai `notes` tetap jalan apa adanya).
  role?: string | null;
  benchmarkProfile?: string | null; // JSON string, lihat BenchmarkProfile
  benchmarkActive?: boolean | null;
};

export type BenchmarkProfile = {
  hookPattern?: string;
  storytellingPattern?: string;
  contentAngle?: string;
  pacing?: string;
  ctaPattern?: string;
  visualPattern?: string;
  audiencePattern?: string;
};

export type CompetitorIntelligence = {
  contentGap: { competitorDoing: string[]; competitorMissing: string[]; opportunities: string[] };
  swot: { strength: string[]; weakness: string[]; opportunity: string[]; threat: string[] };
};

const EMPTY_RESULT: CompetitorIntelligence = {
  contentGap: { competitorDoing: [], competitorMissing: [], opportunities: [] },
  swot: { strength: [], weakness: [], opportunity: [], threat: [] },
};

// Urutan TETAP -> brief deterministik (mudah di-snapshot di tes).
const PROFILE_FIELDS: Array<[keyof BenchmarkProfile, string]> = [
  ["hookPattern", "Pola hook"],
  ["storytellingPattern", "Cara bercerita"],
  ["contentAngle", "Angle konten"],
  ["pacing", "Ritme"],
  ["ctaPattern", "Pola CTA"],
  ["visualPattern", "Pola visual"],
  ["audiencePattern", "Profil audiens"],
];

/** Parse benchmark_profile (JSON string) -> hanya field string non-kosong yang dikenal.
 *  JSON rusak / bukan objek / semua kosong -> null (fail-soft, tidak pernah throw). */
export function parseBenchmarkProfile(raw: string | null | undefined): BenchmarkProfile | null {
  if (!raw || !raw.trim()) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const src = o as Record<string, unknown>;
  const out: BenchmarkProfile = {};
  for (const [key] of PROFILE_FIELDS) {
    const v = src[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

const hasUsefulNotes = (c: Competitor): boolean => (c.notes || "").trim().length > 10;

/** Pembanding yang layak masuk prompt: WAJIB aktif (benchmark_active=1) DAN punya
 *  substansi - profil benchmark ATAU catatan staf. Pembanding nonaktif selalu dibuang,
 *  sekaya apa pun profilnya (itu arti "dinonaktifkan"). */
export function selectCompetitorsForPrompt(competitors: Competitor[]): Competitor[] {
  return competitors.filter(
    (c) => c.benchmarkActive === true && (parseBenchmarkProfile(c.benchmarkProfile) !== null || hasUsefulNotes(c))
  );
}

/** Satu blok teks per pembanding untuk prompt. Profil benchmark = SUMBER FAKTA;
 *  `notes` ditandai tegas sebagai KETERANGAN ASAL DATA (metadata), bukan pengamatan. */
export function buildCompetitorBrief(c: Competitor): string {
  const lines: string[] = [`### ${c.name}`];
  if (c.role && c.role.trim()) lines.push(`Peran pembanding: ${c.role.trim()}`);
  const p = parseBenchmarkProfile(c.benchmarkProfile);
  if (p) {
    lines.push("POLA KONTEN TERAMATI (sumber fakta):");
    for (const [key, label] of PROFILE_FIELDS) if (p[key]) lines.push(`- ${label}: ${p[key]}`);
  } else {
    lines.push("POLA KONTEN TERAMATI: (belum ada profil benchmark)");
  }
  if (hasUsefulNotes(c)) {
    lines.push(`KETERANGAN ASAL DATA (metadata, BUKAN pengamatan konten): ${(c.notes || "").trim()}`);
  }
  return lines.join("\n");
}

export async function generateCompetitorIntelligence(
  brandName: string,
  competitors: Competitor[],
  ownPerformance: MonthlyReportData
): Promise<CompetitorIntelligence> {
  // Tidak ada pembanding AKTIF yang punya substansi - jangan paksa AI menyimpulkan dari
  // kekosongan (pola sama dgn guard "data < 3" di monthlyStrategicRecommendation).
  const eligible = selectCompetitorsForPrompt(competitors);
  if (eligible.length === 0) {
    return EMPTY_RESULT;
  }

  const client = getOpenAIClient();
  const briefPembanding = eligible.map(buildCompetitorBrief).join("\n\n");
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
          "HANYA boleh menggunakan 2 sumber fakta yang diberikan di bawah: (1) POLA " +
          "KONTEN TERAMATI tiap pembanding (profil benchmark yang sudah tersimpan), " +
          "(2) data performa brand sendiri yang sudah nyata. JANGAN PERNAH mengarang " +
          "angka/fakta kompetitor di luar itu - kalau tidak disebutkan, JANGAN " +
          "diasumsikan/ditebak.\n" +
          "PENTING soal KETERANGAN ASAL DATA: baris itu adalah metadata tentang DARI MANA " +
          "data pembanding diperoleh (mis. dianalisis dari konten asli, atau dari artikel " +
          "pihak ketiga, atau seed manual). Itu BUKAN pengamatan tentang konten " +
          "pembanding. JANGAN PERNAH memparafrasekannya sebagai perilaku, gaya, atau " +
          "temuan kompetitor. Pakai hanya untuk menilai seberapa kuat buktinya.\n" +
          "Hasilkan: (A) Content Gap - apa yang pembanding SERING lakukan (dari POLA " +
          "KONTEN TERAMATI), apa yang JARANG/TIDAK PERNAH mereka lakukan (hanya kalau " +
          "pola mereka memang menunjukkan ketidakhadiran itu), dan peluang konten yang " +
          "bisa diisi brand ini; (B) SWOT brand ini (Strength/Weakness/Opportunity/" +
          "Threat) berdasar kombinasi performa nyata brand sendiri VS pola pembanding.\n" +
          "ATURAN KETAT: `competitorMissing` HARUS berasal dari pola pembanding, BUKAN " +
          "dari tipe konten brand sendiri yang views-nya rendah - kelemahan brand sendiri " +
          "tempatnya di swot.weakness, bukan di competitorMissing. " +
          "Tiap item singkat (maks 15 kata), spesifik, bukan generik. Kategori yang tidak " +
          "ada yang layak disebut → array kosong, jangan dipaksakan.",
      },
      {
        role: "user",
        content:
          `PEMBANDING AKTIF (${eligible.length}):\n${briefPembanding}\n\n` +
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

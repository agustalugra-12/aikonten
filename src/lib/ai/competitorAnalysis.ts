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
//   4. TAMBAHAN 2026-11-07 (disetujui Agus): `brandContext` - identitas brand sendiri
//      sebagai KONTEKS relevansi. Tanpa ini AI tidak tahu brand menjual alat software
//      atau jasa, sehingga SWOT-nya cuma membandingkan performa per tipe konten dan
//      terasa generik. Lihat buildBrandContext() untuk penjagaan harga/paket/kredit.
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

// =====================================================================================
// brandContext - identitas brand sendiri sebagai KONTEKS relevansi (2026-11-07)
// =====================================================================================
// SENGAJA TIDAK menyuntik `manual_knowledge` mentah (di agustap studio 14 ribu karakter):
// prompt jadi encer, biaya naik ~4x, dan isinya memuat copy marketing + case study yang
// gampang diperlakukan AI sebagai fakta terbukti. Yang dipakai = kolom pendek terstruktur
// yang sudah ada di tabel `brands` (total ~500 karakter, stabil lintas tenant).

export type BrandIdentity = {
  niche?: string | null;
  positioning?: string | null;
  targetAudience?: string | null;
  toneOfVoice?: string | null;
  contentPillars?: string | null; // JSON {"pillars":[...]} atau teks bebas
  manualKnowledge?: string | null; // HANYA jalur cadangan, dipotong di IDENTITAS BRAND
};

const MAX_BRAND_CONTEXT = 1200;
const MAX_CONTEXT_LINE = 240;

// PENJAGAAN KERAS (perintah Agus 2026-11-07): brandContext TIDAK BOLEH memuat harga,
// nama paket, atau jumlah kredit. Analisis kompetitor sama sekali tidak butuh harga, dan
// harga basi di dalam prompt justru kelas bug yang baru kita bersihkan (brand ini
// menerbitkan paket agensi lama Rp1,5-2,5 juta yang sudah tidak dijual). Satu baris yang
// kena pola di bawah DIBUANG UTUH - tidak disensor sebagian, supaya tidak ada sisa angka.
const PRICE_LINE_RE = new RegExp(
  [
    "rp\\s*\\.?\\s*\\d", // Rp149.000 / Rp 149000
    "\\d{1,3}[.,]\\d{3}", // 149.000 / 1,500 (pemisah ribuan)
    "\\b\\d{4,}\\b", // 149000
    "\\b\\d+(?:[.,]\\d+)?\\s*(?:rb|ribu|jt|juta|k|m)\\b", // 149rb / 1,5 juta / 350K
    "\\bkredit\\b|\\bcredits?\\b", // jumlah kredit
    "\\bharga\\b|\\bpaket\\b|\\bpackage\\b|\\bpricing\\b|\\btarif\\b|\\bbiaya\\b",
    "\\blangganan\\b|\\bsubscription\\b|\\bper\\s*bulan\\b|/\\s*bulan\\b|/\\s*bln\\b",
    // nama tier paket
    "\\bstarter\\b|\\bpro\\b|\\bpremium\\b|\\bbasic\\b|\\bagency\\b|\\benterprise\\b|\\bunlimited\\b",
  ].join("|"),
  "i"
);

/** Buang SETIAP baris yang menyinggung harga / nama paket / jumlah kredit. */
export function redactPriceLines(block: string): string {
  return block
    .split("\n")
    .filter((l) => !PRICE_LINE_RE.test(l))
    .join("\n");
}

const SEPARATOR_RE = /^(?:[=\-_*#]{5,})$/;
const HEADING_RE = /^[^a-z]{4,}$/; // baris tanpa satu pun huruf kecil = judul seksi

/** Ambil HANYA seksi `IDENTITAS BRAND` dari manual_knowledge, dipotong TEGAS di
 *  pemisah/judul seksi berikutnya supaya tidak pernah merembet ke PAKET HARGA.
 *  Kalau seksinya tidak ada -> "" (bukan menebak seksi lain). */
export function extractIdentitySection(manualKnowledge: string | null | undefined): string {
  if (!manualKnowledge) return "";
  const lines = manualKnowledge.split("\n");
  const start = lines.findIndex((l) => /^\s*IDENTITAS BRAND\s*$/.test(l));
  if (start < 0) return "";
  const body: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (!line) {
      if (body.length > 0) body.push("");
      continue;
    }
    if (SEPARATOR_RE.test(line)) {
      if (body.length === 0) continue; // pemisah PEMBUKA judul, bukan penutup seksi
      break;
    }
    if (HEADING_RE.test(line)) break; // judul seksi berikutnya -> STOP
    body.push(raw.trimEnd());
  }
  return body.join("\n").trim();
}

function parsePillars(raw?: string | null): string {
  const t = (raw || "").trim();
  if (!t) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return t; // teks bebas, bukan JSON
  }
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { pillars?: unknown }).pillars)
      ? (parsed as { pillars: unknown[] }).pillars
      : [];
  return arr
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .map((s) => s.trim())
    .join(", ");
}

/** Blok identitas brand yang pendek & aman untuk prompt. Sumber utama = kolom pendek
 *  tabel `brands`. Jalur cadangan (hanya kalau SEMUA kolom itu kosong) = seksi
 *  IDENTITAS BRAND dari manual_knowledge. Apa pun jalurnya, hasil akhir selalu lewat
 *  redactPriceLines() lalu diplafon MAX_BRAND_CONTEXT karakter. */
export function buildBrandContext(brand: BrandIdentity): string {
  const parts: string[] = [];
  const add = (label: string, v?: string | null) => {
    const t = (v || "").replace(/\s+/g, " ").trim();
    if (t) parts.push(`${label}: ${t.slice(0, MAX_CONTEXT_LINE)}`);
  };
  add("Niche", brand.niche);
  add("Positioning", brand.positioning);
  add("Target audiens", brand.targetAudience);
  add("Tone of voice", brand.toneOfVoice);
  add("Pilar konten", parsePillars(brand.contentPillars));

  if (parts.length === 0) {
    const identity = extractIdentitySection(brand.manualKnowledge);
    if (identity) parts.push(identity);
  }

  const block = redactPriceLines(parts.join("\n")).trim();
  if (block.length <= MAX_BRAND_CONTEXT) return block;
  const cut = block.slice(0, MAX_BRAND_CONTEXT);
  const nl = cut.lastIndexOf("\n");
  return (nl > 0 ? cut.slice(0, nl) : cut).trim();
}

const normEcho = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const MIN_ECHO = 12; // di bawah ini frasa terlalu generik utk dianggap gemaan

/** Jaring pengaman deterministik: buang item "temuan kompetitor" yang sebenarnya cuma
 *  menggemakan brandContext. Prompt sudah melarang, ini lapis kedua di kode karena
 *  kepatuhan prompt tidak bisa dijamin. Dicocokkan PER-NILAI brandContext (bukan seluruh
 *  blok) dan dua arah, supaya gemaan SEBAGIAN ikut tertangkap - mis. tone brand
 *  "Edukatif & Berbobot" muncul jadi "Edukatif & Berbobot dalam membawakan materi".
 *  Nilai pendek (<12 karakter ternormalisasi) dilewati supaya frasa generik tidak
 *  ikut membuang temuan kompetitor yang sah; pilar konten SENGAJA dicocokkan sebagai
 *  satu nilai gabungan, bukan per-pilar, karena tumpang-tindih satu pilar dengan
 *  kompetitor itu wajar dan bukan kebocoran.
 *  Hanya dipakai untuk contentGap (competitorDoing/competitorMissing = klaim TENTANG
 *  kompetitor); `opportunities` dan `swot` memang BOLEH dibentuk konteks brand sendiri. */
export function stripBrandContextEcho(items: string[], brandContext?: string | null): string[] {
  const values = (brandContext || "")
    .split("\n")
    .map((l) => normEcho(l.replace(/^[^:]{1,30}:\s*/, ""))) // buang label "Niche: " dst
    .filter((v) => v.length >= MIN_ECHO);
  if (values.length === 0) return items;
  return items.filter((it) => {
    const n = normEcho(it);
    if (n.length < MIN_ECHO) return true;
    return !values.some((v) => n.includes(v) || v.includes(n));
  });
}

export async function generateCompetitorIntelligence(
  brandName: string,
  competitors: Competitor[],
  ownPerformance: MonthlyReportData,
  brandContext?: string | null
): Promise<CompetitorIntelligence> {
  // Tidak ada pembanding AKTIF yang punya substansi - jangan paksa AI menyimpulkan dari
  // kekosongan (pola sama dgn guard "data < 3" di monthlyStrategicRecommendation).
  const eligible = selectCompetitorsForPrompt(competitors);
  if (eligible.length === 0) {
    return EMPTY_RESULT;
  }

  const client = getOpenAIClient();
  const briefPembanding = eligible.map(buildCompetitorBrief).join("\n\n");
  const konteksBrand = (brandContext || "").trim();
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
          "PENTING soal IDENTITAS BRAND (kalau ada): itu KONTEKS tentang brand SENDIRI, " +
          "BUKAN sumber fakta kompetitor. Pakai hanya untuk menimbang apa yang RELEVAN " +
          "bagi brand ini. JANGAN PERNAH menyalin atau memparafrasekan isinya sebagai " +
          "perilaku/temuan kompetitor di contentGap, dan jangan mengulangnya apa adanya " +
          "sebagai hasil analisis. Blok itu juga TIDAK memuat harga - jangan menyebut, " +
          "menebak, atau mengarang harga/paket/kredit apa pun.\n" +
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
          (konteksBrand
            ? `IDENTITAS BRAND (konteks relevansi, BUKAN sumber fakta kompetitor):\n${konteksBrand}\n\n`
            : "") +
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
    const doing = Array.isArray(parsed?.contentGap?.competitorDoing) ? parsed.contentGap.competitorDoing : [];
    const missing = Array.isArray(parsed?.contentGap?.competitorMissing) ? parsed.contentGap.competitorMissing : [];
    return {
      contentGap: {
        competitorDoing: stripBrandContextEcho(doing, konteksBrand),
        competitorMissing: stripBrandContextEcho(missing, konteksBrand),
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

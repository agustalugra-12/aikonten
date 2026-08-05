// Keyword Priority & Search Intent Engine (2026-08-05, PRD "AI Content Brain" modul 4 &
// 9, permintaan Agus - "AI memahami Keyword -> Intent... bukan sekadar hotel"). Daftar
// keyword HARDCODE persis dari PRD Agus (bukan API tren berbayar - sama keputusan dgn
// suggestContentIdeas, lihat researchTopics.ts) - tiap keyword dipetakan ke intent
// aspects (apa yg SEBENARNYA dicari tamu di balik keyword itu), supaya konten yg
// menargetkan keyword itu benar2 menjawab kebutuhan tamu, bukan cuma nyebut nama hotel.
export type KeywordPriority = {
  keyword: string;
  level: 1 | 2 | 3;
  intentAspects: string[];
};

export const KEYWORD_PRIORITY_LIST: KeywordPriority[] = [
  // Level 1 - keyword UTAMA, target komposisi TERBANYAK
  { keyword: "Penginapan murah Bedugul", level: 1, intentAspects: ["harga", "lokasi", "fasilitas"] },
  { keyword: "Hotel murah Bedugul", level: 1, intentAspects: ["harga", "fasilitas", "parkir", "sarapan", "lokasi", "review"] },
  { keyword: "Homestay Bedugul", level: 1, intentAspects: ["fasilitas", "suasana", "lokasi"] },
  // Level 2 - keyword lokasi/landmark spesifik
  { keyword: "Hotel dekat Danau Beratan", level: 2, intentAspects: ["lokasi", "jarak", "akses"] },
  { keyword: "Hotel dekat Ulun Danu", level: 2, intentAspects: ["lokasi", "jarak", "akses"] },
  { keyword: "Hotel dekat Handara", level: 2, intentAspects: ["lokasi", "jarak", "akses"] },
  // Level 3 - keyword segmen/kebutuhan spesifik
  { keyword: "Day Use", level: 3, intentAspects: ["harga", "jam", "fasilitas"] },
  { keyword: "Family Trip", level: 3, intentAspects: ["fasilitas", "kapasitas", "keamanan"] },
  { keyword: "Backpacker", level: 3, intentAspects: ["harga", "lokasi"] },
  { keyword: "Staycation", level: 3, intentAspects: ["suasana", "fasilitas"] },
  { keyword: "Weekend", level: 3, intentAspects: ["momen", "ketersediaan"] },
];

export type KeywordClassification = { targetKeyword: string | null; keywordLevel: number | null };

// Duplicate Checker versi keyword (2026-08-05) - sama pola dgn buildDistributionBlock
// pillar/angle (researchTopics.ts): hitung berapa kali tiap LEVEL sudah dipakai di
// konten terakhir, prioritaskan Level 1 (paling penting utk SEO) kalau under-served.
export function buildKeywordPriorityBlock(recentClassifications: KeywordClassification[]): string {
  const levelCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const c of recentClassifications) {
    if (c.keywordLevel === 1 || c.keywordLevel === 2 || c.keywordLevel === 3) {
      levelCounts[c.keywordLevel] += 1;
    }
  }
  const usedKeywords = new Set(
    recentClassifications.map((c) => c.targetKeyword).filter((k): k is string => !!k)
  );

  const keywordLines = KEYWORD_PRIORITY_LIST.map((k) => {
    const used = usedKeywords.has(k.keyword) ? " (baru dipakai - variasikan angle kalau dipakai lagi)" : "";
    return `- [Level ${k.level}] "${k.keyword}" - intent tamu: ${k.intentAspects.join(", ")}${used}`;
  }).join("\n");

  return (
    "\n\n# DAFTAR KEYWORD PRIORITAS (target SEO Agus, urutan penting Level 1 > 2 > 3)\n" +
    `${keywordLines}\n\n` +
    `Pemakaian Level terakhir: Level 1 = ${levelCounts[1]}x, Level 2 = ${levelCounts[2]}x, Level 3 = ${levelCounts[3]}x. ` +
    "WAJIB prioritaskan Level 1 dulu (paling penting utk SEO Agus) kalau belum banyak " +
    "dipakai belakangan ini. Kalau sebuah ide MENARGETKAN salah satu keyword ini (tidak " +
    "wajib semua ide), pastikan ide itu SECARA NYATA menjawab intent aspects-nya (mis. " +
    "\"Hotel murah Bedugul\" harus benar2 singgung harga/fasilitas/parkir/sarapan, BUKAN " +
    "cuma nyebut nama hotel tanpa isi yg relevan dgn yg tamu cari)."
  );
}

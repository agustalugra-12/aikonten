// AI Director - pemilih footage (Tahap 2 v2, 2026-11-04). Keputusan hero + urutan + faceless
// dalam SATU fungsi murni planHeroAndClips, SOURCE-AWARE:
// - FOOTAGE BRAND (footage_bank): PERCAYA. Drop HANYA `avoid` (kamar mandi dll). Relevansi rendah /
//   tag kosong / skor 0 BUKAN alasan buang; relevansi hanya utk RANKING hero. Tak ada faceless palsu.
// - FOOTAGE STOK (Pexels dll): WAJIB lolos guard topik via tag/description/probe(sourceQuery/judul).
//   Tidak jelas (tanpa basis) = tidak dipakai. Off-topic (basis ada, nol overlap) = tolak (mis
//   golf/iguana utk Ankylosaurus).
// Skor: cocokkan token tag+description (brand) / probe (stok) ke hook/script pakai SINONIM TERBATAS
// (bukan model vision). Dinormalisasi per jumlah token (volume tak untung).

const AVOID_HOOK = [
  "kamar mandi", "toilet", "wc", "kloset", "closet", "wastafel", "westafel",
  "bathroom", "restroom", "urinal", "shower", "sink", "kloset duduk",
];

// Sinonim TERBATAS (#4) - hanya pasangan relevan utk data brand nyata (homestay/laundry/agensi
// konten). Semua varian dipetakan ke 1 kanonik supaya tag ID cocok hook walau beda kata.
const SYN_GROUPS: string[][] = [
  ["kamar", "room", "bedroom", "bilik"],
  ["cucian", "laundry", "baju", "pakaian", "clothes", "garment", "setrika", "ironing"],
  ["teras", "patio", "beranda", "porch"],
  ["pemandangan", "view", "scenery", "panorama", "landscape"],
  ["gunung", "mountain", "bukit", "hill"],
  ["sarapan", "breakfast", "makan", "food", "makanan"],
  ["kolam", "pool", "renang", "swimming"],
  ["konten", "content", "post", "posting", "feed"],
  ["sosial", "social", "instagram", "ig", "sosmed"],
  ["bisnis", "business", "umkm", "usaha", "brand"],
  ["kerja", "work", "kantor", "office", "meeting", "rapat"],
  ["antar", "delivery", "jemput", "pickup", "kurir"],
  ["bersih", "clean", "wangi", "fresh", "rapi"],
  ["taman", "garden", "kebun"],
  ["parkir", "parking", "motor", "mobil", "car"],
];
const CANON = new Map<string, string>();
for (const g of SYN_GROUPS) for (const v of g) CANON.set(v, g[0]);
function canon(tok: string): string { return CANON.get(tok) || tok; }

function norm(s: string): string { return String(s || "").toLowerCase(); }
function tokens(text: string): string[] {
  return norm(text).split(/[^a-z0-9À-ɏ]+/).filter((w) => w.length >= 3);
}
// Token kanonik (sinonim) dari teks bebas - utk hook/script & basis klip.
function canonTokens(text: string): string[] { return tokens(text).map(canon); }

export type FootageScore = { avoid: boolean; relevance: number; hasTags: boolean };

// Skor basis (array string: tag/description/probe) vs token hook/script KANONIK. Match hook=2,
// script=1 per token UNIK, dinormalisasi per jumlah token unik (volume tak untung, #2).
export function scoreClipTags(tags: string[], hookTokens: Set<string>, scriptTokens: Set<string>): FootageScore {
  const t = (tags || []).map(norm);
  const avoid = t.some((tag) => AVOID_HOOK.some((a) => tag.includes(a)));
  const basisTok = Array.from(new Set(t.flatMap((tag) => canonTokens(tag))));
  let sum = 0;
  for (const w of basisTok) {
    if (hookTokens.has(w)) sum += 2;
    else if (scriptTokens.has(w)) sum += 1;
  }
  const relevance = basisTok.length ? sum / basisTok.length : 0;
  return { avoid, relevance, hasTags: t.length > 0 };
}

// Urutkan klip by relevansi (hero depan), avoid di belakang. Dipakai jalur lama (foto/video bank).
export function directFootageOrder<T>(
  clips: T[], urlOf: (c: T) => string, tagsByUrl: Map<string, string[]>, hookText: string, script: string,
): T[] {
  if (clips.length <= 1) return clips;
  const hookTokens = new Set(canonTokens(hookText));
  const scriptTokens = new Set(canonTokens(script));
  const scored = clips.map((c, i) => ({ c, i, s: scoreClipTags(tagsByUrl.get(urlOf(c)) || [], hookTokens, scriptTokens) }));
  const good = scored.filter((x) => !x.s.avoid).sort((a, b) => b.s.relevance - a.s.relevance || a.i - b.i);
  const bad = scored.filter((x) => x.s.avoid).sort((a, b) => a.i - b.i);
  return [...good, ...bad].map((x) => x.c);
}

// Relevance guard STOK (#3/#5): basis ada tapi nol overlap = salah topik.
export function isOffTopic(basis: string[], hookText: string, script: string): boolean {
  const s = scoreClipTags(basis || [], new Set(canonTokens(hookText)), new Set(canonTokens(script)));
  return s.hasTags && s.relevance === 0;
}

export type ClipSource = "brand" | "stock";
export type ClipCandidate = { key: string; source: ClipSource; tags?: string[]; description?: string; probe?: string };
export type DropReason = "avoid" | "off_topic" | "no_basis";
export type HeroPlan = {
  order: string[];     // SEMUA klip dipakai, urut: hero (relevansi tertinggi) dulu
  heroKey: string | null;
  heroTags: string[];  // basis hero -> QC cek hero yg SAMA dgn render & fallback (#5)
  faceless: boolean;   // true HANYA kalau nol klip aman (#6)
  dropped: { key: string; source: ClipSource; reason: DropReason }[];
};

function clipBasis(c: ClipCandidate): string[] {
  const out: string[] = [];
  if (c.tags) out.push(...c.tags.filter(Boolean));
  if (c.description && String(c.description).trim()) out.push(String(c.description));
  if (c.probe && String(c.probe).trim()) out.push(String(c.probe));
  return out;
}
function heroBasisTags(c: ClipCandidate): string[] {
  if (c.tags && c.tags.length) return c.tags;
  if (c.probe && String(c.probe).trim()) return [String(c.probe)];
  if (c.description && String(c.description).trim()) return [String(c.description)];
  return [];
}

export function planHeroAndClips(cands: ClipCandidate[], hookText: string, script: string): HeroPlan {
  const hookTokens = new Set(canonTokens(hookText));
  const scriptTokens = new Set(canonTokens(script));
  const dropped: HeroPlan["dropped"] = [];
  const kept: { key: string; rel: number; hero: string[] }[] = [];
  for (const c of cands) {
    const basis = clipBasis(c);
    const s = scoreClipTags(basis, hookTokens, scriptTokens);
    if (s.avoid) { dropped.push({ key: c.key, source: c.source, reason: "avoid" }); continue; } // #2: avoid SELALU di-drop
    if (c.source === "stock") {
      // #3: stok wajib lolos guard topik. Tanpa basis = tidak jelas = tidak dipakai.
      if (!s.hasTags && basis.length === 0) { dropped.push({ key: c.key, source: c.source, reason: "no_basis" }); continue; }
      if (s.relevance === 0) { dropped.push({ key: c.key, source: c.source, reason: "off_topic" }); continue; }
    }
    // #2/#6: footage BRAND dipertahankan apa pun (selain avoid); relevansi hanya utk ranking.
    kept.push({ key: c.key, rel: s.relevance, hero: heroBasisTags(c) });
  }
  // Ranking stabil: relevansi desc, urutan asli sbg tie-break.
  const withIdx = kept.map((k, i) => ({ ...k, i }));
  withIdx.sort((a, b) => b.rel - a.rel || a.i - b.i);
  if (!withIdx.length) return { order: [], heroKey: null, heroTags: [], faceless: true, dropped };
  return { order: withIdx.map((x) => x.key), heroKey: withIdx[0].key, heroTags: withIdx[0].hero, faceless: false, dropped };
}

// SHIM TRANSISI (dipakai processProject 505081c sampai wiring planHeroAndClips penuh).
// Memperlakukan kandidat sbg BRAND (konservatif). Akan dihapus saat wiring selesai.
export type HeroCandidate = { key: string; tags: string[] };
export function chooseHeroSource(cands: HeroCandidate[], hookText: string, script: string): string | null {
  const p = planHeroAndClips(cands.map((c) => ({ key: c.key, source: "brand" as const, tags: c.tags })), hookText, script);
  return p.heroKey;
}

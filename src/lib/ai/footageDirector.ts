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
  // Lintas-bahasa EN<->ID (slug Pexels Inggris, hook/script bisa Indonesia) - subjek Animal Story.
  ["dinosaur", "dinosaurus", "dino"],
  ["fosil", "fossil"],
  ["kura", "turtle", "penyu", "tortoise"],
  ["kadal", "lizard"],
  ["hewan", "animal", "satwa", "wildlife"],
  ["laut", "sea", "ocean", "underwater", "samudra"],
  ["hutan", "forest", "jungle", "rimba"],
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

// Slug ISI dari URL sumber (Tahap 2 LANGKAH 1, 2026-11-04). KRUSIAL: `source_query` = NIAT cari
// (sering TAK cocok isi - mis query "narwhal Arctic" -> klip "cracked-ice-surface"), sedangkan
// `source_url` slug = ISI NYATA klip yg dikembalikan Pexels (mis .../close-up-of-iguana-...).
// Dipakai sbg `probe` guard stok -> isi off-topik (iguana/kura utk topik dinosaurus) tertolak via
// slug ISI, BUKAN daftar kata manual. Kosong kalau URL tak ada/tak terparse -> caller tandai no_basis.
export function slugFromSourceUrl(url: string | null | undefined): string {
  try {
    const segs = new URL(String(url)).pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1] || "";
    const s = last.replace(/[-_]+/g, " ").replace(/\b\d{3,}\b/g, " ").replace(/\s+/g, " ").trim();
    // Tanpa kata bermakna (>=3 huruf) = tak ada metadata ISI (mis Pixabay `id-85674`) -> kosong -> no_basis.
    return s.split(" ").some((w) => w.length >= 3 && /[a-z]/.test(w)) ? s : "";
  } catch { return ""; }
}

// Leksikon KATEGORI (deterministik, bukan vision) - klasifikasi ISI klip dari slug/tag.
// Dipakai utk (a) kategori TERLARANG per-domain (menang atas token match), (b) "domain match"
// klip suasana (reel ambient boleh walau token-overlap rendah).
const CATEGORY_LEXICON: Record<string, string[]> = {
  sport: ["golf", "golfer", "frisbee", "soccer", "football", "basketball", "tennis", "gym", "fitness", "workout", "skate", "surfing", "bowling", "baseball"],
  human_media: ["office", "meeting", "laptop", "typing", "podcast", "makeup", "influencer", "vlog", "editor", "workstation", "smartphone", "selfie", "placard", "presentation"],
  animal: ["animal", "wildlife", "cat", "dog", "lizard", "iguana", "turtle", "tortoise", "fish", "shark", "bird", "bee", "butterfly", "dolphin", "whale", "insect", "ant", "spider", "snake", "lion", "tiger", "elephant", "monkey", "squirrel", "lynx", "fox", "deer", "jellyfish", "reptile", "frog", "crab", "octopus", "penguin", "dinosaur"],
  nature: ["forest", "jungle", "ocean", "sea", "underwater", "reef", "coral", "mountain", "river", "lake", "waterfall", "sky", "sunset", "landscape", "plant", "flower", "tree", "desert", "snow", "ice", "canyon", "beach", "wave"],
  food: ["food", "market", "fruit", "vegetable", "cooking", "meal", "restaurant", "kuliner", "dish", "chef", "coffee", "bakery", "street food"],
  property: ["room", "bedroom", "hotel", "villa", "pool", "garden", "house", "interior", "terrace", "lobby", "resort", "homestay", "cottage", "balcony", "bed"],
  laundry: ["laundry", "clothes", "washing", "ironing", "garment", "folding", "fabric", "detergent", "linen", "towel"],
  business: ["business", "shop", "store", "product", "brand", "entrepreneur", "startup", "retail", "customer"],
};
// Cocok keyword dgn TOKEN UTUH (bukan substring) supaya "vacation" tak dianggap "cat", "season"
// bukan "sea", dll (BAGIAN 1 #2). Keyword multi-kata dicocokkan sbg frasa berbatas.
function kwHits(text: string, kws: string[]): number {
  const toks = new Set(tokens(text));
  const low = " " + norm(text) + " ";
  let n = 0;
  for (const kw of kws) {
    if (kw.includes(" ")) { if (low.includes(" " + kw + " ")) n++; }
    else if (toks.has(kw)) n++;
  }
  return n;
}
// Kategori ISI dominan dari teks basis (slug/tag). "unknown" kalau tak ada kata cocok.
export function categoryOf(text: string): string {
  let best = "unknown", bestN = 0;
  for (const [cat, kws] of Object.entries(CATEGORY_LEXICON)) {
    const n = kwHits(text, kws);
    if (n > bestN) { bestN = n; best = cat; }
  }
  return best;
}
// SEMUA kategori yg punya >=1 keyword cocok (BAGIAN 1 #3: forbidden hit APA PUN menang).
export function matchedCategories(text: string): Set<string> {
  const out = new Set<string>();
  for (const [cat, kws] of Object.entries(CATEGORY_LEXICON)) if (kwHits(text, kws) > 0) out.add(cat);
  return out;
}
export type DomainProfile = { key: string; reelCategories: string[]; forbidden: string[] };
// Profil domain CONFIGURABLE (bukan hardcode per-brand). reelCategories = kategori yg "nyambung"
// (klip ambient boleh di reel). forbidden = kategori terlarang (menang atas token match).
const DOMAIN_PROFILES: Record<string, DomainProfile> = {
  animal: { key: "animal", reelCategories: ["animal", "nature"], forbidden: ["sport", "human_media"] },
  hospitality: { key: "hospitality", reelCategories: ["property", "nature", "food"], forbidden: ["sport"] },
  laundry: { key: "laundry", reelCategories: ["laundry", "property", "business"], forbidden: ["sport"] },
  business: { key: "business", reelCategories: ["business", "human_media", "food", "property"], forbidden: [] },
};
// Domain tak dikenal -> HANYA larangan universal (kosong = andalkan avoid+relevansi), dan DICATAT (known=false).
const UNIVERSAL_FORBIDDEN: string[] = [];
export function resolveDomain(key: string | null | undefined): { profile: DomainProfile; known: boolean } {
  const p = key ? DOMAIN_PROFILES[String(key)] : undefined;
  if (p) return { profile: p, known: true };
  return { profile: { key: "universal", reelCategories: [], forbidden: UNIVERSAL_FORBIDDEN }, known: false };
}
const HERO_MIN_RELEVANCE = 0.5; // ambang "relevan kuat" utk hero (skor ternormalisasi)

export type ClipSource = "brand" | "stock";
export type ClipCandidate = { key: string; source: ClipSource; tags?: string[]; description?: string; probe?: string };
export type DropReason = "avoid" | "off_topic" | "no_basis" | "forbidden_category";
export type HeroPlan = {
  order: string[];     // reel: hero (order[0]=relevan kuat) dulu, lalu klip suasana domain-match
  heroKey: string | null;
  heroTags: string[];  // basis hero -> QC cek hero yg SAMA dgn render & fallback (#5)
  faceless: boolean;   // true HANYA kalau nol klip aman (#6)
  dropped: { key: string; source: ClipSource; reason: DropReason; category?: string }[];
  domain: string;      // profil domain dipakai ("animal"/.../"universal")
  domainKnown: boolean;
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

export function planHeroAndClips(cands: ClipCandidate[], hookText: string, script: string, opts?: { domain?: string }): HeroPlan {
  const { profile, known } = resolveDomain(opts?.domain);
  const forbidden = new Set([...profile.forbidden, ...UNIVERSAL_FORBIDDEN]);
  const reelCats = new Set(profile.reelCategories);
  const hookTokens = new Set(canonTokens(hookText));
  const scriptTokens = new Set(canonTokens(script));
  const dropped: HeroPlan["dropped"] = [];
  const kept: { key: string; rel: number; hero: string[]; heroOK: boolean }[] = [];
  for (const c of cands) {
    const basis = clipBasis(c);
    const s = scoreClipTags(basis, hookTokens, scriptTokens);
    if (s.avoid) { dropped.push({ key: c.key, source: c.source, reason: "avoid" }); continue; } // avoid SELALU di-drop
    const category = categoryOf(basis.join(" "));
    const heroOK = s.relevance >= HERO_MIN_RELEVANCE; // hero wajib RELEVAN KUAT
    if (c.source === "stock") {
      if (basis.length === 0) { dropped.push({ key: c.key, source: c.source, reason: "no_basis", category }); continue; } // #4 Pixabay: no slug -> no_basis
      // BAGIAN1 #3: forbidden (STOK saja) - keyword forbidden APA PUN MENANG (mis golf+forest+lake -> golf menang).
      const cats = matchedCategories(basis.join(" "));
      const hitForbidden = [...forbidden].find((f) => cats.has(f));
      if (hitForbidden) { dropped.push({ key: c.key, source: c.source, reason: "forbidden_category", category: hitForbidden }); continue; }
      // REEL: klip suasana boleh kalau DOMAIN COCOK (kategori reel) ATAU ada relevansi. Selain itu buang.
      const domainMatch = reelCats.has(category);
      if (!domainMatch && s.relevance === 0) { dropped.push({ key: c.key, source: c.source, reason: "off_topic", category }); continue; }
      kept.push({ key: c.key, rel: s.relevance, hero: heroBasisTags(c), heroOK });
    } else {
      // BAGIAN1 #1: FOOTAGE BRAND hanya `avoid` yg dibuang (TIDAK kena forbidden); selalu di reel. Hero kalau relevan kuat.
      kept.push({ key: c.key, rel: s.relevance, hero: heroBasisTags(c), heroOK });
    }
  }
  // Urut REEL: hero-eligible (relevan kuat) DULU, lalu relevansi, lalu urutan asli. hero = order[0].
  const withIdx = kept.map((k, i) => ({ ...k, i }));
  withIdx.sort((a, b) => (b.heroOK ? 1 : 0) - (a.heroOK ? 1 : 0) || b.rel - a.rel || a.i - b.i);
  if (!withIdx.length) return { order: [], heroKey: null, heroTags: [], faceless: true, dropped, domain: profile.key, domainKnown: known };
  return { order: withIdx.map((x) => x.key), heroKey: withIdx[0].key, heroTags: withIdx[0].hero, faceless: false, dropped, domain: profile.key, domainKnown: known };
}

// #5 Planner kecukupan footage (pure): keputusan cari-pengganti / repeat / footage-kurang.
// targetSeconds = durasi video; uniqueSeconds = total detik footage UNIK yg aman (dari plan.order).
export type FootageStatus = "ok" | "repeat_ok" | "need_replacement" | "insufficient";
export function planFootageSufficiency(uniqueSeconds: number, targetSeconds: number, afterReplacement = false): { uniqueSeconds: number; targetSeconds: number; repeatRatio: number; status: FootageStatus } {
  const rr = uniqueSeconds > 0 ? targetSeconds / uniqueSeconds : Infinity;
  let status: FootageStatus;
  if (uniqueSeconds <= 0) status = "insufficient";
  else if (uniqueSeconds >= targetSeconds) status = "ok";
  else if (rr <= 2) status = "repeat_ok";                              // boleh ulang <= 2x
  else status = afterReplacement ? "insufficient" : "need_replacement"; // cari pengganti dulu; tetap kurang -> tandai
  return { uniqueSeconds, targetSeconds, repeatRatio: Number.isFinite(rr) ? Number(rr.toFixed(2)) : 0, status };
}

// SHIM TRANSISI (dipakai processProject 505081c sampai wiring planHeroAndClips penuh).
// Memperlakukan kandidat sbg BRAND (konservatif). Akan dihapus saat wiring selesai.
export type HeroCandidate = { key: string; tags: string[] };
export function chooseHeroSource(cands: HeroCandidate[], hookText: string, script: string): string | null {
  const p = planHeroAndClips(cands.map((c) => ({ key: c.key, source: "brand" as const, tags: c.tags })), hookText, script);
  return p.heroKey;
}

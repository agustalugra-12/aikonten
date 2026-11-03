// AI Director - pemilih footage (P1 HyperFrames Pro, 2026-11-02). Pakai tag visual yg SUDAH ada
// di footage_bank utk mengurutkan klip seperti editor: HERO shot (paling relevan ke hook) di
// DEPAN, klip "avoid" (kamar mandi/toilet) di BELAKANG - supaya hook tak pernah toilet. Generik
// semua tenant (skor dari overlap tag vs hook/script, bukan kategori hardcode per-produk).

// Subjek yang buruk utk PEMBUKA hampir semua produk - didemote dari hook. (Bukan dihapus:
// jaga budget durasi; cuma pindah ke belakang.)
const AVOID_HOOK = [
  "kamar mandi", "toilet", "wc", "kloset", "closet", "wastafel", "westafel",
  "bathroom", "restroom", "urinal", "shower", "sink", "kloset duduk",
];

function norm(s: string): string {
  return String(s || "").toLowerCase();
}
function tokens(text: string): string[] {
  return norm(text).split(/[^a-z0-9À-ɏ]+/).filter((w) => w.length >= 3);
}

export type FootageScore = { avoid: boolean; relevance: number; hasTags: boolean };

export function scoreClipTags(tags: string[], hookTokens: Set<string>, scriptTokens: Set<string>): FootageScore {
  const t = (tags || []).map(norm);
  const avoid = t.some((tag) => AVOID_HOOK.some((a) => tag.includes(a)));
  // Skor PER-TAG (bukan per-token) lalu NORMALISASI dgn jumlah tag (Tahap 2 #2): klip ber-tag
  // BANYAK tak dapat keuntungan volume; yg menang = DENSITAS relevansi. Tag cocok hook=2, script=1.
  let sum = 0;
  for (const tag of t) {
    const toks = tokens(tag);
    if (toks.some((w) => hookTokens.has(w))) sum += 2; // cocok hook = bobot ganda (hook paling penting)
    else if (toks.some((w) => scriptTokens.has(w))) sum += 1;
  }
  const relevance = t.length ? sum / t.length : 0;
  return { avoid, relevance, hasTags: t.length > 0 };
}

// Urutkan klip: non-avoid (relevansi tertinggi dulu = HERO di indeks 0), lalu avoid di belakang.
// urlOf: ambil URL klip utk lookup tag. tagsByUrl: peta URL -> tag dari footage_bank.
export function directFootageOrder<T>(
  clips: T[],
  urlOf: (c: T) => string,
  tagsByUrl: Map<string, string[]>,
  hookText: string,
  script: string,
): T[] {
  if (clips.length <= 1) return clips;
  const hookTokens = new Set(tokens(hookText));
  const scriptTokens = new Set(tokens(script));
  const scored = clips.map((c, i) => ({ c, i, s: scoreClipTags(tagsByUrl.get(urlOf(c)) || [], hookTokens, scriptTokens) }));
  const good = scored.filter((x) => !x.s.avoid).sort((a, b) => b.s.relevance - a.s.relevance || a.i - b.i);
  const bad = scored.filter((x) => x.s.avoid).sort((a, b) => a.i - b.i);
  return [...good, ...bad].map((x) => x.c);
}

// planHeroAndClips (Tahap 2 refactor review, 2026-11-03): SATU fungsi murni yg memutuskan hero +
// urutan klip + faceless utk SEMUA kandidat (stok/foto/video, termasuk mixed brand). Dipakai titik
// TUNGGAL -> QC & render & fallback pakai keputusan SAMA.
// - basis skor: tag kalau ada; klip stok TANPA tag diperiksa via `probe` (sourceQuery/judul/metadata)
//   -> TIDAK auto-aman (#1). Klip tanpa basis sama sekali = no_basis (dibuang, bukan dianggap aman).
// - buang: avoid (kamar mandi dll), off_topic (basis ada tapi nol overlap, mis golf utk Ankylosaurus),
//   no_basis. AMAN = non-avoid & relevance>0.
// - hero = klip AMAN relevansi TERTINGGI (order[0]); kalau teratas gagal, berikutnya (list aman terurut).
// - faceless HANYA kalau tak ada klip aman sama sekali (#4). heroTags = basis hero (SAMA dgn render) utk QC (#3).
export type ClipCandidate = { key: string; tags?: string[]; probe?: string };
export type HeroPlan = {
  order: string[];               // key klip AMAN urut relevansi (hero = order[0])
  heroKey: string | null;        // null kalau faceless
  heroTags: string[];            // basis hero (tag/probe) -> QC cek hero yg SAMA dgn render
  faceless: boolean;             // true -> render brand tanpa footage (tak ada klip aman)
  dropped: { key: string; reason: "avoid" | "off_topic" | "no_basis" }[];
};
function clipBasis(c: ClipCandidate): string[] {
  if (c.tags && c.tags.length) return c.tags.map(norm).filter(Boolean);
  if (c.probe && String(c.probe).trim()) return [norm(c.probe)];
  return [];
}
export function planHeroAndClips(cands: ClipCandidate[], hookText: string, script: string): HeroPlan {
  const hookTokens = new Set(tokens(hookText));
  const scriptTokens = new Set(tokens(script));
  const dropped: HeroPlan["dropped"] = [];
  const safe: { key: string; rel: number; basis: string[] }[] = [];
  for (const c of cands) {
    const basis = clipBasis(c);
    if (!basis.length) { dropped.push({ key: c.key, reason: "no_basis" }); continue; } // #1: tanpa basis -> jangan auto-aman
    const s = scoreClipTags(basis, hookTokens, scriptTokens);
    if (s.avoid) { dropped.push({ key: c.key, reason: "avoid" }); continue; }
    if (s.relevance === 0) { dropped.push({ key: c.key, reason: "off_topic" }); continue; } // #5: salah topik
    safe.push({ key: c.key, rel: s.relevance, basis });
  }
  safe.sort((a, b) => b.rel - a.rel);
  if (!safe.length) return { order: [], heroKey: null, heroTags: [], faceless: true, dropped };
  return { order: safe.map((x) => x.key), heroKey: safe[0].key, heroTags: safe[0].basis, faceless: false, dropped };
}

// TRANSISI (akan diganti wiring planHeroAndClips): dipakai processProject lama. Jangan tes/perluas.
export type HeroCandidate = { key: string; tags: string[] };
export function chooseHeroSource(cands: HeroCandidate[], hookText: string, script: string): string | null {
  const p = planHeroAndClips(cands.map((c) => ({ key: c.key, tags: c.tags })), hookText, script);
  return p.heroKey;
}

// Relevance guard (Tahap 2 #5): klip "salah topik" = PUNYA tag tapi NOL overlap dgn hook+script
// (mis golf/iguana utk topik Ankylosaurus). relevance===0 & hasTags -> off-topic. Klip TANPA tag
// TIDAK dianggap off-topik (tak ada info -> jangan tolak; biar jalur lama/flag footage-kurang yg urus).
export function isOffTopic(tags: string[], hookText: string, script: string): boolean {
  const s = scoreClipTags(tags || [], new Set(tokens(hookText)), new Set(tokens(script)));
  return s.hasTags && s.relevance === 0;
}

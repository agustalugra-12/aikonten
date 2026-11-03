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

// Tahap 2 (2026-11-03, keputusan Gerbang 1): pilih SUMBER hero lintas sumber (foto bank vs
// video-segment vs top-up) berdasar skor tertinggi. Tiap kandidat {key, tags} = tag hero tiap
// sumber. Return key sumber relevansi tertinggi (non-avoid, ber-tag, relevance>0); null kalau tak
// ada kandidat layak -> caller pakai urutan default lama. Dipakai processProject utk mutuskan
// sumber mana render DULU (bukan selalu foto brollClips[0]).
export type HeroCandidate = { key: string; tags: string[] };
export function chooseHeroSource(cands: HeroCandidate[], hookText: string, script: string): string | null {
  const hookTokens = new Set(tokens(hookText));
  const scriptTokens = new Set(tokens(script));
  const scored = cands
    .map((c) => ({ key: c.key, s: scoreClipTags(c.tags || [], hookTokens, scriptTokens) }))
    .filter((x) => !x.s.avoid && x.s.hasTags && x.s.relevance > 0);
  if (!scored.length) return null;
  scored.sort((a, b) => b.s.relevance - a.s.relevance);
  return scored[0].key;
}

// Relevance guard (Tahap 2 #5): klip "salah topik" = PUNYA tag tapi NOL overlap dgn hook+script
// (mis golf/iguana utk topik Ankylosaurus). relevance===0 & hasTags -> off-topic. Klip TANPA tag
// TIDAK dianggap off-topik (tak ada info -> jangan tolak; biar jalur lama/flag footage-kurang yg urus).
export function isOffTopic(tags: string[], hookText: string, script: string): boolean {
  const s = scoreClipTags(tags || [], new Set(tokens(hookText)), new Set(tokens(script)));
  return s.hasTags && s.relevance === 0;
}

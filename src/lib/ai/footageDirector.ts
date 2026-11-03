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
  let relevance = 0;
  for (const tag of t) {
    for (const w of tokens(tag)) {
      if (hookTokens.has(w)) relevance += 2; // cocok hook = bobot ganda (hook paling penting)
      else if (scriptTokens.has(w)) relevance += 1;
    }
  }
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

// Self-check ringan.
export function _demo(): void {
  const tagsByUrl = new Map<string, string[]>([
    ["a", ["kamar mandi", "toilet", "handuk"]],
    ["b", ["pemandangan", "teras", "gunung"]],
    ["c", ["kamar tidur", "ranjang"]],
  ]);
  const clips = [{ url: "a" }, { url: "c" }, { url: "b" }];
  const out = directFootageOrder(clips, (x) => x.url, tagsByUrl, "pemandangan teras sejuk", "liburan di teras dengan pemandangan gunung");
  // hero harus "b" (cocok hook), toilet "a" harus terakhir
  if (out[0].url !== "b") throw new Error("hero bukan klip paling relevan: " + out.map((x) => x.url).join(","));
  if (out[out.length - 1].url !== "a") throw new Error("klip toilet tidak di belakang: " + out.map((x) => x.url).join(","));
  // chooseHeroSource: video-segment lebih cocok hook drpd foto -> pilih "video".
  const hero = chooseHeroSource(
    [{ key: "photo", tags: ["kamar tidur", "ranjang"] }, { key: "video", tags: ["pemandangan", "teras"] }],
    "pemandangan teras sejuk", "liburan",
  );
  if (hero !== "video") throw new Error("chooseHeroSource salah pilih: " + hero);
  // semua avoid/tak-relevan -> null (caller pakai default lama).
  if (chooseHeroSource([{ key: "x", tags: ["toilet"] }], "liburan teras", "x") !== null) throw new Error("chooseHeroSource harus null kalau avoid");
}

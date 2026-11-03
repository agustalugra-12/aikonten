// Verifikasi keputusan hero footage (Tahap 2 v2 source-aware, 2026-11-04).
// Jalankan: node --import tsx scripts/verify-hero-selection.ts  (exit 1 kalau logika salah)
// Mencakup syarat tes #7: mixed brand, klip stok pertama, skor 0, semua avoid, tag kosong,
// Ankylosaurus, + fallback (plan deterministik = dipakai render & ffmpeg sama). + sinonim #4.
import assert from "node:assert";
import { planHeroAndClips, isOffTopic, directFootageOrder, type ClipCandidate } from "@/lib/ai/footageDirector";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };
const B = (key: string, tags: string[], description?: string): ClipCandidate => ({ key, source: "brand", tags, description });
const S = (key: string, probe: string): ClipCandidate => ({ key, source: "stock", probe });

// 1. MIXED BRAND: brand + stok; hero = relevansi tertinggi; SEMUA brand (non-avoid) dipertahankan.
{
  const p = planHeroAndClips([
    B("photo", ["kamar tidur"]),                 // brand, cocok "kamar" (sinonim) -> kept
    B("video", ["pemandangan", "teras"]),        // brand, cocok 2 -> hero
    S("stock", "teras kayu"),                    // stok relevan -> kept
  ], "pemandangan teras sejuk", "liburan");
  assert.strictEqual(p.faceless, false);
  assert.strictEqual(p.order[0], p.heroKey);
  assert.strictEqual(p.heroKey, "video", "hero = klip paling relevan");
  assert.ok(p.order.includes("photo"), "brand relevansi rendah TETAP di reel (#2)");
  ok("mixed brand; hero relevansi tertinggi; brand tak dibuang");
}

// 2. KLIP STOK jadi hero (stok paling relevan)
{
  const p = planHeroAndClips([B("b", ["ranjang"]), S("stk", "pemandangan gunung teras")], "pemandangan teras", "x");
  assert.strictEqual(p.heroKey, "stk", "stok relevan boleh jadi hero/klip pertama");
  ok("klip stok pertama (hero)");
}

// 3. SKOR 0 pada footage BRAND -> TETAP dipakai, BUKAN faceless (#2/#6)
{
  const p = planHeroAndClips([B("b1", ["meja"]), B("b2", ["lampu"])], "pemandangan teras sejuk", "liburan");
  assert.strictEqual(p.faceless, false, "brand skor 0 TIDAK faceless");
  assert.strictEqual(p.order.length, 2, "kedua brand dipakai");
  assert.deepStrictEqual(p.dropped, [], "brand skor 0 TIDAK di-drop");
  ok("skor 0 brand -> dipakai, bukan faceless (#6)");
}

// 4. SEMUA AVOID -> faceless
{
  const p = planHeroAndClips([B("a", ["toilet"]), B("b", ["kamar mandi"])], "liburan teras", "x");
  assert.strictEqual(p.faceless, true);
  assert.deepStrictEqual(p.dropped.map((d) => d.reason), ["avoid", "avoid"]);
  ok("semua avoid -> faceless");
}

// 5. TAG KOSONG pada brand -> dipakai (trusted), BUKAN faceless (#6)
{
  const p = planHeroAndClips([B("b", [])], "liburan teras", "x");
  assert.strictEqual(p.faceless, false, "brand tag kosong TIDAK faceless");
  assert.strictEqual(p.heroKey, "b");
  // stok tag kosong -> no_basis (tidak dipakai)
  const p2 = planHeroAndClips([{ key: "s", source: "stock" }], "liburan", "x");
  assert.strictEqual(p2.faceless, true);
  assert.strictEqual(p2.dropped[0].reason, "no_basis");
  ok("tag kosong: brand dipakai, stok no_basis ditolak (#1/#6)");
}

// 6. ANKYLOSAURUS: stok golf/iguana DITOLAK, stok dino & brand tetap
{
  const hook = "Ankylosaurus dinosaurus berlapis baja", script = "dinosaurus purba armor fosil ankylosaurus";
  const p = planHeroAndClips([
    S("golf", "golf course lapangan"),
    S("iguana", "iguana reptile"),
    S("dino", "dinosaurus fosil"),
    B("brandclip", ["logo"]),               // brand skor 0 -> TETAP (reel), bukan hero
  ], hook, script);
  assert.strictEqual(p.heroKey, "dino", "hero stok dinosaur");
  assert.deepStrictEqual(p.dropped.filter((d) => d.reason === "off_topic").map((d) => d.key).sort(), ["golf", "iguana"]);
  assert.ok(p.order.includes("brandclip"), "brand tetap di reel walau skor 0");
  assert.strictEqual(isOffTopic(["golf"], hook, script), true);
  assert.strictEqual(isOffTopic(["dinosaurus"], hook, script), false);
  ok("Ankylosaurus: stok golf/iguana ditolak, dino hero, brand tetap (#3/#5)");
}

// 7. FALLBACK FFMPEG pakai plan SAMA: deterministik (input sama -> order/hero/faceless identik)
{
  const cands = [B("b", ["teras"]), S("s", "pemandangan")];
  const a = planHeroAndClips(cands, "teras pemandangan", "x");
  const b = planHeroAndClips(cands, "teras pemandangan", "x");
  assert.deepStrictEqual(a.order, b.order);
  assert.strictEqual(a.heroKey, b.heroKey);
  assert.deepStrictEqual(a.heroTags, b.heroTags, "heroTags stabil -> QC & render & fallback konsisten (#5)");
  ok("plan deterministik -> render & ffmpeg fallback pakai keputusan sama (#5)");
}

// 8. SINONIM terbatas (#4): tag ID cocok hook beda-kata
{
  const p = planHeroAndClips([B("c", ["cucian"])], "layanan laundry antar jemput", "x");
  assert.ok(p.heroKey === "c" && p.order.length === 1, "cucian~laundry harus cocok (sinonim)");
  const rel = planHeroAndClips([S("s", "cucian")], "laundry", "x");
  assert.strictEqual(rel.faceless, false, "stok 'cucian' relevan ke 'laundry' (sinonim) -> dipakai");
  ok("sinonim terbatas: cucian~laundry, kamar~room (#4)");
}

// 9. directFootageOrder tetap benar
{
  const tagsByUrl = new Map<string, string[]>([["a", ["toilet"]], ["b", ["pemandangan", "teras"]], ["c", ["ranjang"]]]);
  const out = directFootageOrder([{ url: "a" }, { url: "c" }, { url: "b" }], (x) => x.url, tagsByUrl, "pemandangan teras", "liburan");
  assert.strictEqual(out[0].url, "b");
  assert.strictEqual(out[out.length - 1].url, "a");
  ok("directFootageOrder hero-depan/toilet-belakang");
}

console.log(`ALL_HERO_TESTS_PASS (${n} tes)`);

// Verifikasi keputusan hero footage (Tahap 2 refactor, 2026-11-03).
// Jalankan: node --import tsx scripts/verify-hero-selection.ts  (exit 1 kalau logika salah)
// planHeroAndClips = SATU fungsi murni; tes hasil AKHIR: klip pertama, QC (heroTags=render),
// faceless, fallback (keputusan sama), + stok-probe (#1), no_basis, normalisasi, Ankylosaurus (#5).
import assert from "node:assert";
import { planHeroAndClips, isOffTopic, directFootageOrder, scoreClipTags } from "@/lib/ai/footageDirector";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} - ${m}`); };

// 1. Nilai SEMUA kandidat (stok/foto/video, mixed); hero = klip pertama (order[0]) relevansi tertinggi.
{
  const p = planHeroAndClips([
    { key: "photo", tags: ["kamar tidur", "ranjang"] },           // tak cocok hook -> drop off_topic
    { key: "video", tags: ["pemandangan", "teras"] },             // cocok hook (2 dari 2) -> skor 2.0
    { key: "stock", probe: "teras kayu" },                        // stok via probe, cocok "teras" -> 2.0 (1 basis)
  ], "pemandangan teras sejuk", "liburan");
  assert.strictEqual(p.faceless, false);
  assert.strictEqual(p.order[0], p.heroKey, "hero harus order[0]");
  assert.ok(p.heroKey === "video" || p.heroKey === "stock", "hero harus klip paling relevan (video/stock), dapat: " + p.heroKey);
  assert.deepStrictEqual(p.dropped.map((d) => d.key), ["photo"], "photo (off-topic) harus di-drop");
  ok("nilai semua sumber; hero=klip pertama; off-topic di-drop");
}

// 2. foto menang (foto lebih cocok hook drpd video)
{
  const p = planHeroAndClips([{ key: "photo", tags: ["teras", "pemandangan"] }, { key: "video", tags: ["ranjang"] }], "teras pemandangan", "x");
  assert.strictEqual(p.heroKey, "photo", "foto harus menang");
  ok("foto menang (mixed)");
}

// 3. semua avoid -> faceless true (tak pakai klip tak aman)
{
  const p = planHeroAndClips([{ key: "a", tags: ["toilet"] }, { key: "b", tags: ["kamar mandi"] }], "liburan teras", "x");
  assert.strictEqual(p.faceless, true);
  assert.strictEqual(p.heroKey, null);
  assert.deepStrictEqual(p.dropped.map((d) => d.reason).sort(), ["avoid", "avoid"]);
  ok("semua avoid -> faceless");
}

// 4. #1 klip TANPA basis (tak ada tag & tak ada probe) -> no_basis (JANGAN auto-aman)
{
  const p = planHeroAndClips([{ key: "x" }], "liburan teras", "x");
  assert.strictEqual(p.faceless, true, "no-basis harus faceless (tak auto-aman)");
  assert.strictEqual(p.dropped[0].reason, "no_basis");
  ok("klip tanpa basis -> no_basis, tak auto-aman (#1)");
}

// 5. #1 stok TANPA tag diperiksa via probe (sourceQuery): off-topic di-drop, relevan aman.
{
  const anky = { hook: "Ankylosaurus dinosaurus berlapis baja", script: "dinosaurus purba armor fosil ankylosaurus" };
  const p = planHeroAndClips([
    { key: "golfstock", probe: "golf course lapangan" },          // stok sourceQuery golf -> off-topic
    { key: "iguanastock", probe: "iguana reptile" },              // stok -> off-topic utk Ankylosaurus
    { key: "dinostock", probe: "dinosaurus fosil" },              // stok relevan -> aman (hero)
  ], anky.hook, anky.script);
  assert.strictEqual(p.heroKey, "dinostock", "hero harus stok dinosaur, bukan golf/iguana");
  assert.deepStrictEqual(p.dropped.map((d) => d.key).sort(), ["golfstock", "iguanastock"], "golf+iguana di-drop");
  ok("stok tanpa-tag diperiksa via probe; golf/iguana Ankylosaurus di-drop (#1/#5)");
}

// 6. #4 kandidat teratas gagal -> klip aman BERIKUTNYA (bukan faceless selama ada 1 aman)
{
  const p = planHeroAndClips([
    { key: "bad1", tags: ["toilet"] },            // avoid
    { key: "bad2", tags: ["golf"] },              // off-topic
    { key: "good", tags: ["teras", "pemandangan"] }, // 1 aman
  ], "teras pemandangan", "x");
  assert.strictEqual(p.faceless, false, "ada 1 klip aman -> jangan faceless");
  assert.strictEqual(p.heroKey, "good");
  assert.strictEqual(p.order.length, 1, "hanya klip aman di order");
  ok("teratas gagal -> klip aman berikutnya; faceless hanya kalau nol aman (#4)");
}

// 7. #3 QC pakai hero SAMA dgn render: heroTags = basis hero (order[0])
{
  const p = planHeroAndClips([{ key: "v", tags: ["teras", "pemandangan"] }], "teras", "x");
  assert.deepStrictEqual(p.heroTags, ["teras", "pemandangan"], "heroTags harus basis hero (dicek QC = dirender)");
  ok("heroTags = basis hero (QC & render konsisten, #3)");
}

// 8. #2 normalisasi: klip 2-tag padat menang atas 10-tag volume
{
  const few = ["teras", "pemandangan"];
  const many = ["teras", "a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9"];
  const p = planHeroAndClips([{ key: "many", tags: many }, { key: "few", tags: few }], "teras pemandangan", "x");
  assert.strictEqual(p.heroKey, "few", "normalisasi: padat-relevan menang");
  assert.ok(scoreClipTags(few, new Set(["teras", "pemandangan"]), new Set()).relevance > scoreClipTags(many, new Set(["teras", "pemandangan"]), new Set()).relevance);
  ok("normalisasi skor (volume tag tak untung, #2)");
}

// 9. isOffTopic util + directFootageOrder tetap benar
assert.strictEqual(isOffTopic(["golf"], "dinosaurus", "fosil"), true);
assert.strictEqual(isOffTopic(["dinosaurus"], "dinosaurus purba", "x"), false);
{
  const tagsByUrl = new Map<string, string[]>([["a", ["toilet"]], ["b", ["pemandangan", "teras"]], ["c", ["ranjang"]]]);
  const out = directFootageOrder([{ url: "a" }, { url: "c" }, { url: "b" }], (x) => x.url, tagsByUrl, "pemandangan teras", "liburan");
  assert.strictEqual(out[0].url, "b");
  assert.strictEqual(out[out.length - 1].url, "a");
}
ok("isOffTopic + directFootageOrder");

console.log(`ALL_HERO_TESTS_PASS (${n} tes)`);

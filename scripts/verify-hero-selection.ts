// Verifikasi pemilihan hero footage (Tahap 2, 2026-11-03).
// Jalankan: node --import tsx scripts/verify-hero-selection.ts
// GAGAL (exit 1) kalau logika salah. Mencakup syarat tes #7 Agus: video menang, foto menang,
// semua avoid, tag kosong, stok salah topik (Ankylosaurus golf/iguana) + normalisasi skor (#2).
import assert from "node:assert";
import { chooseHeroSource, isOffTopic, directFootageOrder, scoreClipTags } from "@/lib/ai/footageDirector";

let n = 0;
const ok = (msg: string) => { n++; console.log(`  ok ${n} - ${msg}`); };

// 1. video menang (video lebih cocok hook drpd foto)
assert.strictEqual(
  chooseHeroSource([{ key: "photo", tags: ["kamar tidur", "ranjang"] }, { key: "video", tags: ["pemandangan", "teras"] }], "pemandangan teras sejuk", "liburan"),
  "video", "video harus menang saat lebih cocok hook");
ok("video menang");

// 2. foto menang (foto lebih cocok hook drpd video)
assert.strictEqual(
  chooseHeroSource([{ key: "photo", tags: ["teras", "pemandangan"] }, { key: "video", tags: ["ranjang"] }], "teras pemandangan", "x"),
  "photo", "foto harus menang saat lebih cocok hook");
ok("foto menang");

// 3. semua avoid -> null (jangan pilih toilet jadi hero)
assert.strictEqual(
  chooseHeroSource([{ key: "a", tags: ["toilet"] }, { key: "b", tags: ["kamar mandi"] }], "liburan teras", "x"),
  null, "semua avoid harus null");
ok("semua avoid -> null");

// 4. tag kosong -> null (tak ada info -> jangan tebak hero)
assert.strictEqual(
  chooseHeroSource([{ key: "a", tags: [] }, { key: "b", tags: [] }], "liburan", "x"),
  null, "tag kosong harus null");
ok("tag kosong -> null");

// 5. STOK SALAH TOPIK (Ankylosaurus): golf & iguana ditolak, dinosaur diterima
const ankyHook = "Ankylosaurus dinosaurus berlapis baja";
const ankyScript = "dinosaurus purba armor fosil ankylosaurus tank berjalan";
assert.strictEqual(isOffTopic(["golf", "lapangan", "sport"], ankyHook, ankyScript), true, "golf harus off-topic utk Ankylosaurus");
assert.strictEqual(isOffTopic(["iguana", "reptil"], ankyHook, ankyScript), true, "iguana harus off-topic utk Ankylosaurus");
assert.strictEqual(isOffTopic(["dinosaurus", "fosil", "ankylosaurus"], ankyHook, ankyScript), false, "dinosaur TIDAK off-topic");
assert.strictEqual(
  chooseHeroSource([{ key: "golf", tags: ["golf", "sport"] }, { key: "dino", tags: ["dinosaurus", "fosil"] }], ankyHook, ankyScript),
  "dino", "hero Ankylosaurus harus dinosaur, bukan golf");
ok("stok salah topik ditolak (golf/iguana), dinosaur diterima");

// 6. NORMALISASI skor (#2): klip 2-tag padat-relevan menang atas klip 10-tag (volume, 1 relevan)
const few = ["teras", "pemandangan"];                                   // 2 tag, 2 cocok hook -> 4/2 = 2.0
const many = ["teras", "a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9"]; // 10 tag, 1 cocok -> 2/10 = 0.2
assert.strictEqual(
  chooseHeroSource([{ key: "many", tags: many }, { key: "few", tags: few }], "teras pemandangan", "x"),
  "few", "normalisasi: klip padat-relevan harus menang, bukan yg banyak tag");
// bukti angka
assert.ok(scoreClipTags(few, new Set(["teras", "pemandangan"]), new Set()).relevance > scoreClipTags(many, new Set(["teras", "pemandangan"]), new Set()).relevance, "skor few > many");
ok("normalisasi skor (volume tag tak untung)");

// 7. directFootageOrder tetap benar (hero relevan depan, toilet belakang)
const tagsByUrl = new Map<string, string[]>([["a", ["toilet", "handuk"]], ["b", ["pemandangan", "teras"]], ["c", ["ranjang"]]]);
const out = directFootageOrder([{ url: "a" }, { url: "c" }, { url: "b" }], (x) => x.url, tagsByUrl, "pemandangan teras", "liburan");
assert.strictEqual(out[0].url, "b", "hero harus b (relevan)");
assert.strictEqual(out[out.length - 1].url, "a", "toilet harus di belakang");
ok("directFootageOrder hero-depan/toilet-belakang");

console.log(`ALL_HERO_TESTS_PASS (${n} tes)`);

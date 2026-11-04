// Verifikasi keputusan hero footage (Tahap 2 v2 source-aware, 2026-11-04).
// Jalankan: node --import tsx scripts/verify-hero-selection.ts  (exit 1 kalau logika salah)
// Mencakup syarat tes #7: mixed brand, klip stok pertama, skor 0, semua avoid, tag kosong,
// Ankylosaurus, + fallback (plan deterministik = dipakai render & ffmpeg sama). + sinonim #4.
import assert from "node:assert";
import { planHeroAndClips, isOffTopic, directFootageOrder, slugFromSourceUrl, planFootageSufficiency, resolveDomain, type ClipCandidate } from "@/lib/ai/footageDirector";

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

// 10. LANGKAH 1: slugFromSourceUrl ambil ISI dari source_url (bukan niat sourceQuery)
{
  assert.strictEqual(slugFromSourceUrl("https://www.pexels.com/video/close-up-of-iguana-in-natural-habitat-36016852/"), "close up of iguana in natural habitat");
  assert.strictEqual(slugFromSourceUrl("https://www.pexels.com/video/a-man-playing-golf-12345/"), "a man playing golf");
  assert.strictEqual(slugFromSourceUrl(""), "");
  ok("slugFromSourceUrl ambil isi + buang ID");
}

// 11. REGRESI Animal Story: topik Ankylosaurus, klip stok golf/iguana/kura DITOLAK via SLUG source_url
//     (bukan sourceQuery, tanpa menaruh kata "golf"/"iguana" manual). Hanya guard slug yg bekerja.
{
  const hook = "Ankylosaurus dinosaurus berlapis baja", script = "dinosaurus purba armor fosil ankylosaurus tank berjalan";
  // source_query generik (niat), source_url = isi nyata (off-topik utk dinosaurus)
  const stock = (su: string): ClipCandidate => ({ key: su, source: "stock", probe: slugFromSourceUrl(su) });
  const p = planHeroAndClips([
    stock("https://www.pexels.com/video/a-man-playing-golf-on-a-course-99/"),
    stock("https://www.pexels.com/video/close-up-of-iguana-in-natural-habitat-36016852/"),
    stock("https://www.pexels.com/video/herd-of-turtles-swimming-in-zoo-11358388/"),
    stock("https://www.pexels.com/video/oriental-garden-lizard-climbing-tree-37903088/"),
  ], hook, script);
  assert.strictEqual(p.faceless, true, "semua stok off-topik (golf/iguana/kura/lizard) -> tak ada hero -> faceless");
  assert.strictEqual(p.dropped.length, 4, "4 klip off-topik ditolak");
  assert.ok(p.dropped.every((d) => d.reason === "off_topic"), "semua ditolak via off_topic (slug), bukan avoid manual: " + JSON.stringify(p.dropped));
  // kontrol: klip dinosaur relevan DITERIMA
  const p2 = planHeroAndClips([stock("https://www.pexels.com/video/dinosaur-skeleton-fossil-museum-77/"), stock("https://www.pexels.com/video/a-man-playing-golf-99/")], hook, script);
  assert.ok(p2.heroKey && p2.heroKey.includes("dinosaur"), "klip dinosaur (slug relevan) jadi hero, golf ditolak");
  ok("REGRESI Animal Story: golf/iguana/kura ditolak via slug source_url (tanpa kata manual)");
}

// 9. directFootageOrder tetap benar
{
  const tagsByUrl = new Map<string, string[]>([["a", ["toilet"]], ["b", ["pemandangan", "teras"]], ["c", ["ranjang"]]]);
  const out = directFootageOrder([{ url: "a" }, { url: "c" }, { url: "b" }], (x) => x.url, tagsByUrl, "pemandangan teras", "liburan");
  assert.strictEqual(out[0].url, "b");
  assert.strictEqual(out[out.length - 1].url, "a");
  ok("directFootageOrder hero-depan/toilet-belakang");
}

// === GUARD v3: domain, hero/reel, forbidden-wins, sufficiency ===
// 12. #3 KATEGORI TERLARANG MENANG atas token match: golfer-mountain-view ditolak utk domain animal
//     (walau "mountain" cocok script). Tanpa kategori, "mountain" bisa bikin false-accept.
{
  const p = planHeroAndClips([
    S("golfmt", "golfer teeing off with mountain view"),  // sport -> forbidden utk animal
    S("dino", "dinosaur skeleton fossil"),
  ], "Ankylosaurus dinosaur", "dinosaur prehistoric mountain terrain", { domain: "animal" });
  const golf = p.dropped.find((d) => d.key === "golfmt");
  assert.ok(golf && golf.reason === "forbidden_category", "golfer-mountain ditolak via forbidden_category, bukan lolos: " + JSON.stringify(golf));
  assert.strictEqual(p.heroKey, "dino", "hero = dinosaur");
  ok("#3 kategori terlarang MENANG atas token match (golfer-mountain ditolak, domain animal)");
}

// 13. REEL ambient: klip hewan generik (relevansi rendah) utk domain animal -> TETAP dipakai di reel
{
  const p = planHeroAndClips([
    S("generic", "a squirrel on a branch in forest"),     // animal/nature, rel rendah vs hook spesifik
    S("relevan", "close up of pallas cat predator"),      // lebih relevan
  ], "Extreme Predator Adaptations", "predator pallas cat survival cold", { domain: "animal" });
  assert.strictEqual(p.faceless, false);
  assert.ok(p.order.includes("generic"), "klip ambient hewan TETAP di reel (domain match), tak dibuang");
  assert.strictEqual(p.heroKey, "relevan", "hero = yg relevan kuat, bukan ambient");
  ok("reel ambient domain-match dipertahankan; hero = relevan kuat (#1)");
}

// 14. Domain TAK DIKENAL -> universal (forbidden kosong) + dicatat known=false
{
  const r = resolveDomain("gamelan");
  assert.strictEqual(r.known, false);
  assert.strictEqual(r.profile.key, "universal");
  assert.strictEqual(resolveDomain("animal").known, true);
  ok("domain tak dikenal -> universal + dicatat; dikenal -> profil");
}

// 15. #4 Pixabay slug kosong -> no_basis (bukan hero), dicatat
{
  const p = planHeroAndClips([{ key: "px", source: "stock", probe: slugFromSourceUrl("https://pixabay.com/videos/id-85674/") }], "dinosaur", "x", { domain: "animal" });
  assert.strictEqual(p.faceless, true);
  assert.strictEqual(p.dropped[0].reason, "no_basis", "pixabay tanpa isi -> no_basis");
  ok("#4 Pixabay slug kosong -> no_basis, bukan hero");
}

// 16. #5 planFootageSufficiency: ok / repeat_ok / need_replacement / insufficient
{
  assert.strictEqual(planFootageSufficiency(30, 30).status, "ok");
  assert.strictEqual(planFootageSufficiency(20, 30).status, "repeat_ok");   // 1.5x <= 2
  assert.strictEqual(planFootageSufficiency(10, 30).status, "need_replacement"); // 3x > 2
  assert.strictEqual(planFootageSufficiency(10, 30, true).status, "insufficient"); // stlh cari pengganti
  assert.strictEqual(planFootageSufficiency(0, 30).status, "insufficient");
  assert.strictEqual(planFootageSufficiency(20, 30).repeatRatio, 1.5);
  ok("#5 planFootageSufficiency: ok/repeat_ok/need_replacement/insufficient + cap 2x");
}

// 17. Footage BRAND tetap hanya avoid yg dibuang (domain apa pun)
{
  const p = planHeroAndClips([B("b1", ["meja makan"]), B("b2", ["toilet"])], "liburan teras", "x", { domain: "hospitality" });
  assert.deepStrictEqual(p.dropped.map((d) => d.reason), ["avoid"], "brand: hanya avoid dibuang");
  assert.ok(p.order.includes("b1"), "brand skor rendah tetap dipakai");
  ok("footage brand: hanya avoid dibuang (semua domain)");
}

console.log(`ALL_HERO_TESTS_PASS (${n} tes)`);

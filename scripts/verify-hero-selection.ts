// Verifikasi keputusan hero footage (Tahap 2 v2 source-aware, 2026-11-04).
// Jalankan: node --import tsx scripts/verify-hero-selection.ts  (exit 1 kalau logika salah)
// Mencakup syarat tes #7: mixed brand, klip stok pertama, skor 0, semua avoid, tag kosong,
// Ankylosaurus, + fallback (plan deterministik = dipakai render & ffmpeg sama). + sinonim #4.
import assert from "node:assert";
import { planHeroAndClips, isOffTopic, directFootageOrder, slugFromSourceUrl, planFootageSufficiency, applyFootageGuard, safeFootageGuard, resolveDomain, categoryOf, matchedCategories, type ClipCandidate } from "@/lib/ai/footageDirector";
import { validateBrandKit } from "@/lib/render/brandKit";

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

// === BAGIAN 1: perbaikan guard v3 ===
// 18. #2 token UTUH (bukan substring): vacation != cat, season != sea, education/location != kategori
{
  assert.ok(!matchedCategories("family vacation trip").has("animal"), "vacation != animal(cat)");
  assert.ok(!matchedCategories("peak season sale").has("nature"), "season != nature(sea)");
  assert.ok(!matchedCategories("online education program").has("animal"), "education bukan kategori");
  assert.ok(!matchedCategories("map location pin").has("animal"), "location bukan kategori");
  assert.strictEqual(categoryOf("close up of iguana in habitat"), "animal", "iguana (token utuh) -> animal");
  ok("#2 token utuh: vacation/season/education/location tak salah-kategori");
}

// 19. #3 forbidden hit APA PUN menang: "golf course with forest lake view" ditolak utk domain animal
{
  const p = planHeroAndClips([{ key: "golfforest", source: "stock", probe: "golf course with forest lake view" }], "wildlife animals", "forest lake animals", { domain: "animal" });
  const d = p.dropped.find((x) => x.key === "golfforest");
  assert.ok(d && d.reason === "forbidden_category" && d.category === "sport", "golf+forest -> forbidden(sport) menang: " + JSON.stringify(d));
  ok("#3 forbidden hit apa pun menang (golf+forest+lake ditolak)");
}

// 20. #1 forbidden HANYA stok; brand dgn tag sport TETAP (hanya avoid dibuang)
{
  const p = planHeroAndClips([{ key: "brandgolf", source: "brand", tags: ["golf", "lapangan"] }], "promo lapangan golf", "main golf", { domain: "animal" });
  assert.strictEqual(p.faceless, false, "brand sport TIDAK forbidden -> tetap dipakai");
  assert.strictEqual(p.heroKey, "brandgolf");
  assert.deepStrictEqual(p.dropped, [], "brand tak kena forbidden (hanya avoid)");
  // tapi stok sport yg sama -> forbidden
  const p2 = planHeroAndClips([{ key: "stockgolf", source: "stock", probe: "golf lapangan" }], "promo lapangan golf", "main golf", { domain: "animal" });
  assert.strictEqual(p2.dropped[0]?.reason, "forbidden_category", "stok sport -> forbidden");
  ok("#1 forbidden hanya stok; brand sport tetap dipakai");
}

// === BAGIAN v3 lanjut: plural umum (#1) + unknown-reel (#2) - kasus nyata golden set ===
// 21. Animal: dolphins/ants (plural) dipakai; water buffalo (unknown) reel TAPI bukan hero; golf forbidden
{
  const p = planHeroAndClips([
    { key: "buffalo", source: "stock", probe: "water buffalo grazing in open field" },
    { key: "dolphins", source: "stock", probe: "dolphins swimming in blue water" },
    { key: "ants", source: "stock", probe: "ants on a green leaf" },
    { key: "golf", source: "stock", probe: "man playing golf on course" },
  ], "Dolphins and ants wildlife", "dolphin ant animals nature", { domain: "animal" });
  assert.ok(p.order.includes("buffalo"), "water buffalo (unknown) TETAP reel (#2)");
  assert.ok(p.order.includes("dolphins"), "dolphins (plural->dolphin) dipakai (#1)");
  assert.ok(p.order.includes("ants"), "ants (plural->ant) dipakai (#1)");
  assert.ok(p.dropped.some((d) => d.key === "golf" && d.reason === "forbidden_category"), "golf -> forbidden");
  assert.notStrictEqual(p.heroKey, "buffalo", "unknown TIDAK jadi hero (#2)");
  ok("#1 plural dolphins/ants dipakai; #2 water buffalo reel-bukan-hero; golf forbidden");
}
// 22. Laundry: steaming shirt (unknown) reel; towels (plural->towel) dipakai
{
  const p = planHeroAndClips([
    { key: "steam", source: "stock", probe: "person steaming a white shirt" },
    { key: "towels", source: "stock", probe: "pile of blue towels on a cart" },
  ], "Laundry pickup service", "washing clothes towel laundry", { domain: "laundry" });
  assert.ok(p.order.includes("steam"), "steaming shirt (unknown) TETAP reel");
  assert.ok(p.order.includes("towels"), "towels (plural->towel laundry) dipakai");
  assert.strictEqual(p.faceless, false);
  ok("#1 towels(plural) + #2 steaming-shirt(unknown) laundry reel");
}

// === Part 5-6 wiring: applyFootageGuard per-mode (#7) ===
// Plan acuan: dolphins=hero (relevan), buffalo=unknown reel, golf=forbidden -> dropped.
const guardPlan = planHeroAndClips([
  { key: "golf", source: "stock", probe: "man playing golf on course" },
  { key: "buffalo", source: "stock", probe: "water buffalo grazing in open field" },
  { key: "dolphins", source: "stock", probe: "dolphins swimming in blue water" },
], "Dolphins wildlife", "dolphin animals nature", { domain: "animal" });
const origOrder = ["golf", "buffalo", "dolphins"]; // urutan render asli
const origTags = ["orig-hero"];
// 23. observe: TIDAK mengubah order/heroTags, changed=false (identik 45fd784).
{
  const r = applyFootageGuard("observe", guardPlan, origOrder, (k) => k, origTags);
  assert.deepStrictEqual(r.order, origOrder, "observe: order TIDAK berubah");
  assert.deepStrictEqual(r.heroTags, origTags, "observe: heroTags TIDAK berubah");
  assert.strictEqual(r.changed, false, "observe: changed=false");
  ok("#7 observe tak ubah clips/heroTags (changed=false)");
}
// 24. hero-only: hero plan di depan, reel TIDAK dibuang, changed=true.
{
  const r = applyFootageGuard("hero-only", guardPlan, origOrder, (k) => k, origTags);
  assert.strictEqual(r.order[0], guardPlan.heroKey, "hero-only: hero di posisi 0");
  assert.strictEqual(r.order.length, origOrder.length, "hero-only: tak ada klip dibuang (reel utuh)");
  assert.deepStrictEqual([...r.order].sort(), [...origOrder].sort(), "hero-only: anggota sama, hanya urutan");
  assert.strictEqual(r.changed, true, "hero-only: changed=true");
  ok("#7 hero-only: hero depan, reel utuh (fungsi murni)");
}
// 25. full: pakai plan.order (golf dropped dibuang), heroTags=plan, changed=true.
{
  const r = applyFootageGuard("full", guardPlan, origOrder, (k) => k, origTags);
  assert.deepStrictEqual(r.order, guardPlan.order, "full: ikut plan.order");
  assert.ok(!r.order.includes("golf"), "full: golf (forbidden) dibuang");
  assert.strictEqual(r.order[0], guardPlan.heroKey, "full: hero di posisi 0");
  assert.strictEqual(r.changed, true, "full: changed=true");
  ok("#7 full: plan.order dipakai, dropped dibuang (fungsi murni)");
}

// === Perbaikan kecil (2026-11-04): error-guard, validator Brand Kit, selected stok ===
// 26. safeFootageGuard: error perhitungan TIDAK melempar -> {plan:null, error} (pipeline aman).
{
  const bomb = [{ get source(): never { throw new Error("boom-guard"); }, key: "x" }] as unknown as ClipCandidate[];
  const r = safeFootageGuard(bomb, "hook", "script");
  assert.strictEqual(r.plan, null, "error -> plan null (tak melempar)");
  assert.ok(r.error && r.error.includes("boom"), "error dicatat");
  // Kontrol: input normal -> plan ada, error null.
  const ok2 = safeFootageGuard([{ key: "a", source: "brand", tags: ["ranjang"] }], "hook", "script");
  assert.ok(ok2.plan && ok2.error === null, "input normal -> plan ada, error null");
  ok("#1 safeFootageGuard: error tak menggagalkan (plan null+catat), normal OK");
}
// 27. Validator Brand Kit footageGuardMode: observe diterima; hero-only & full DITOLAK sementara.
{
  assert.strictEqual(validateBrandKit({ footageGuardMode: "observe" }).ok, true, "observe diterima");
  assert.strictEqual(validateBrandKit({ footageGuardMode: "hero-only" }).ok, false, "hero-only ditolak");
  assert.strictEqual(validateBrandKit({ footageGuardMode: "full" }).ok, false, "full ditolak");
  assert.strictEqual(validateBrandKit({ footageGuardMode: "x" }).ok, false, "nilai asing ditolak");
  ok("#2 validator footageGuardMode: observe OK, hero-only/full ditolak");
}
// 28. Validator Brand Kit footageDomain: hanya animal/hospitality/laundry/business.
{
  for (const d of ["animal", "hospitality", "laundry", "business"]) {
    assert.strictEqual(validateBrandKit({ footageDomain: d }).ok, true, `${d} diterima`);
  }
  assert.strictEqual(validateBrandKit({ footageDomain: "sport" }).ok, false, "domain asing ditolak");
  assert.strictEqual(validateBrandKit({ footageDomain: "universal" }).ok, false, "universal tak boleh di-set eksplisit");
  ok("#2 validator footageDomain: 4 enum OK, selain itu ditolak");
}
// 29. Project isStockFootage: segment stok tanpa metadata isi (slug kosong) -> no_basis; ada slug -> dipakai.
{
  const p = planHeroAndClips([
    { key: "s0", source: "stock", probe: slugFromSourceUrl("https://pixabay.com/videos/id-85674/") }, // slug kosong
    { key: "s1", source: "stock", probe: slugFromSourceUrl("https://www.pexels.com/video/sunset-beach-palm-trees-12345/") },
  ], "sunset beach", "beach palm sunset", { domain: "hospitality" });
  assert.ok(p.dropped.some((d) => d.key === "s0" && d.reason === "no_basis"), "stok tanpa metadata -> no_basis");
  assert.ok(p.order.includes("s1"), "stok dgn slug relevan dipakai");
  ok("#3 selected stok: no metadata -> no_basis; ada slug -> dipakai");
}

console.log(`ALL_HERO_TESTS_PASS (${n} tes)`);

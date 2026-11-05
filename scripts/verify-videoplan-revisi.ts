// Revisi VideoPlan 2026-11-05: subjek footage, glossary, hook frame 0, placement aman, caption 1 baris,
// ketajaman hero, CTA + brand di akhir. Jalankan: npx tsx scripts/verify-videoplan-revisi.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { hookConfidence, subjectSource } from "../src/lib/video/footageFit";
import { CAP_PILL_WORST } from "../src/lib/video/planText";
import { buildCompositionFromPlan, type PlanMedia } from "../src/lib/video/planBuilder";
import { validateVideoPlan, type VideoPlan } from "../src/lib/video/videoPlan";
import { analyzeGray, applyGlossary, centerTexture, fixText, freeZone, isBlurry, MIN_FRAME_SHARP, officialName, subjectScore } from "../src/lib/video/footageFit";
import { captionLines } from "../src/lib/video/planText";
import { contrast, estLines, pickInk } from "../src/lib/video/sceneLibrary";
import { wordsFor } from "./verify-videoplan-builder";

let n = 0;
const ok = (m: string) => console.log(`  ok ${++n} - ${m}`);
const plan = (scenes: unknown[]): VideoPlan => {
  const p = { version: 1, orientation: "portrait", look: "warm", pacing: "calm", music: { mood: "none", volume: 0 }, brand: { tone: "premium" }, scenes };
  // Validator membandingkan total adegan non-hook dgn VO (±25%); di sini cukup cek bentuk plan.
  const v = validateVideoPlan(p, { footageIds: ["room", "food", "garden", "blur"] });
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  return (v as { plan: VideoPlan }).plan;
};
const SHARP = { sharp: 400, y0: 0.3, y1: 0.6, cy: 0.45, srcW: 1080, srcH: 1920 };
const media = (over: Partial<PlanMedia> = {}): PlanMedia => ({
  footage: {
    room: { videoUrl: "./m/room.mp4", durationSeconds: 8, subject: { description: "Kamar tidur dengan ranjang putih", tags: ["kamar", "ranjang"] }, analysis: { ...SHARP, y0: 0.55, y1: 0.9, cy: 0.72 } },
    food: { videoUrl: "./m/food.mp4", durationSeconds: 8, subject: { description: "Piring nasi dan lauk di meja warung", tags: ["makanan", "meja"] }, analysis: { ...SHARP, y0: 0.12, y1: 0.42, cy: 0.27 } },
    garden: { videoUrl: "./m/garden.mp4", durationSeconds: 8, subject: { description: "Taman hijau berbunga", tags: ["taman"] }, analysis: SHARP },
    blur: { videoUrl: "./m/blur.mp4", durationSeconds: 8, subject: { description: "Piring makanan close-up", tags: ["makanan"] }, analysis: { sharp: 12, y0: 0.3, y1: 0.7, cy: 0.5, srcW: 474, srcH: 850 } },
  },
  audioUrl: "./m/vo.mp3", audioDurationSeconds: 10, words: wordsFor(10), musicUrl: null,
  brand: { primary: "#FFFFFF", bg2: "#F2F2F2", accent: "#E8A33D", cta: "#C0392B", name: "Pelangi Homestay", mark: "PELANGI HOMESTAY" },
  seed: "rev", glossary: ["Bedugul"], ...over,
});
const S = {
  hookFood: { id: "hook", type: "hook", duration: 2.5, transition: "cut", text: "Kuliner Bedugul wajib dicoba", subject: "makanan khas", footageRef: "room" },
  menu: { id: "menu", type: "footage-caption", duration: 3, transition: "crossfade", footageRef: "garden", subject: "makanan warung", caption: "Nasi tempong dekat Pelangi" },
  room: { id: "kamar", type: "footage-caption", duration: 3, transition: "slide", footageRef: "room", subject: "kamar tidur", caption: "Kamar nyaman" },
  list: { id: "list", type: "feature-list", duration: 3, transition: "slide", footageRef: "room", subject: "kamar", title: "Fasilitas", items: ["Air panas", "Sarapan"] },
  cta: { id: "cta", type: "cta", duration: 2, transition: "crossfade", text: "Pesan via WhatsApp" },
  outro: { id: "outro", type: "logo-outro", duration: 2, transition: "crossfade", tagline: "Menginap dekat kuliner Bedugul" },
};

// 1. Subjek footage: hook "kuliner" + footage kamar -> hero diganti footage makanan yg cocok (tajam);
//    adegan "makanan warung" dgn footage taman -> adegan desain, bukan footage acak.
{
  const b = buildCompositionFromPlan(plan([S.hookFood, S.menu, S.room, S.outro]), media());
  assert.strictEqual(b.heroRef, "food"); assert.strictEqual(b.hookMode, "footage");
  assert.ok(/<video id="bg0"[^>]*src="\.\/m\/food\.mp4"/.test(b.html), "klip pertama = footage yg menggambarkan hook");
  assert.deepStrictEqual(b.designScenes, ["menu"]);
  assert.ok(!b.html.includes("./m/garden.mp4"), "footage tak cocok tidak dipakai");
  assert.ok(b.html.includes('id="sc1d"') && b.html.includes('class="vp-dcap"'), "adegan desain + caption besar");
  // Tanpa footage yang cocok dgn hook -> hook desain (latar brand), bukan footage acak.
  const m2 = media(); delete (m2.footage as Record<string, unknown>).food;
  const b2 = buildCompositionFromPlan(plan([{ ...S.hookFood, footageRef: "room" }, S.room, S.outro].map((x) => x) as unknown[]), { ...m2, footage: { room: m2.footage.room, garden: m2.footage.garden, blur: m2.footage.blur } });
  assert.strictEqual(b2.hookMode, "design"); assert.ok(b2.html.includes('id="vpHookBg"'));
  assert.ok(subjectScore("kuliner khas", { description: "piring nasi", tags: ["makanan"] }) > 0 && subjectScore("kuliner", { tags: ["kamar"] }) === 0);
}
ok("subjek: hook memilih footage yg menggambarkan isinya; footage tak cocok -> adegan/hook desain, bukan footage acak");

// 2. Glossary nama brand & istilah (kasus Pelangi: "pelani" di SRT).
{
  const ws = ["Menginap", "di", "pelani", "homstay,", "dekat", "Bedugull.", "Jalan", "pelan", "Pelangi"].map((word, i) => ({ word, start: i, end: i + 0.5 }));
  const r = applyGlossary(ws, ["Pelangi Homestay", "Bedugul"]);
  assert.deepStrictEqual(r.words.map((x) => x.word), ["Menginap", "di", "Pelangi", "Homestay,", "dekat", "Bedugul.", "Jalan", "pelan", "Pelangi"]);
  assert.strictEqual(fixText("Liburan ke pelani", ["Pelangi Homestay"]), "Liburan ke pelangi", "bagian istilah: ejaan dikoreksi, kapital tidak (revisi-3)");
  const b = buildCompositionFromPlan(plan([S.hookFood, S.room, S.outro]), media({ words: ws.map((x, i) => ({ ...x, start: i * 0.9, end: i * 0.9 + 0.5 })) }));
  assert.ok(b.captionLines.map((l) => l.text).join(" ").includes("Pelangi Homestay,") && !b.html.includes("pelani") && b.glossaryFixed.includes("pelani->Pelangi"));
}
ok("glossary: pelani homstay->Pelangi Homestay (istilah utuh), Bedugull->Bedugul; kata umum 'pelan' tetap; berlaku di caption & teks adegan");

// 3. Hook terbaca penuh di frame 0 tanpa fade dari gelap; scrim ringan; intro lama mati.
{
  const b = buildCompositionFromPlan(plan([S.hookFood, S.room, S.outro]), media());
  assert.ok(b.html.includes('tl.set("#vpHook",{visibility:"visible",opacity:1},0);'));
  assert.ok(!/tl\.fromTo\("#vpHook",\{opacity:0/.test(b.html) && !/#vpHook[^"]*",\{opacity:0[^}]*\},\{[^}]*\},0\)/.test(b.html));
  assert.ok(b.html.includes("#introLayer{display:none;}"));
  const alphas = [...b.html.matchAll(/#scrim\{background:linear-gradient\(([^;]+)\);\}/g)].pop()![1].match(/,\.?\d*\.?\d+\)/g)!.map((x) => parseFloat(x.slice(1)));
  assert.ok(Math.max(...alphas) <= 0.3, `scrim maks ${Math.max(...alphas)}`);
}
ok("hook: terlihat penuh di t=0 (tanpa fade/blur dari gelap), intro gelap lama dimatikan, scrim layar ≤0.30");

// 4. Placement aman: kartu/caption/CTA di zona yang tak menimpa subjek (analisis frame).
{
  assert.strictEqual(freeZone({ y0: 0.55, y1: 0.9 }), "top"); assert.strictEqual(freeZone({ y0: 0.1, y1: 0.4 }), "bottom");
  const b = buildCompositionFromPlan(plan([S.hookFood, S.room, S.list, S.cta, S.outro]), media());
  const sub = media().footage.room.analysis!; // subjek kamar di bawah (0.55-0.9)
  const kamar = b.windows.findIndex((w) => w.scene.id === "kamar"), list = b.windows.findIndex((w) => w.scene.id === "list");
  assert.ok(new RegExp(`#sc${kamar}\\{top:${Math.round(1920 * 0.14)}px;`).test(b.html) && new RegExp(`#sc${list}\\{top:${Math.round(1920 * 0.14)}px;`).test(b.html), "kartu di atas, subjek di bawah");
  assert.ok(sub.y0 > 0.5);
  for (const ln of b.captionLines) {
    assert.ok(ln.zone, `caption "${ln.text}" disembunyikan`);
    const w = b.windows.find((x) => ln.start >= x.start - 1e-6 && ln.start < x.start + x.dur)!;
    if (["kamar", "list"].includes(w.scene.id)) assert.strictEqual(ln.zone, "bottom", `caption "${ln.text}" harus di zona lain dari kartu`);
  }
  assert.ok(b.html.includes('class="vpdim"'), "CTA dgn peredup footage");
}
ok("placement: kartu pindah ke zona bebas subjek; caption selalu tampil di zona lain dari kartu");

// 5. Caption: 1 baris, posisi tetap (tanpa scale/y), cukup lama dibaca.
{
  const words = "Menginap di Pelangi Homestay dekat kebun stroberi dan danau Beratan yang sejuk setiap pagi bersama keluarga tercinta".split(" ").map((word, i) => ({ word, start: i * 0.32, end: i * 0.32 + 0.26 }));
  const { lines, size, maxW } = captionLines(words, { offset: 2, total: 12, w: 1080, h: 1920, font: "Poppins", zoneAt: () => "bottom" });
  for (const ln of lines) assert.strictEqual(estLines(ln.text, size, maxW, "Poppins"), 1, ln.text);
  lines.slice(0, -1).forEach((ln, i) => assert.ok(ln.end - ln.start >= Math.min(1.0, 0.045 * ln.text.length + 0.35) - 1e-9 || estLines(`${ln.text} ${lines[i + 1].text}`, size, maxW, "Poppins") > 1, `"${ln.text}" ${(ln.end - ln.start).toFixed(2)}s`));
  const b = buildCompositionFromPlan(plan([S.hookFood, S.room, S.outro]), media({ words }));
  assert.ok(!/tl\.(to|fromTo)\("#vpc\d+w\d+",[^)]*(scale|[{,]y:)/.test(b.html) && b.captionLines.every((l) => l.zone), "kata caption tanpa animasi posisi");
  assert.ok(b.html.includes("white-space:nowrap") && /\.vpcl\{position:absolute;left:0;right:0;text-align:center/.test(b.html));
  assert.ok(/\.vpcl span\{[^}]*font:800 \d+px/.test(b.html), "spasi antar-kata seukuran caption (font di span)");
}
ok("caption: tiap baris muat 1 baris, terpusat, kata muncul via opacity (tanpa loncatan), baris singkat digabung agar terbaca");

// 6. Ketajaman: klip buram tak boleh hero; tampil terbingkai tanpa upscale berlebih.
{
  const W = 120, H = 200, sharpPx = new Uint8Array(W * H), blurPx = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { sharpPx[y * W + x] = ((x >> 2) + (y >> 2)) % 2 ? 230 : 20; blurPx[y * W + x] = 125 + Math.round(40 * Math.sin(x / 9)); }
  assert.ok(analyzeGray(sharpPx, W, H).sharp > MIN_FRAME_SHARP && analyzeGray(blurPx, W, H).sharp < MIN_FRAME_SHARP);
  const m = media(); delete (m.footage as Record<string, unknown>).food; // tinggal footage makanan yg BURAM
  const b = buildCompositionFromPlan(plan([{ ...S.hookFood, footageRef: "blur" }, { ...S.room, footageRef: "blur", subject: "makanan" }, S.outro]), { ...m, footage: { room: m.footage.room, garden: m.footage.garden, blur: m.footage.blur } });
  assert.notStrictEqual(b.heroRef, "blur"); assert.strictEqual(b.hookMode, "design");
  assert.ok(b.framed.includes("blur") && /#bg\d+\{width:474px!important;height:850px!important;[^}]*transform:none!important/.test(b.html), "klip buram terbingkai tanpa upscale");
}
ok("ketajaman: analisis Laplacian membedakan tajam/buram; klip buram tak jadi hero dan tampil terbingkai (1x sumber, tanpa Ken Burns)");

// 7. Akhir video: CTA bersih + nama brand terbaca (latar solid, kontras ≥4.5, caption tertutup).
{
  for (const primary of ["#FFFFFF", "#1B4332", "#777777", "#FFD84D"]) {
    const b = buildCompositionFromPlan(plan([S.hookFood, S.room, S.cta, S.outro]), media({ brand: { ...media().brand, primary } }));
    const last = b.windows.length - 1;
    assert.ok(b.html.includes(`<div class="c">Pesan via WhatsApp</div>`) && new RegExp(`#sc${last}\\{[^}]*background:${primary};`).test(b.html));
    assert.ok(contrast(pickInk(primary), primary) >= 4.5);
    assert.ok(/z-index:690/.test(b.html) && /\.vpcl\{[^}]*z-index:500/.test(b.html), "outro menutup caption");
    assert.ok(new RegExp(`tl\\.fromTo\\("#sc${last} \\.c"`).test(b.html), "pil CTA muncul di outro");
  }
}
{
  const b = buildCompositionFromPlan(plan([S.hookFood, S.room, { ...S.cta, duration: 3 }]), media());
  assert.ok(b.html.includes('id="sc99"') && b.html.includes('<div class="c">Pesan via WhatsApp</div>') && b.html.includes(">PELANGI HOMESTAY</div>"), "plan berakhir CTA -> end card brand");
}
ok("akhir: logo-outro latar solid brand (nama brand kontras ≥4.5 di 4 warna), CTA diulang sbg pil, caption tak menimpa; plan berakhir CTA dapat end card brand");

// 8. Footage tampil: latar bingkai ada di wrapper #cwK (z-index di atas klip sebelumnya). Wrapper WAJIB
//    tersembunyi di luar jendela klipnya, kalau tidak latar klip berikutnya menutup footage yg sedang tayang
//    (bug fixture 2026-11-05: laundry/animal hanya gradasi gelap). + QC frame tengah tak seragam.
{
  const lo = { sharp: 9, y0: 0.2, y1: 0.8, cy: 0.5, srcW: 360, srcH: 640 };
  const f = media().footage;
  const m = media({ footage: { room: { ...f.room, analysis: lo }, garden: { ...f.garden, analysis: lo }, food: { ...f.food, analysis: { ...lo, sharp: 15 } } } });
  const b = buildCompositionFromPlan(plan([S.hookFood, { ...S.menu, subject: "taman" }, S.room, S.outro]), m);
  assert.ok(b.framed.length >= 2, `framed=${b.framed}`);
  const wraps = [...b.html.matchAll(/#cw(\d+)\{background:/g)].map((x) => x[1]);
  assert.strictEqual(wraps.length, b.framed.length);
  for (const k of wraps) {
    assert.ok(b.html.includes(`tl.set("#cw${k}",{visibility:"hidden"},0);tl.set("#cw${k}",{visibility:"visible"},s);tl.set("#cw${k}",{visibility:"hidden"},e);})(document.getElementById("bg${k}").dataset);`), `wrapper cw${k} tanpa gerbang waktu`);
    assert.ok(new RegExp(`<div class="clipwrap" id="cw${k}"[^>]*><video id="bg${k}" [^>]*data-start="[\\d.]+" data-duration="[\\d.]+"`).test(b.html));
  }
  const W = 90, H = 160, flat = new Uint8Array(W * H), tex = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { flat[y * W + x] = 20 + Math.round(y / 16); tex[y * W + x] = ((x * 7) ^ (y * 13)) & 255; }
  assert.ok(!centerTexture(flat, W, H).ok && centerTexture(tex, W, H).ok);
}
ok("footage: latar bingkai hanya tampil di jendela klipnya (tak menutup klip lain); QC tengah frame menolak frame kosong");

// 9. Glossary tak pernah menurunkan huruf besar (nama brand di DB huruf kecil: "laundry in bali").
{
  assert.strictEqual(officialName("laundry in bali"), "Laundry in Bali"); assert.strictEqual(officialName("Pelangi Homestay"), "Pelangi Homestay");
  assert.strictEqual(fixText("Laundry in Bali siap jemput", ["laundry in bali"]), "Laundry in Bali siap jemput");
  assert.deepStrictEqual(applyGlossary([{ word: "Laundry", start: 0, end: 1 }, { word: "BALI", start: 1, end: 2 }], ["laundry", "bali"]).fixed, []);
  assert.strictEqual(fixText("menginap di homestay", ["Pelangi Homestay"]), "menginap di homestay", "bagian istilah saja tak dikapitalisasi (revisi-3)");
  const ws = ["Laundry", "in", "Bali,", "laundri", "kilat"].map((word, i) => ({ word, start: i * 0.9, end: i * 0.9 + 0.5 }));
  const b = buildCompositionFromPlan(plan([S.hookFood, { ...S.room, caption: "Laundry in Bali dekat Denpasar" }, S.outro]), media({ words: ws, brand: { ...media().brand, name: "laundry in bali", mark: "LAUNDRY IN BALI" } }));
  assert.ok(b.html.includes("Laundry in Bali dekat") && !/laundry In bali|Laundry->laundry/.test(b.html + b.glossaryFixed.join()), b.glossaryFixed.join());
  assert.ok(b.captionLines.map((l) => l.text).join(" ").startsWith("Laundry in Bali, laundry"), "laundri->laundry (ejaan, gaya huruf asli), Laundry in Bali tetap");
}
ok("glossary: perubahan huruf besar/kecil saja diabaikan; nama brand huruf kecil di DB -> nama resmi title-case; bagian istilah tak dikapitalisasi");

// 10. Placement: proxy subjek lebar (0.16-0.85, menimpa kedua zona) -> caption TETAP tampil, tak ada yg disembunyikan.
{
  const wide = { sharp: 400, y0: 0.16, y1: 0.85, cy: 0.5, srcW: 1080, srcH: 1920 };
  const m = media({ footage: Object.fromEntries(Object.entries(media().footage).map(([k, v]) => [k, { ...v, analysis: wide }])) as PlanMedia["footage"] });
  const b = buildCompositionFromPlan(plan([S.hookFood, S.room, S.list, S.cta, S.outro]), m);
  assert.ok(b.captionLines.length > 3 && b.captionLines.every((l) => l.zone), `tersembunyi ${b.captionLines.filter((l) => !l.zone).length}`);
  assert.strictEqual((b.html.match(/class="vpcl"/g) ?? []).length, b.captionLines.length);
}
ok("placement: subjek menimpa semua zona -> caption tetap tampil (paling banyak dipindah), tak pernah disembunyikan");

// 11. Ketajaman relatif: hero = klip tertajam yg cocok subjek; buram (< 0.5x tertajam) tak boleh hero.
{
  const mk = (vals: number[]) => media({ footage: Object.fromEntries(vals.map((sharp, i) => [`c${i}`, { videoUrl: `./m/c${i}.mp4`, durationSeconds: 8, subject: { description: i < 2 ? "piring makanan warung" : "kamar tidur", tags: [], source: "vision" }, analysis: { sharp, y0: 0.3, y1: 0.6, cy: 0.45, srcW: 478, srcH: 850 } }])) as PlanMedia["footage"] });
  const hp = (vals: number[]) => {
    const p = plan([S.hookFood, S.room, S.outro]);
    p.scenes = p.scenes.map((s) => ("footageRef" in s ? { ...s, footageRef: s.type === "hook" ? "c0" : "c2" } : s)) as VideoPlan["scenes"];
    return buildCompositionFromPlan(p, mk(vals));
  };
  // laundry: makanan = c0 6.8 & c1 5.3; tertajam global c2 15.6 -> keduanya < 7.8 (buram) -> hook desain
  assert.strictEqual(hp([6.8, 5.3, 15.6, 5.1, 2.1]).hookMode, "design");
  // nilai absolut rendah tapi relatif tajam -> boleh hero (dulu ditolak batas absolut 60); tertajam yg cocok menang
  assert.strictEqual(hp([14, 22.1, 6.3, 7.2, 19.7]).heroRef, "c1");
  // hospitality: c0 17.8 buram vs c1 109.2 -> hero c1 walau hook menunjuk c0
  assert.strictEqual(hp([17.8, 109.2, 98.2, 55.5, 13.5]).heroRef, "c1");
  assert.ok(isBlurry(17.8, 109.2) && !isBlurry(55.5, 109.2) && !isBlurry(undefined, 109.2));
  // cocok subjek tetap wajib: klip tertajam tak cocok & yg cocok buram -> desain
  assert.strictEqual(hp([3, 2, 109, 100, 90]).hookMode, "design");
}
ok("ketajaman relatif: hero = tertajam yg cocok subjek, buram (<0.5x tertajam) hanya pendukung; hook tetap wajib cocok subjek");

// ===== Revisi-3 (2026-11-05 malam) =====
const LO = { sharp: 9, y0: 0.2, y1: 0.8, cy: 0.5, srcW: 478, srcH: 850 }; // laundry: klip vertikal kecil & buram
const overlap = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

// 12. (#6) Hook tak menimpa subjek: hero terbingkai -> teks di luar bingkai; hero full-bleed -> di luar rentang subjek.
{
  const f = media().footage;
  const fr = buildCompositionFromPlan(plan([{ ...S.hookFood, footageRef: "food" }, S.room, S.outro]), media({ footage: { food: { ...f.food, analysis: LO }, room: { ...f.room, analysis: { ...f.room.analysis!, sharp: 12 } } } }));
  assert.strictEqual(fr.heroRef, "food"); assert.ok(fr.framed.includes("food"));
  assert.deepStrictEqual(fr.hookAvoid, [535, 1385], "bingkai hero 478x850 di tengah");
  assert.strictEqual(overlap(fr.hookBox!, fr.hookAvoid!), 0, `hook ${fr.hookBox} menimpa bingkai ${fr.hookAvoid}`);
  assert.ok(fr.hookBox![0] >= Math.round(1920 * 0.12), "hook tetap di title-safe");
  assert.ok(fr.html.includes('tl.set("#vpHook",{visibility:"visible",opacity:1},0);') && !/tl\.fromTo\("#vpHook span",\{scale/.test(fr.html), "terbaca di t=0, tanpa membesar");
  // subjek full-bleed di bawah (food 0.12-0.42 -> teks di bawah), subjek di atas-tengah (room 0.55-0.9 -> teks di atas)
  for (const [ref, an] of [["food", f.food.analysis!], ["food", { ...SHARP, y0: 0.5, y1: 0.85 }]] as const) {
    const b = buildCompositionFromPlan(plan([{ ...S.hookFood, footageRef: ref }, S.room, S.outro]), media({ footage: { ...f, food: { ...f.food, analysis: an } } }));
    assert.strictEqual(overlap(b.hookBox!, [Math.round(an.y0 * 1920), Math.round(an.y1 * 1920)]), 0, `full-bleed ${b.hookBox} vs ${an.y0}-${an.y1}`);
  }
}
ok("#6 hook: tak menimpa bingkai/subjek hero (pita bebas di atas/bawah, font menyesuaikan), terbaca penuh di t=0");

// 13. (#7) Keyakinan hook: metadata query Pexels saja / cocok lemah -> hook desain; deskripsi isi frame & cakupan ≥50% -> footage.
{
  const q = { description: "vampire finch pecking seabird blood feeding", tags: [] };
  assert.strictEqual(subjectSource(q), "query"); assert.strictEqual(subjectSource({ description: "x", tags: ["a"] }), "vision");
  assert.deepStrictEqual(hookConfidence("burung minum darah", q), { ok: false, reason: "metadata hanya query pencarian" });
  assert.ok(!hookConfidence("burung minum darah", { ...q, source: "query", tags: ["finch"] }).ok, "source eksplisit menang atas tags");
  assert.ok(hookConfidence("pakaian bersih", { description: "Seseorang melipat pakaian di meja", tags: ["melipat pakaian"] }).ok, "1/2 token = 50% -> yakin");
  assert.deepStrictEqual(hookConfidence("burung laut minum darah", { description: "burung kecil di tangan", tags: ["burung", "tangan"] }), { ok: false, reason: "cocok lemah 1/4" });
  assert.ok(!hookConfidence("burung", undefined).ok && !hookConfidence("burung", { description: "kamar", tags: ["kamar"] }).ok);
  // animal fixture: semua kandidat hanya query -> hook desain walau footage tajam & kata cocok
  const fq = Object.fromEntries(["c1", "c2", "c3"].map((k, i) => [k, { videoUrl: `./m/${k}.mp4`, durationSeconds: 8, subject: q, analysis: { ...SHARP, sharp: 300 + i } }]));
  const p = plan([{ ...S.hookFood, text: "This bird drinks BLOOD", subject: "burung minum darah", footageRef: "room" }, S.room, S.outro]);
  const b = buildCompositionFromPlan(p, media({ footage: { ...fq, room: media().footage.room } as PlanMedia["footage"] }));
  assert.strictEqual(b.hookMode, "design"); assert.strictEqual(b.hookWhy.c2, "metadata hanya query pencarian");
  const b2 = buildCompositionFromPlan(p, media({ footage: { ...fq, room: media().footage.room, v: { videoUrl: "./m/v.mp4", durationSeconds: 8, subject: { description: "burung finch minum darah burung laut", tags: ["burung", "darah"] }, analysis: SHARP } } as PlanMedia["footage"] }));
  assert.strictEqual(b2.heroRef, "v");
}
ok("#7 hook yakin: query Pexels saja/cocok lemah (<50% token) -> hook desain; deskripsi isi frame cocok -> footage");

// 14. (#8) Caption selalu kontras: kata muncul instan (tanpa tween opacity), pil gelap ≥.8, aksen kontras rendah -> putih.
{
  const b = buildCompositionFromPlan(plan([S.hookFood, S.room, S.outro]), media());
  assert.ok(!/tl\.(to|fromTo)\("#vpc\d+w\d+"/.test(b.html), "tanpa tween pada kata caption");
  assert.ok(/tl\.set\("#vpc0w0",\{opacity:1,color:"#E8A33D"\}/.test(b.html), "kata tampil penuh + aksen sekaligus");
  assert.ok(/\.vpcl b\{[^}]*opacity:0;background:rgba\(8,10,14,\.8\)/.test(b.html));
  assert.ok(contrast("#FFFFFF", CAP_PILL_WORST) >= 7 && contrast("#E8A33D", CAP_PILL_WORST) >= 4.5);
  const dark = buildCompositionFromPlan(plan([S.hookFood, S.room, S.outro]), media({ brand: { ...media().brand, accent: "#1B4332" } }));
  assert.ok(/tl\.set\("#vpc0w0",\{opacity:1,color:"#FFFFFF"\}/.test(dark.html) && !dark.html.includes('color:"#1B4332"'), "aksen gelap tak dipakai di pil gelap");
}
ok("#8 caption: kata muncul instan & penuh (tak pernah pudar), pil gelap .8 (kontras putih ≥7 di atas footage putih), aksen kontras rendah -> putih");

// 15. (#9) Kapitalisasi glossary hanya istilah utuh.
{
  const G = ["Nasi Tempong", "Bedugul"];
  assert.strictEqual(fixText("makan nasi di warung", G), "makan nasi di warung");
  assert.strictEqual(fixText("coba nasi tempong pedas", G), "coba Nasi Tempong pedas");
  assert.strictEqual(fixText("Nasi tempong, enak", G), "Nasi Tempong, enak");
  assert.strictEqual(fixText("NASI TEMPONG murah", G), "NASI TEMPONG murah", "gaya huruf besar semua dibiarkan");
  assert.strictEqual(fixText("tempong saja", G), "tempong saja");
  assert.strictEqual(fixText("nasi, tempong", G), "nasi, tempong", "tanda baca memutus istilah");
  assert.strictEqual(fixText("ke bedugul", G), "ke Bedugul", "istilah 1 kata = istilah utuh");
  const ws = ["Ada", "nasi", "dan", "nasi", "tempong."].map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const r = applyGlossary(ws, G);
  assert.deepStrictEqual(r.words.map((x) => x.word), ["Ada", "nasi", "dan", "Nasi", "Tempong."]);
  assert.deepStrictEqual(r.fixed, ["nasi->Nasi", "tempong->Tempong"]);
}
ok("#9 glossary: 'nasi' saja tetap, 'nasi tempong' -> 'Nasi Tempong'; huruf besar semua & tanda baca dihormati");

// 16. (#10) Nama brand resmi di teks adegan: "Laundry In Bali" -> "Laundry in Bali"; fixture plan juga benar.
{
  const fx = JSON.parse(readFileSync("scripts/fixtures/videoplan-render/laundry.plan.json", "utf8"));
  assert.strictEqual(fx.scenes.find((x: { id: string }) => x.id === "svc").title, "Laundry in Bali");
  const br = { ...media().brand, name: "laundry in bali", mark: "LAUNDRY IN BALI" };
  const b = buildCompositionFromPlan(plan([S.hookFood, { ...S.list, title: "Laundry In Bali" }, { ...S.room, caption: "laundry in bali siap jemput" }, S.outro]), media({ brand: br }));
  assert.ok(b.html.includes(">Laundry in Bali</div>") && !b.html.includes("Laundry In Bali"), "judul kartu = nama resmi");
  assert.ok(b.html.includes("Laundry in Bali siap jemput"), "huruf kecil semua -> nama resmi");
  assert.ok(b.html.includes(">LAUNDRY IN BALI</div>"), "mark (gaya) tetap huruf besar");
}
ok("#10 nama brand resmi: 'Laundry In Bali'/'laundry in bali' di teks adegan -> 'Laundry in Bali'; fixture laundry diperbaiki");

// 17. (#11) Pil caption mengikuti kata yg tampil: pil per kata (kata rapat tanpa spasi teks), baris tetap terpusat.
{
  const b = buildCompositionFromPlan(plan([S.hookFood, S.room, S.outro]), media());
  const line = /<div class="vpcl" id="vpc0"[^>]*><span>(.*?)<\/span><\/div>/.exec(b.html)![1];
  assert.ok(/^(<b id="vpc0w\d+">[^<]*<\/b>)+$/.test(line), `kata rapat tanpa spasi: ${line}`);
  assert.ok(/\.vpcl span\{display:inline-block;white-space:nowrap;font:800 \d+px\/1\.2 [^;]+;\}/.test(b.html), "span tanpa latar (pil tidak selebar baris)");
  assert.ok(/\.vpcl b\{[^}]*background:rgba\(8,10,14,\.8\);padding:\d+px \d+px;/.test(b.html) && /\.vpcl b:first-child\{border-radius/.test(b.html));
  assert.ok(/\.vpcl\{position:absolute;left:0;right:0;text-align:center/.test(b.html), "posisi baris tetap (semua kata ditata sejak awal, opacity 0)");
}
ok("#11 pil caption per kata: tumbuh kata demi kata tanpa ruang kosong, posisi baris tetap");

// 18. (#12) Bayangan bingkai di ::before wrapper (bertahan saat HyperFrames ganti <video> dgn <img>), ikut gerbang waktu.
{
  const f = media().footage;
  const b = buildCompositionFromPlan(plan([{ ...S.hookFood, footageRef: "food" }, S.room, S.outro]), media({ footage: { food: { ...f.food, analysis: LO }, room: { ...f.room, analysis: { ...f.room.analysis!, sharp: 12 } } } }));
  const k = b.clipScenes.indexOf("hook");
  assert.ok(new RegExp(`#cw${k}::before\\{content:"";position:absolute;width:478px;height:850px;left:301px;top:535px;border-radius:28px;box-shadow:0 24px 60px`).test(b.html));
  assert.ok(!new RegExp(`#bg${k}\\{[^}]*box-shadow`).test(b.html), "bayangan tak lagi di <video>");
  assert.ok(b.html.includes(`tl.set("#cw${k}",{visibility:"visible"},s);`), "bayangan hanya tampil di jendela klip (gerbang wrapper)");
}
ok("#12 bingkai: bayangan+garis di ::before wrapper (bertahan di render), hanya tampil di jendela klipnya");

// 19. (#13) Klip terbingkai: tanpa upscale (sumber ≥40% lebar), tanpa transisi zoom/whip (scale) maupun Ken Burns.
{
  const f = media().footage;
  const tiny = { ...LO, srcW: 360, srcH: 640 };
  const b = buildCompositionFromPlan(plan([S.hookFood, { ...S.menu, subject: "taman", transition: "zoom" }, { ...S.room, transition: "whip" }, S.outro]),
    media({ footage: { ...f, garden: { ...f.garden, analysis: LO }, room: { ...f.room, analysis: tiny } } }));
  const kg = b.clipScenes.indexOf("menu"), kr = b.clipScenes.indexOf("kamar");
  assert.ok(new RegExp(`#bg${kg}\\{width:478px!important;height:850px!important`).test(b.html), "1x sumber");
  assert.ok(new RegExp(`#bg${kr}\\{width:432px!important;height:768px!important`).test(b.html), "sumber kecil -> maks 40% lebar layar");
  for (const k of [kg, kr]) assert.ok(!new RegExp(`tl\\.fromTo\\("#cw${k}",\\{[^}]*scale`).test(b.html), `cw${k} tanpa tween scale`);
  assert.ok(new RegExp(`tl\\.fromTo\\("#cw${kg}",\\{xPercent`).test(b.html), "zoom -> slide");
}
ok("#13 klip buram terbingkai: tanpa upscale (≤ sumber, min 40% lebar), transisi zoom/whip -> slide (tanpa scale)");
console.log(`ALL_VIDEOPLAN_REVISI_TESTS_PASS (${n} tes)`);

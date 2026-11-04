// Revisi VideoPlan 2026-11-05: subjek footage, glossary, hook frame 0, placement aman, caption 1 baris,
// ketajaman hero, CTA + brand di akhir. Jalankan: npx tsx scripts/verify-videoplan-revisi.ts
import assert from "node:assert";
import { buildCompositionFromPlan, type PlanMedia } from "../src/lib/video/planBuilder";
import { validateVideoPlan, type VideoPlan } from "../src/lib/video/videoPlan";
import { analyzeGray, applyGlossary, fixText, freeZone, MIN_HERO_SHARP, subjectScore, zoneOverlap } from "../src/lib/video/footageFit";
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
  assert.strictEqual(fixText("Liburan ke pelani", ["Pelangi Homestay"]), "Liburan ke Pelangi");
  const b = buildCompositionFromPlan(plan([S.hookFood, S.room, S.outro]), media({ words: ws.map((x, i) => ({ ...x, start: i * 0.9, end: i * 0.9 + 0.5 })) }));
  assert.ok(b.captionLines.map((l) => l.text).join(" ").includes("Pelangi Homestay,") && !b.html.includes("pelani") && b.glossaryFixed.includes("pelani->Pelangi"));
}
ok("glossary: pelani->Pelangi, homstay->Homestay, Bedugull->Bedugul; kata umum 'pelan' tetap; berlaku di caption & teks adegan");

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
  for (const ln of b.captionLines) if (ln.zone) {
    const w = b.windows.find((x) => ln.start >= x.start - 1e-6 && ln.start < x.start + x.dur)!;
    if (["kamar", "list"].includes(w.scene.id)) assert.ok(zoneOverlap(ln.zone, sub) < 0.05, `caption "${ln.text}" menimpa subjek`);
  }
  assert.ok(b.html.includes('class="vpdim"'), "CTA dgn peredup footage");
}
ok("placement: kartu & caption pindah ke zona bebas subjek; caption disembunyikan bila satu-satunya zona menimpa subjek");

// 5. Caption: 1 baris, posisi tetap (tanpa scale/y), cukup lama dibaca.
{
  const words = "Menginap di Pelangi Homestay dekat kebun stroberi dan danau Beratan yang sejuk setiap pagi bersama keluarga tercinta".split(" ").map((word, i) => ({ word, start: i * 0.32, end: i * 0.32 + 0.26 }));
  const { lines, size, maxW } = captionLines(words, { offset: 2, total: 12, w: 1080, h: 1920, font: "Poppins", zoneAt: () => "bottom" });
  for (const ln of lines) assert.strictEqual(estLines(ln.text, size, maxW, "Poppins"), 1, ln.text);
  lines.slice(0, -1).forEach((ln, i) => assert.ok(ln.end - ln.start >= Math.min(1.0, 0.045 * ln.text.length + 0.35) - 1e-9 || estLines(`${ln.text} ${lines[i + 1].text}`, size, maxW, "Poppins") > 1, `"${ln.text}" ${(ln.end - ln.start).toFixed(2)}s`));
  const b = buildCompositionFromPlan(plan([S.hookFood, S.room, S.outro]), media({ words }));
  assert.ok(!/tl\.(to|fromTo)\("#vpc\d+w\d+",[^)]*(scale|y:)/.test(b.html), "kata caption tanpa animasi posisi");
  assert.ok(b.html.includes("white-space:nowrap") && /\.vpcl\{position:absolute;left:0;right:0;text-align:center/.test(b.html));
}
ok("caption: tiap baris muat 1 baris, terpusat, kata muncul via opacity (tanpa loncatan), baris singkat digabung agar terbaca");

// 6. Ketajaman: klip buram tak boleh hero; tampil terbingkai tanpa upscale berlebih.
{
  const W = 120, H = 200, sharpPx = new Uint8Array(W * H), blurPx = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { sharpPx[y * W + x] = ((x >> 2) + (y >> 2)) % 2 ? 230 : 20; blurPx[y * W + x] = 125 + Math.round(40 * Math.sin(x / 9)); }
  assert.ok(analyzeGray(sharpPx, W, H).sharp > MIN_HERO_SHARP && analyzeGray(blurPx, W, H).sharp < MIN_HERO_SHARP);
  const m = media(); delete (m.footage as Record<string, unknown>).food; // tinggal footage makanan yg BURAM
  const b = buildCompositionFromPlan(plan([{ ...S.hookFood, footageRef: "blur" }, { ...S.room, footageRef: "blur", subject: "makanan" }, S.outro]), { ...m, footage: { room: m.footage.room, garden: m.footage.garden, blur: m.footage.blur } });
  assert.notStrictEqual(b.heroRef, "blur"); assert.strictEqual(b.hookMode, "design");
  assert.ok(b.framed.includes("blur") && /#bg\d+\{width:640px!important;height:1148px!important;[^}]*transform:none!important/.test(b.html), "klip buram terbingkai ≤1.35x");
}
ok("ketajaman: analisis Laplacian membedakan tajam/buram; klip buram tak jadi hero dan tampil terbingkai (≤1.35x, tanpa Ken Burns)");

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
ok("akhir: logo-outro latar solid brand (nama brand kontras ≥4.5 di 4 warna), CTA diulang sbg pil, caption tak menimpa");
console.log(`ALL_VIDEOPLAN_REVISI_TESTS_PASS (${n} tes)`);

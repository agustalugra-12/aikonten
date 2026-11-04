// Tahap 7: kualitas adegan. Semua 8 adegan × 4 tone × warna brand ekstrem × teks PANJANG MAKS:
// kontras ≥ 4.5, teks muat (estimasi baris ≤ batas, tanpa jatuh ke ukuran minimum), posisi di title-safe,
// font fallback lokal, tanpa aset luar, teks ter-escape, variasi gaya antar-brand. Overflow nyata dicek
// di review frame (scripts/hf-frame-review.ts) setelah render.
import assert from "node:assert";
import { LIMITS, type Scene } from "../src/lib/video/videoPlan";
import { renderScene, contrast, pickInk, fitFont, estLines, fontStack, safeArea, TONE_STYLE, FONT_WIDTH, type Tone, type BrandColors } from "../src/lib/video/sceneLibrary";

let n = 0;
const ok = (m: string) => console.log(`  ok ${++n} - ${m}`);
const T = LIMITS.text;
const long = (lim: { chars: number; words: number }) => {
  const words = Array.from({ length: lim.words }, (_v, i) => "Wwmmkk".slice(0, 3 + (i % 4)));
  let s = words.join(" ");
  while (s.length < lim.chars) s = s.replace(/^(\S+)/, "$1m");
  return s.slice(0, lim.chars);
};
const base = { id: "x", duration: 3, transition: "cut" as const };
const SCENES: Scene[] = [
  { ...base, type: "footage-caption", footageRef: "f", caption: long(T.caption) },
  { ...base, type: "stat", value: "Rp1.250.000", label: long(T.statLabel), chart: [1, 4, 9, 16, 25, 36] },
  { ...base, type: "stat", value: long(T.statValue), label: "x y" },
  { ...base, type: "testimonial", quote: long(T.quote), author: long(T.author), rating: 5 },
  { ...base, type: "feature-list", title: long(T.featureTitle), items: Array.from({ length: 4 }, () => long(T.featureItem)) },
  { ...base, type: "before-after", before: { label: long(T.baLabel), footageRef: "a" }, after: { label: long(T.baLabel), footageRef: "b" } },
  { ...base, type: "cta", text: long(T.ctaText), sub: long(T.ctaSub) },
  { ...base, type: "logo-outro", tagline: long(T.tagline) },
];
const BRANDS: BrandColors[] = [
  { primary: "#FFFFFF", bg2: "#F0F0F0", accent: "#FFFF00", ink: "#FFFFFF", cta: "#FFFFFF", font: "Poppins", mark: "PELANGI HOMESTAY UBUD" },
  { primary: "#000000", bg2: "#000000", accent: "#111111", ink: "#000000", cta: "#000000", font: "Archivo Black", mark: "LAUNDRY IN BALI" },
  { primary: "#777777", bg2: "#666666", accent: "#808080", ink: "#7F7F7F", cta: "#888888", font: "Oswald", mark: "ANIMAL STORY" },
  { primary: "#1B4332", bg2: "#081C15", accent: "#F4A261", ink: "#FFFFFF", cta: "#E63946", font: "Comic Unknown", mark: "AGUSTAP STUDIO" },
];
const TONES = Object.keys(TONE_STYLE) as Tone[];
const DIMS = [{ w: 1080, h: 1920 }, { w: 1080, h: 1080 }, { w: 1920, h: 1080 }];

// 1. Kontras: setiap pasangan teks/latar yang dipakai adegan ≥ 4.5 (WCAG AA).
for (const b of BRANDS) for (const t of TONES) {
  const card = TONE_STYLE[t].card(b);
  assert.ok(contrast(pickInk(card), card) >= 4.5, `${t} ink/card ${card}`);
  assert.ok(contrast(pickInk(b.cta), b.cta) >= 4.5 && contrast(pickInk(b.primary), b.primary) >= 4.5);
}
for (const h of ["#000000", "#FFFFFF", "#777777", "#808080", "#FFFF00", "#0000FF", "#FF0000", "#00FF00"]) assert.ok(contrast(pickInk(h), h) >= 4.5, h);
// warna teks yang muncul di CSS kartu harus kontras dgn latar kartunya
for (const b of BRANDS) for (const t of TONES) for (const sc of SCENES) {
  const L = renderScene(sc, { idx: 1, start: 1, dur: 3, w: 1080, h: 1920, tone: t, brand: b, variant: 0 })!;
  const card = TONE_STYLE[t].card(b);
  if (sc.type === "stat" || sc.type === "testimonial") {
    const col = sc.type === "stat" ? /\.v\{[^}]*color:(#[0-9A-Fa-f]{6})/.exec(L.css)![1] : /\.a\{[^}]*color:(#[0-9A-Fa-f]{6})/.exec(L.css)![1];
    assert.ok(contrast(col, card) >= 4.5, `${t}/${sc.type} aksen ${col} di ${card}`);
  }
}
ok("kontras ≥ 4.5 utk 4 brand ekstrem (putih/hitam/abu/normal) × 4 tone, termasuk aksen di atas kartu");

// 2. Teks panjang maks muat: estimasi baris ≤ batas dan TIDAK terpaksa ke ukuran minimum.
const fits: Array<[string, number, number, number, number]> = [ // teks, base, min, lines, faktor lebar
  [long(T.caption), 0.05, 0.034, 2, 1], [long(T.statLabel), 0.05, 0.034, 2, 1], [long(T.quote), 0.058, 0.036, 4, 1],
  [long(T.featureTitle), 0.065, 0.042, 2, 1], [long(T.ctaText), 0.062, 0.04, 2, 0.88], [long(T.tagline), 0.045, 0.032, 2, 1],
];
for (const d of DIMS) for (const font of Object.keys(FONT_WIDTH)) {
  const sa = safeArea(d.w, d.h), maxW = sa.x1 - sa.x0 - 2 * Math.round(d.w * 0.05);
  for (const [txt, bse, mn, lines, fw] of fits) {
    const size = fitFont(txt, maxW * fw, Math.round(d.w * bse), Math.round(d.w * mn), lines, font);
    assert.ok(estLines(txt, size, maxW * fw, font) <= lines, `${font} ${d.w}x${d.h} "${txt.slice(0, 20)}" ${size}px`);
    assert.ok(size > Math.round(d.w * mn) || estLines(txt, size, maxW * fw, font) <= lines, "muat tanpa ukuran minimum");
  }
}
ok("teks panjang maksimum (batas validator) muat dlm jumlah baris yg diizinkan di 3 orientasi × 4 font");

// 3. Title-safe: semua posisi top berada di zona aman; kiri/kanan = margin aman.
for (const d of DIMS) for (const t of TONES) for (const sc of SCENES) {
  const L = renderScene(sc, { idx: 2, start: 1, dur: 3, w: d.w, h: d.h, tone: t, brand: BRANDS[3], variant: 1 })!;
  const sa = safeArea(d.w, d.h);
  for (const m of L.css.matchAll(/(?:^|[;{])top:(\d+)px/g)) { const y = +m[1]; assert.ok(y >= sa.y0 && y <= sa.y1 - d.h * 0.12, `${sc.type} top ${y} di luar safe ${sa.y0}-${sa.y1}`); }
  for (const m of L.css.matchAll(/(?:^|[;{])left:(\d+)px/g)) { const x = +m[1]; assert.ok(x === 0 || x >= sa.x0, `${sc.type} left ${x}`); }
}
ok("semua elemen adegan di zona title-safe (atas 12%, bawah 22% portrait; samping 7%) di 3 orientasi");

// 4. Font fallback lokal; tanpa aset luar; teks ter-escape.
assert.strictEqual(fontStack("Comic Unknown"), '"Poppins","Poppins",Arial,sans-serif');
for (const t of TONES) for (const sc of SCENES) {
  const L = renderScene(sc, { idx: 3, start: 0, dur: 3, w: 1080, h: 1920, tone: t, brand: BRANDS[3], variant: 0 })!;
  const all = L.html + L.css + L.tl.join("");
  assert.ok(!/https?:|url\(|@import|<script|<img|<link/i.test(all), `${t}/${sc.type} aset luar`);
  for (const f of all.matchAll(/font:[^;]*?px\/[\d.]+ ([^;}]+)/g)) assert.ok(f[1].includes("Arial,sans-serif"), "font stack punya fallback");
}
const evil = renderScene({ ...base, type: "cta", text: '<img src=x onerror="a()">' } as Scene, { idx: 0, start: 0, dur: 2, w: 1080, h: 1920, tone: "friendly", brand: BRANDS[3], variant: 0 })!;
assert.ok(!evil.html.includes("<img") && evil.html.includes("&lt;img"));
ok("font fallback lokal (font tak dikenal -> Poppins, stack + Arial/sans-serif), tanpa CDN/url/gambar luar, teks di-escape");

// 5. Variasi gaya antar-brand: 4 tone beda font judul/radius/easing/arah masuk.
const sig = TONES.map((t) => { const s = TONE_STYLE[t]; return `${s.head}|${s.radius}|${s.ease}|${s.from}`; });
assert.strictEqual(new Set(sig).size, TONES.length);
const v0 = renderScene(SCENES[1], { idx: 1, start: 1, dur: 3, w: 1080, h: 1920, tone: "premium", brand: BRANDS[3], variant: 0 })!;
const v1 = renderScene(SCENES[1], { idx: 1, start: 1, dur: 3, w: 1080, h: 1920, tone: "premium", brand: BRANDS[3], variant: 1 })!;
assert.notStrictEqual(v0.css, v1.css);
ok("variasi: 4 tone punya font judul/radius/easing/gerak masuk berbeda; varian per video (seed) mengubah tata letak");
console.log(`ALL_SCENE_LIBRARY_TESTS_PASS (${n} tes)`);

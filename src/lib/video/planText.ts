// Teks VideoPlan (revisi 2026-11-05): hook terbaca penuh di frame 0 & caption 1 baris tanpa loncatan.
// Menggantikan intro/caption lama HANYA di mode plan (builder lama tidak berubah).
import type { HfWord } from "@/lib/render/hyperframesComposition";
import { contrast, designBg, estLines, fitFont, fontStack, pickInk, safeArea, TONE_STYLE, type BrandColors, type Layer, type Tone } from "./sceneLibrary";
import type { Zone } from "./footageFit";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f3 = (n: number) => n.toFixed(3);

// Hook: terlihat PENUH sejak t=0 (tanpa fade dari gelap / blur). Kontras lewat pita gradasi lokal di
// belakang teks (bukan scrim layar penuh) supaya hero tetap jelas. design=true -> latar brand penuh.
// avoid = rentang vertikal (px) subjek/bingkai hero yg TAK boleh ditimpa (revisi-3): teks ditaruh di pita bebas
// di atas atau di bawahnya (dlm title-safe), ukuran font dikecilkan sampai muat. Tak ada pita yg muat walau font
// minimum -> pita terbesar, font minimum (ponytail: bisa menimpa sedikit; perkecil bingkai hero bila sering terjadi).
export function hookLayer(o: { text: string; dur: number; avoid?: [number, number] | null; w: number; h: number; tone: Tone; brand: BrandColors; design: boolean }): Layer & { box: [number, number]; fs: number } {
  const { w, h, brand } = o;
  const sa = safeArea(w, h), st = TONE_STYLE[o.tone];
  const maxW = sa.x1 - sa.x0;
  const minFs = Math.round(w * 0.06);
  let fs = fitFont(o.text, maxW, Math.round(w * 0.105), Math.round(w * 0.066), 3, st.head);
  const boxH = (f: number) => Math.round(estLines(o.text, f, maxW, st.head) * f * 1.06 + f * 0.9);
  let top: number;
  if (o.design) top = Math.round(h * 0.34);
  else if (!o.avoid) top = sa.y1 - boxH(fs);
  else {
    const [a0, a1] = o.avoid;
    const fitIn = (space: number) => { for (let f = fs; f >= minFs; f--) if (estLines(o.text, f, maxW, st.head) <= 3 && boxH(f) <= space) return f; return 0; };
    const up = fitIn(a0 - sa.y0), dn = fitIn(sa.y1 - a1);
    if (up || dn) { fs = up >= dn ? up : dn; top = up >= dn ? a0 - boxH(fs) : a1; }
    else { fs = minFs; top = a0 - sa.y0 >= sa.y1 - a1 ? Math.max(sa.y0, a0 - boxH(fs)) : a1; }
  }
  const ink = o.design ? pickInk(brand.primary) : "#FFFFFF";
  const band = o.design ? "" : `background:linear-gradient(180deg,rgba(6,10,18,0) 0%,rgba(6,10,18,.5) 22%,rgba(6,10,18,.5) 78%,rgba(6,10,18,0) 100%);`;
  const bg = o.design ? designBg("vpHookBg", 0, o.dur, brand) : null;
  return {
    box: [top, top + boxH(fs)], fs,
    html: (bg?.html ?? "") + `<div id="vpHook"><span>${esc(o.text)}</span></div>`,
    css: (bg?.css ?? "") + `#vpHook{position:absolute;left:0;right:0;top:${top}px;z-index:610;text-align:center;box-sizing:border-box;padding:${Math.round(fs * 0.45)}px ${sa.x0}px;${band}}` +
      `#vpHook span{display:inline-block;max-width:100%;color:${ink};font:${st.headW} ${fs}px/1.06 ${fontStack(st.head)};${st.upper ? "text-transform:uppercase;" : ""}letter-spacing:-.01em;overflow-wrap:anywhere;${o.design ? "" : "text-shadow:0 3px 14px rgba(0,0,0,.75),0 0 2px rgba(0,0,0,.9);"}}`,
    tl: [
      ...(bg?.tl ?? []),
      `tl.set("#vpHook",{visibility:"visible",opacity:1},0);`,
      // Tanpa scale: teks membesar bisa melebar ke subjek di sebelahnya.
      `tl.to("#vpHook",{opacity:0,duration:.2,ease:"power2.in"},${f3(Math.max(0.4, o.dur - 0.2))});`,
      `tl.set("#vpHook",{visibility:"hidden"},${f3(o.dur)});`,
    ],
  };
}

export type CapLine = { words: HfWord[]; text: string; start: number; end: number; zone: Zone | null }; // null = disembunyikan (kartu + subjek)
const READ = (chars: number) => Math.max(1.0, 0.045 * chars + 0.35); // waktu baca minimum (dtk)

// Kelompokkan kata jadi baris yg MUAT 1 BARIS; pecah di akhir kalimat / jeda ≥0.45 dtk; gabung baris yg
// tampil terlalu singkat bila gabungannya masih 1 baris. Waktu absolut = offset + waktu kata.
export function captionLines(words: HfWord[], o: { offset: number; total: number; w: number; h: number; font: string; zoneAt: (t: number) => Zone | null }): { lines: CapLine[]; size: number; maxW: number } {
  const sa = safeArea(o.w, o.h);
  const maxW = sa.x1 - sa.x0 - Math.round(o.w * 0.06);
  const size = Math.round(o.w * 0.066);
  const fits = (ws: HfWord[]) => estLines(ws.map((x) => x.word).join(" "), size, maxW, o.font) === 1;
  const raw: HfWord[][] = [];
  let cur: HfWord[] = [];
  words.forEach((wd, i) => {
    const prev = words[i - 1];
    const brk = cur.length && (!fits([...cur, wd]) || (prev && wd.start - prev.end >= 0.45) || (prev && /[.!?]$/.test(prev.word)));
    if (brk) { raw.push(cur); cur = []; }
    cur.push(wd);
  });
  if (cur.length) raw.push(cur);
  const shown = (g: HfWord[][], i: number) => (i + 1 < g.length ? g[i + 1][0].start : g[i][g[i].length - 1].end + 0.6) - g[i][0].start;
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i + 1 < raw.length; i++) {
      const chars = raw[i].map((x) => x.word).join(" ").length;
      if (shown(raw, i) < READ(chars) && fits([...raw[i], ...raw[i + 1]])) { raw.splice(i, 2, [...raw[i], ...raw[i + 1]]); changed = true; break; }
    }
  }
  const lines = raw.map((g, i) => {
    const start = Math.max(o.offset, o.offset + g[0].start - 0.12);
    const end = Math.min(o.total, i + 1 < raw.length ? o.offset + raw[i + 1][0].start - 0.12 : o.offset + g[g.length - 1].end + 0.6);
    return { words: g, text: g.map((x) => x.word).join(" "), start, end, zone: o.zoneAt(start) };
  });
  return { lines, size, maxW };
}

// Render: tiap baris = semua kata sudah ditata (opacity 0) -> posisi baris TETAP terpusat saat kata muncul
// (tanpa reflow/loncatan). Revisi-3: pil gelap PER KATA (kata bersebelahan tanpa spasi teks, jarak = padding pil)
// -> pil tumbuh kata demi kata mengikuti kata yg tampil, posisi baris tetap. Kata muncul INSTAN (tl.set opacity 1,
// tanpa tween) -> tak pernah ada kata pudar/kontras rendah. Kata aktif = aksen hanya bila kontras ≥4.5 thd pil
// terburuk (pil di atas footage putih); kalau tidak putih.
export const CAP_PILL = "rgba(8,10,14,.8)";
export const CAP_PILL_WORST = "#3B3C3E"; // pil .8 di atas putih murni (0.8*8+0.2*255 ≈ 58)
export function captionLayer(words: HfWord[], o: { offset: number; total: number; w: number; h: number; brand: BrandColors; zoneAt: (t: number) => Zone | null }): Layer & { lines: CapLine[] } {
  const { lines, size } = captionLines(words, { ...o, font: o.brand.font });
  const sa = safeArea(o.w, o.h);
  const active = contrast(o.brand.accent, CAP_PILL_WORST) >= 4.5 ? o.brand.accent : "#FFFFFF";
  const html: string[] = [], tl: string[] = [];
  lines.forEach((ln, i) => {
    if (!ln.zone) return;
    const pos = ln.zone === "top" ? `top:${Math.round(o.h * 0.15)}px` : `bottom:${o.h - sa.y1}px`;
    html.push(`<div class="vpcl" id="vpc${i}" style="${pos}"><span>${ln.words.map((wd, j) => `<b id="vpc${i}w${j}">${esc(wd.word)}</b>`).join("")}</span></div>`);
    tl.push(`tl.set("#vpc${i}",{visibility:"visible"},${f3(ln.start)});`, `tl.set("#vpc${i}",{visibility:"hidden"},${f3(ln.end)});`);
    ln.words.forEach((wd, j) => {
      const t = Math.max(ln.start, o.offset + wd.start - 0.08), te = Math.max(t + 0.1, o.offset + wd.end);
      tl.push(`tl.set("#vpc${i}w${j}",{opacity:1,color:"${active}"},${f3(t)});`, `tl.set("#vpc${i}w${j}",{color:"#FFFFFF"},${f3(te)});`);
    });
  });
  const r = Math.round(size * 0.3), py = Math.round(size * 0.1), px = Math.round(size * 0.18);
  return {
    lines,
    html: html.join(""),
    css: `.vpcl{position:absolute;left:0;right:0;text-align:center;z-index:500;visibility:hidden;}` +
      // font di span: ukuran caption utk seluruh baris (estimasi lebar = captionLines).
      `.vpcl span{display:inline-block;white-space:nowrap;font:800 ${size}px/1.2 ${fontStack(o.brand.font)};}` +
      `.vpcl b{font:inherit;color:#FFFFFF;opacity:0;background:${CAP_PILL};padding:${py}px ${px}px;text-shadow:0 2px 6px rgba(0,0,0,.5);}` +
      `.vpcl b:first-child{border-radius:${r}px 0 0 ${r}px;}.vpcl b:last-child{border-radius:0 ${r}px ${r}px 0;}.vpcl b:only-child{border-radius:${r}px;}`,
    tl,
  };
}

// Teks VideoPlan (revisi 2026-11-05): hook terbaca penuh di frame 0 & caption 1 baris tanpa loncatan.
// Menggantikan intro/caption lama HANYA di mode plan (builder lama tidak berubah).
import type { HfWord } from "@/lib/render/hyperframesComposition";
import { designBg, estLines, fitFont, fontStack, pickInk, safeArea, TONE_STYLE, type BrandColors, type Layer, type Tone } from "./sceneLibrary";
import type { Zone } from "./footageFit";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f3 = (n: number) => n.toFixed(3);

// Hook: terlihat PENUH sejak t=0 (tanpa fade dari gelap / blur). Kontras lewat pita gradasi lokal di
// belakang teks (bukan scrim layar penuh) supaya hero tetap jelas. design=true -> latar brand penuh.
export function hookLayer(o: { text: string; dur: number; zone: Zone; w: number; h: number; tone: Tone; brand: BrandColors; design: boolean }): Layer {
  const { w, h, brand } = o;
  const sa = safeArea(w, h), st = TONE_STYLE[o.tone];
  const maxW = sa.x1 - sa.x0;
  const fs = fitFont(o.text, maxW, Math.round(w * 0.105), Math.round(w * 0.066), 3, st.head);
  const ink = o.design ? pickInk(brand.primary) : "#FFFFFF";
  const pos = o.design ? `top:${Math.round(h * 0.34)}px;` : o.zone === "top" ? `top:${Math.round(h * 0.13)}px;` : `bottom:${h - sa.y1}px;`;
  const band = o.design ? "" : `background:linear-gradient(180deg,rgba(6,10,18,0) 0%,rgba(6,10,18,.5) 22%,rgba(6,10,18,.5) 78%,rgba(6,10,18,0) 100%);`;
  const bg = o.design ? designBg("vpHookBg", 0, o.dur, brand) : null;
  return {
    html: (bg?.html ?? "") + `<div id="vpHook"><span>${esc(o.text)}</span></div>`,
    css: (bg?.css ?? "") + `#vpHook{position:absolute;left:0;right:0;${pos}z-index:610;text-align:center;padding:${Math.round(fs * 0.45)}px ${sa.x0}px;${band}}` +
      `#vpHook span{display:inline-block;max-width:100%;color:${ink};font:${st.headW} ${fs}px/1.06 ${fontStack(st.head)};${st.upper ? "text-transform:uppercase;" : ""}letter-spacing:-.01em;overflow-wrap:anywhere;${o.design ? "" : "text-shadow:0 3px 14px rgba(0,0,0,.75),0 0 2px rgba(0,0,0,.9);"}}`,
    tl: [
      ...(bg?.tl ?? []),
      `tl.set("#vpHook",{visibility:"visible",opacity:1},0);`,
      `tl.fromTo("#vpHook span",{scale:1},{scale:1.04,duration:${f3(Math.max(0.3, o.dur - 0.25))},ease:"none"},0);`,
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
// (tanpa reflow/loncatan); kata aktif warna aksen. Pil gelap tipis di belakang baris utk kontras.
export function captionLayer(words: HfWord[], o: { offset: number; total: number; w: number; h: number; brand: BrandColors; zoneAt: (t: number) => Zone | null }): Layer & { lines: CapLine[] } {
  const { lines, size } = captionLines(words, { ...o, font: o.brand.font });
  const sa = safeArea(o.w, o.h);
  const html: string[] = [], tl: string[] = [];
  lines.forEach((ln, i) => {
    if (!ln.zone) return;
    const pos = ln.zone === "top" ? `top:${Math.round(o.h * 0.15)}px` : `bottom:${o.h - sa.y1}px`;
    html.push(`<div class="vpcl" id="vpc${i}" style="${pos}"><span>${ln.words.map((wd, j) => `<b id="vpc${i}w${j}">${esc(wd.word)}</b>`).join(" ")}</span></div>`);
    tl.push(`tl.set("#vpc${i}",{visibility:"visible"},${f3(ln.start)});`, `tl.set("#vpc${i}",{visibility:"hidden"},${f3(ln.end)});`);
    ln.words.forEach((wd, j) => {
      const t = Math.max(ln.start, o.offset + wd.start - 0.08), te = Math.max(t + 0.1, o.offset + wd.end);
      tl.push(`tl.to("#vpc${i}w${j}",{opacity:1,duration:.08,ease:"none"},${f3(t)});`, `tl.set("#vpc${i}w${j}",{color:"${o.brand.accent}"},${f3(t)});`, `tl.set("#vpc${i}w${j}",{color:"#FFFFFF"},${f3(te)});`);
    });
  });
  return {
    lines,
    html: html.join(""),
    css: `.vpcl{position:absolute;left:0;right:0;text-align:center;z-index:500;visibility:hidden;}` +
      `.vpcl span{display:inline-block;white-space:nowrap;background:rgba(8,10,14,.55);border-radius:${Math.round(size * 0.3)}px;padding:${Math.round(size * 0.12)}px ${Math.round(size * 0.4)}px;}` +
      `.vpcl b{font:800 ${size}px/1.2 ${fontStack(o.brand.font)};color:#FFFFFF;opacity:0;text-shadow:0 2px 10px rgba(0,0,0,.6);}`,
    tl,
  };
}

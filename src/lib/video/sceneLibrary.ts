// Perpustakaan adegan VideoPlan (Tahap 7). Tiap adegan = komponen data-driven -> {html, css, tl} yang
// disuntik ke buildComposition sebagai layer. Hanya aset lokal: font ter-vendor di worker (./fonts),
// ikon = SVG inline, tanpa CDN/gambar luar. Semua teks di-escape; warna/font dari Brand Kit, bukan AI.
// Pola blok yang dipakai (ditulis ulang, bukan disalin): data-chart (bar), cinematic-zoom (hook),
// editorial-flash-overlay (transisi flash), logo-outro (wordmark + tagline).
import type { Scene } from "./videoPlan";

export type Tone = "premium" | "friendly" | "playful" | "corporate";
export type BrandColors = { primary: string; bg2: string; accent: string; ink: string; cta: string; font: string; mark: string };
export type Layer = { html: string; css: string; tl: string[] };
export type SceneCtx = { idx: number; start: number; dur: number; w: number; h: number; tone: Tone; brand: BrandColors; variant: number };

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f3 = (n: number) => n.toFixed(3);

// ---------- warna & kontras (WCAG) ----------
function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0x14213d;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function lum(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const safeHex = (h: string | undefined, d: string) => (h && /^#[0-9a-f]{6}$/i.test(h) ? h : d);
// Teks di atas bg: putih atau hampir-hitam, mana yang kontrasnya lebih tinggi (selalu ≥ 4.5 utk bg solid).
export const pickInk = (bg: string) => (contrast("#FFFFFF", bg) >= contrast("#111111", bg) ? "#FFFFFF" : "#111111");
// Aksen dipakai sbg warna teks hanya bila kontrasnya cukup; kalau tidak, jatuh ke ink.
const accentOr = (accent: string, bg: string) => (contrast(accent, bg) >= 4.5 ? accent : pickInk(bg));

// ---------- tipografi ----------
// Lebar rata-rata glyph (em) per font untuk estimasi wrap. Font tak dikenal -> Poppins (fallback lokal).
export const FONT_WIDTH: Record<string, number> = { Poppins: 0.6, "Archivo Black": 0.7, Oswald: 0.47, "Playfair Display": 0.56 };
export const fontStack = (f: string) => `"${FONT_WIDTH[f] ? f : "Poppins"}","Poppins",Arial,sans-serif`;
// Ukuran font yang muat di maxW dalam ≤ lines baris; kata terpanjang wajib muat 1 baris.
export function fitFont(text: string, maxW: number, base: number, min: number, lines: number, font: string): number {
  const cw = FONT_WIDTH[font] ?? FONT_WIDTH.Poppins;
  const t = text.trim();
  const longest = Math.max(1, ...t.split(/\s+/).map((x) => x.length));
  const byLen = (maxW * lines) / (Math.max(1, t.length) * cw * 1.08); // 1.08 = sisa ruang wrap
  const byWord = maxW / (longest * cw);
  return Math.max(min, Math.floor(Math.min(base, byLen, byWord)));
}
export function estLines(text: string, size: number, maxW: number, font: string): number {
  const cw = (FONT_WIDTH[font] ?? FONT_WIDTH.Poppins) * size;
  let lines = 1, cur = 0;
  for (const word of text.trim().split(/\s+/)) {
    const wl = word.length * cw, sp = cur ? cw : 0;
    if (cur + sp + wl > maxW) { lines++; cur = wl; } else cur += sp + wl;
  }
  return lines;
}

// ---------- gaya per tone brand (variasi antar-brand) ----------
type ToneStyle = { head: string; headW: number; radius: number; upper: boolean; ease: string; from: string; card: (b: BrandColors) => string; tilt: number };
export const TONE_STYLE: Record<Tone, ToneStyle> = {
  premium: { head: "Playfair Display", headW: 700, radius: 6, upper: false, ease: "power3.out", from: "{opacity:0,y:34}", card: () => "#101114", tilt: 0 },
  friendly: { head: "Poppins", headW: 700, radius: 30, upper: false, ease: "back.out(1.7)", from: "{opacity:0,y:44,scale:.9}", card: () => "#FFFFFF", tilt: 0 },
  playful: { head: "Archivo Black", headW: 400, radius: 20, upper: true, ease: "back.out(2.6)", from: "{opacity:0,y:70,scale:.7,rotation:-5}", card: (b) => b.accent, tilt: -2 },
  corporate: { head: "Oswald", headW: 600, radius: 10, upper: true, ease: "power2.out", from: "{opacity:0,x:-90}", card: (b) => b.primary, tilt: 0 },
};

// Zona aman teks (portrait 9:16): kiri/kanan 7%, atas 12%, bawah 22% (UI TikTok/Reels/Shorts).
export function safeArea(w: number, h: number) {
  const portrait = h > w;
  return { x0: Math.round(w * 0.07), x1: Math.round(w * 0.93), y0: Math.round(h * (portrait ? 0.12 : 0.08)), y1: Math.round(h * (portrait ? 0.78 : 0.85)) };
}

const svgCheck = (c: string, s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="${c}"/><path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const svgStar = (c: string, s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z" fill="${c}"/></svg>`;
const svgArrow = (c: string, s: number) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13m-5-6l6 6-6 6" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Masuk/keluar standar sebuah elemen di jendela adegan.
function inOut(sel: string, c: SceneCtx, st: ToneStyle, outAt?: number): string[] {
  const end = outAt ?? c.start + c.dur;
  return [
    `tl.set("${sel}",{visibility:"visible"},${f3(c.start)});`,
    `tl.fromTo("${sel}",${st.from},{opacity:1,x:0,y:0,scale:1,rotation:${st.tilt},duration:.42,ease:"${st.ease}"},${f3(c.start + 0.05)});`,
    `tl.to("${sel}",{opacity:0,duration:.25,ease:"power2.in"},${f3(Math.max(c.start + 0.5, end - 0.28))});`,
    `tl.set("${sel}",{visibility:"hidden"},${f3(end)});`,
  ];
}

export function renderScene(scene: Scene, c: SceneCtx): Layer | null {
  const st = TONE_STYLE[c.tone];
  const sa = safeArea(c.w, c.h);
  const maxW = sa.x1 - sa.x0 - 2 * Math.round(c.w * 0.05); // padding kartu
  const id = `sc${c.idx}`;
  const card = st.card(c.brand), ink = pickInk(card), acc = accentOr(c.brand.accent, card);
  const head = fontStack(st.head), body = fontStack(c.brand.font);
  const up = st.upper ? "text-transform:uppercase;" : "";
  const base = `#${id}{position:absolute;left:${sa.x0}px;right:${c.w - sa.x1}px;z-index:560;visibility:hidden;opacity:0;}`;
  const cardCss = `background:${card};color:${ink};border-radius:${st.radius}px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:${Math.round(c.w * 0.045)}px ${Math.round(c.w * 0.05)}px;`;
  const align = c.variant % 2 ? "left" : "center";

  switch (scene.type) {
    case "hook": {
      // Cinematic zoom: punch-in pelan pada footage hero sepanjang hook (wrapper klip-0, tak bentrok Ken Burns).
      return { html: "", css: "", tl: [`tl.fromTo("#cw0",{scale:1},{scale:1.08,duration:${f3(c.dur)},ease:"power1.inOut"},0);`] };
    }
    case "footage-caption": {
      if (!scene.caption) return null;
      const fs = fitFont(scene.caption, maxW, Math.round(c.w * 0.05), Math.round(c.w * 0.034), 2, c.brand.font);
      return {
        html: `<div id="${id}" class="vp-kicker"><span>${esc(scene.caption)}</span></div>`,
        css: `${base}#${id}{top:${sa.y0}px;text-align:${align};}#${id} span{display:inline-block;max-width:100%;overflow-wrap:anywhere;background:${card};color:${ink};font:${700} ${fs}px/${1.15} ${body};${up}padding:${Math.round(fs * 0.45)}px ${Math.round(fs * 0.8)}px;border-radius:${st.radius}px;}`,
        tl: inOut(`#${id}`, c, st),
      };
    }
    case "stat": {
      const vs = fitFont(scene.value, maxW, Math.round(c.w * 0.17), Math.round(c.w * 0.08), 1, st.head);
      const ls = fitFont(scene.label, maxW, Math.round(c.w * 0.05), Math.round(c.w * 0.034), 2, c.brand.font);
      const m = /^(\D*?)(\d[\d.,]*)(\D*)$/.exec(scene.value);
      const num = m ? parseInt(m[2].replace(/[.,]/g, ""), 10) : NaN;
      const valHtml = m && num > 0 ? `${esc(m[1])}<span id="${id}n">0</span>${esc(m[3])}` : esc(scene.value);
      const chart = scene.chart?.length ? scene.chart : null;
      const maxV = chart ? Math.max(...chart, 1) : 1;
      const chH = Math.round(c.h * 0.11), barW = chart ? Math.floor((maxW - (chart.length - 1) * 18) / chart.length) : 0;
      const bars = chart ? `<div class="vp-chart">${chart.map((v, j) => `<i id="${id}b${j}" style="height:${Math.max(6, Math.round((v / maxV) * chH))}px;width:${barW}px;background:${j === chart.length - 1 ? acc : ink};opacity:${j === chart.length - 1 ? 1 : 0.35}"></i>`).join("")}</div>` : "";
      const tl = inOut(`#${id}`, c, st);
      if (m && num > 0) tl.push(`var ${id}o={v:0};tl.to(${id}o,{v:${num},duration:.9,ease:"power2.out",onUpdate:function(){document.getElementById("${id}n").textContent=fmtNum(${id}o.v,${/[.,]/.test(m[2])});}},${f3(c.start + 0.1)});`);
      chart?.forEach((_v, j) => tl.push(`tl.fromTo("#${id}b${j}",{scaleY:0},{scaleY:1,duration:.5,ease:"power3.out"},${f3(c.start + 0.25 + j * 0.12)});`));
      return {
        html: `<div id="${id}" class="vp-stat"><div class="v">${valHtml}</div><div class="l">${esc(scene.label)}</div>${bars}</div>`,
        css: `${base}#${id}{top:${Math.round(c.h * 0.28)}px;${cardCss}text-align:${align};}#${id} .v{font:${st.headW} ${vs}px/1 ${head};color:${acc};letter-spacing:-.02em;white-space:nowrap;}#${id} .l{font:600 ${ls}px/1.2 ${body};${up}margin-top:${Math.round(c.w * 0.02)}px;overflow-wrap:anywhere;}#${id} .vp-chart{display:flex;gap:18px;align-items:flex-end;height:${chH}px;margin-top:${Math.round(c.w * 0.03)}px;}#${id} .vp-chart i{display:block;border-radius:6px 6px 0 0;transform-origin:bottom;}`,
        tl,
      };
    }
    case "testimonial": {
      const qs = fitFont(scene.quote, maxW, Math.round(c.w * 0.058), Math.round(c.w * 0.036), 4, st.head);
      const as = Math.round(c.w * 0.036);
      const stars = scene.rating ? `<div class="r">${Array.from({ length: scene.rating }, () => svgStar(c.brand.accent, Math.round(c.w * 0.045))).join("")}</div>` : "";
      return {
        html: `<div id="${id}" class="vp-quote">${stars}<div class="q">&#8220;${esc(scene.quote)}&#8221;</div><div class="a">${esc(scene.author)}</div></div>`,
        css: `${base}#${id}{top:${Math.round(c.h * 0.26)}px;${cardCss}text-align:${align};}#${id} .r{display:flex;gap:6px;justify-content:${align === "left" ? "flex-start" : "center"};margin-bottom:${Math.round(c.w * 0.02)}px;}#${id} .q{font:${st.headW} ${qs}px/1.22 ${head};overflow-wrap:anywhere;}#${id} .a{font:600 ${as}px/1.2 ${body};color:${acc};margin-top:${Math.round(c.w * 0.025)}px;${up}}`,
        tl: inOut(`#${id}`, c, st),
      };
    }
    case "feature-list": {
      const ts = scene.title ? fitFont(scene.title, maxW, Math.round(c.w * 0.065), Math.round(c.w * 0.042), 2, st.head) : 0;
      const longest = scene.items.reduce((a, b) => (a.length > b.length ? a : b), "");
      const iconS = Math.round(c.w * 0.055);
      const is = fitFont(longest, maxW - iconS - 24, Math.round(c.w * 0.052), Math.round(c.w * 0.036), 1, c.brand.font);
      const tl = inOut(`#${id}`, c, st);
      scene.items.forEach((_x, j) => tl.push(`tl.fromTo("#${id}i${j}",{opacity:0,x:-40},{opacity:1,x:0,duration:.3,ease:"power3.out"},${f3(c.start + 0.3 + j * Math.min(0.45, (c.dur - 0.9) / scene.items.length))});`));
      return {
        html: `<div id="${id}" class="vp-list">${scene.title ? `<div class="t">${esc(scene.title)}</div>` : ""}${scene.items.map((x, j) => `<div class="i" id="${id}i${j}">${svgCheck(c.brand.accent === card ? ink : c.brand.accent, iconS)}<span>${esc(x)}</span></div>`).join("")}</div>`,
        css: `${base}#${id}{top:${Math.round(c.h * 0.25)}px;${cardCss}}#${id} .t{font:${st.headW} ${ts}px/1.1 ${head};${up}margin-bottom:${Math.round(c.w * 0.03)}px;overflow-wrap:anywhere;}#${id} .i{display:flex;align-items:center;gap:24px;font:600 ${is}px/1.2 ${body};margin:${Math.round(c.w * 0.018)}px 0;opacity:0;}#${id} .i span{overflow-wrap:anywhere;}`,
        tl,
      };
    }
    case "before-after": {
      const half = c.start + c.dur / 2;
      const ls = Math.round(c.w * 0.045);
      const tag = (k: string, txt: string, side: string) => `<div id="${id}${k}" class="vp-ba" style="${side}">${esc(txt)}</div>`;
      return {
        html: `${tag("b", scene.before.label, `left:${sa.x0}px`)}${tag("a", scene.after.label, `right:${c.w - sa.x1}px`)}<div id="${id}w" class="vp-wipe"></div>`,
        css: `.vp-ba{position:absolute;top:${sa.y0}px;z-index:560;visibility:hidden;opacity:0;background:${card};color:${ink};font:${st.headW} ${ls}px/1 ${head};${up}padding:${Math.round(ls * 0.5)}px ${Math.round(ls * 0.8)}px;border-radius:${st.radius}px;white-space:nowrap;}#${id}w{position:absolute;top:0;bottom:0;width:10px;left:0;z-index:555;background:${c.brand.accent};visibility:hidden;box-shadow:0 0 30px ${c.brand.accent};}`,
        tl: [
          ...inOut(`#${id}b`, c, st, half),
          ...inOut(`#${id}a`, { ...c, start: half, dur: c.dur / 2 }, st),
          `tl.set("#${id}w",{visibility:"visible",x:-20},${f3(half - 0.2)});`,
          `tl.to("#${id}w",{x:${c.w + 20},duration:.4,ease:"power2.inOut"},${f3(half - 0.2)});`,
          `tl.set("#${id}w",{visibility:"hidden"},${f3(half + 0.25)});`,
        ],
      };
    }
    case "cta": {
      const ts = fitFont(scene.text, maxW - Math.round(c.w * 0.12), Math.round(c.w * 0.062), Math.round(c.w * 0.04), 2, c.brand.font);
      const ss = scene.sub ? fitFont(scene.sub, maxW, Math.round(c.w * 0.04), Math.round(c.w * 0.03), 2, c.brand.font) : 0;
      const ctaInk = pickInk(c.brand.cta);
      return {
        html: `<div id="${id}" class="vp-cta"><div class="b"><span>${esc(scene.text)}</span>${svgArrow(ctaInk, Math.round(ts * 1.1))}</div>${scene.sub ? `<div class="s">${esc(scene.sub)}</div>` : ""}</div>`,
        css: `${base}#${id}{top:${Math.round(c.h * 0.52)}px;text-align:center;}#${id} .b{display:inline-flex;align-items:center;gap:18px;max-width:100%;background:${c.brand.cta};color:${ctaInk};font:700 ${ts}px/1.15 ${body};${up}padding:${Math.round(ts * 0.55)}px ${Math.round(ts * 0.9)}px;border-radius:${st.radius >= 20 ? 999 : st.radius}px;box-shadow:0 14px 40px rgba(0,0,0,.45);}#${id} .b span{overflow-wrap:anywhere;}#${id} .s{margin-top:${Math.round(c.w * 0.03)}px;color:#fff;font:600 ${ss}px/1.2 ${body};text-shadow:0 3px 14px rgba(0,0,0,.75);}`,
        tl: [...inOut(`#${id}`, c, st), `tl.to("#${id} .b",{scale:1.06,duration:.35,yoyo:true,repeat:${Math.max(1, Math.floor((c.dur - 0.8) / 0.35))},ease:"sine.inOut"},${f3(c.start + 0.5)});`],
      };
    }
    case "logo-outro": {
      const mark = c.brand.mark || "";
      const ms = fitFont(mark || " ", maxW, Math.round(c.w * 0.13), Math.round(c.w * 0.06), 2, st.head);
      const tg = scene.tagline ? fitFont(scene.tagline, maxW, Math.round(c.w * 0.045), Math.round(c.w * 0.032), 2, c.brand.font) : 0;
      const bgInk = pickInk(c.brand.primary), tAcc = accentOr(c.brand.accent, c.brand.primary);
      return {
        html: `<div id="${id}" class="vp-outro"><div class="m">${esc(mark)}</div><div class="ln"></div>${scene.tagline ? `<div class="t">${esc(scene.tagline)}</div>` : ""}</div>`,
        css: `#${id}{position:absolute;inset:0;z-index:690;visibility:hidden;opacity:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 ${sa.x0}px;background:radial-gradient(120% 80% at 50% 40%,${c.brand.primary},${c.brand.bg2});color:${bgInk};}#${id} .m{font:${st.headW} ${ms}px/1 ${head};letter-spacing:.02em;overflow-wrap:anywhere;}#${id} .ln{width:${Math.round(c.w * 0.18)}px;height:8px;background:${tAcc};margin:${Math.round(c.w * 0.035)}px 0;border-radius:4px;transform-origin:center;}#${id} .t{font:600 ${tg}px/1.25 ${body};${up}overflow-wrap:anywhere;}`,
        tl: [
          `tl.set("#${id}",{visibility:"visible"},${f3(c.start)});`,
          `tl.fromTo("#${id}",{opacity:0},{opacity:1,duration:.35,ease:"power2.out"},${f3(c.start)});`,
          `tl.fromTo("#${id} .m",{opacity:0,scale:.82,letterSpacing:"0.3em"},{opacity:1,scale:1,letterSpacing:"0.02em",duration:.7,ease:"power3.out"},${f3(c.start + 0.1)});`,
          `tl.fromTo("#${id} .ln",{scaleX:0},{scaleX:1,duration:.45,ease:"power2.inOut"},${f3(c.start + 0.45)});`,
          ...(scene.tagline ? [`tl.fromTo("#${id} .t",{opacity:0,y:20},{opacity:1,y:0,duration:.4,ease:"power2.out"},${f3(c.start + 0.65)});`] : []),
        ],
      };
    }
  }
  return null;
}

// Editorial flash overlay pada cut bertipe "flash" (putih singkat, menutupi pergantian klip).
export function flashLayer(times: number[]): Layer | null {
  if (!times.length) return null;
  return {
    html: `<div id="vpFlash"></div>`,
    css: `#vpFlash{position:absolute;inset:0;z-index:640;background:#fff;opacity:0;pointer-events:none;}`,
    tl: times.flatMap((t) => [`tl.fromTo("#vpFlash",{opacity:0},{opacity:.85,duration:.06,ease:"none"},${f3(Math.max(0, t - 0.06))});`, `tl.to("#vpFlash",{opacity:0,duration:.22,ease:"power2.out"},${f3(t)});`]),
  };
}

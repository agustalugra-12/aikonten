// Scene renderer gaya preset OSS "bold-poster" (HyperFrames Pro P2, 2026-11-02). Mengadopsi
// design system bold-poster (Shrikhand tilted + Libre Baskerville + Space Grotesk; putih/merah/
// gelap) dari paket OSS hyperframes, di-drive konten kita. FRAME.md bilang "motion out of scope"
// -> motion (entrance stagger/tilt) KITA tambahkan via GSAP. 1 fungsi = 1 scene (Cover dulu).
// Output = komposisi HyperFrames penuh (root paused timeline + window.__timelines.main).

export type BoldCoverInput = {
  orientation?: "portrait" | "landscape" | "square";
  title: string;       // hook/judul - dipecah jadi 3 baris
  eyebrow?: string;    // label kecil atas (mis nama brand / kategori)
  tagline?: string;    // 1 kalimat body di bawah judul
  mark?: string;       // brandmark kecil (counter kanan-bawah)
  durationSeconds?: number;
};

const DIM = { portrait: { w: 1080, h: 1920 }, landscape: { w: 1920, h: 1080 }, square: { w: 1080, h: 1080 } };

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Pecah judul jadi <=3 baris seimbang (per kata). Hook pendek -> bisa 1-2 baris.
function splitLines(text: string, maxLines = 3): string[] {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words.length ? [words[0]] : ["Konten"];
  const lines = Math.min(maxLines, words.length);
  const per = Math.ceil(words.length / lines);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per).join(" "));
  return out.slice(0, maxLines);
}

export function buildBoldCover(input: BoldCoverInput): string {
  const { orientation = "portrait", title, eyebrow = "", tagline = "", mark = "", durationSeconds = 4 } = input;
  const { w, h } = DIM[orientation] || DIM.portrait;
  // Auto-fit (2026-11-03, fix "cover kepanjangan"): judul panjang -> lebih banyak baris
  // (tiap baris lebih pendek) + font shrink-only supaya baris terpanjang muat ~1 baris
  // (baris merah dirender 1.08x, Shrikhand lebar ~0.62em/char). Hook pendek tak terpengaruh.
  const wc = String(title || "").trim().split(/\s+/).filter(Boolean).length;
  const maxLines = wc <= 3 ? 2 : wc <= 6 ? 3 : 4;
  const lines = splitLines(title, maxLines);
  const total = Math.max(2.5, durationSeconds);
  // cqw: 1% lebar container. Ukuran hero diskalakan ke lebar supaya muat portrait.
  const heroCqw = orientation === "portrait" ? 12.5 : 9.0; // Shrikhand hero
  const heroPxBase = Math.round((w * heroCqw) / 100);
  const maxChars = Math.max(...lines.map((l) => l.length), 6);
  const fitPx = Math.floor((w * 0.9) / (maxChars * 0.68)); // shrink biar baris terpanjang muat
  const heroPx = Math.min(heroPxBase, Math.max(Math.round(w * 0.052), fitPx)); // tak pernah membesar

  // Kelas per baris: tengah (indeks ganjil) = merah + miring, lain = gelap miring halus.
  const lineHtml = lines.map((ln, i) => {
    const red = i === 1; // baris ke-2 merah (signature)
    const rot = i === 0 ? -2 : i === 1 ? -5 : 2;
    const col = red ? "var(--red)" : "var(--dark)";
    const sz = red ? Math.round(heroPx * 1.08) : i === 2 ? Math.round(heroPx * 0.86) : heroPx;
    return `<div class="hl" id="hl${i}" style="font-size:${sz}px;color:${col};transform:rotate(${rot}deg);">${esc(ln)}</div>`;
  }).join("\n      ");

  const tl: string[] = [];
  // Entrance: tiap baris masuk stagger (y + rotate settle + opacity), eyebrow/tagline fade.
  if (eyebrow) tl.push(`tl.fromTo("#eyebrow",{opacity:0,x:-30},{opacity:1,x:0,duration:.4,ease:"power3.out"},.15);`);
  lines.forEach((_l, i) => {
    const rot = i === 0 ? -2 : i === 1 ? -5 : 2;
    tl.push(`tl.fromTo("#hl${i}",{opacity:0,y:70,rotate:${rot - 8},scale:.9},{opacity:1,y:0,rotate:${rot},scale:1,duration:.5,ease:"back.out(1.6)"},${(0.3 + i * 0.16).toFixed(2)});`);
  });
  if (tagline) tl.push(`tl.fromTo("#tagline",{opacity:0,y:20},{opacity:1,y:0,duration:.5,ease:"power2.out"},${(0.3 + lines.length * 0.16 + 0.1).toFixed(2)});`);
  tl.push(`tl.fromTo("#pbar",{scaleX:0},{scaleX:1,duration:${total.toFixed(2)},ease:"none"},0);`);

  return `<!doctype html>
<html lang="id"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=${w}, height=${h}"/>
<script src="./vendor/gsap.min.js"></script>
<style>
/* Font ter-vendor di worker base/fonts (Fase 0, 2026-11-03) - path relatif, TANPA CDN. */
@font-face{font-family:"Shrikhand";font-weight:400;src:url("./fonts/shrikhand-400.woff2") format("woff2");}
@font-face{font-family:"Libre Baskerville";font-weight:400;font-style:normal;src:url("./fonts/libre-baskerville-400.woff2") format("woff2");}
@font-face{font-family:"Libre Baskerville";font-weight:700;font-style:normal;src:url("./fonts/libre-baskerville-700.woff2") format("woff2");}
@font-face{font-family:"Libre Baskerville";font-weight:400;font-style:italic;src:url("./fonts/libre-baskerville-400i.woff2") format("woff2");}
@font-face{font-family:"Space Grotesk";font-weight:400;src:url("./fonts/space-grotesk-400.woff2") format("woff2");}
@font-face{font-family:"Space Grotesk";font-weight:600;src:url("./fonts/space-grotesk-600.woff2") format("woff2");}
:root{--bg:#FFFFFF;--dark:#1C1410;--red:#D8000F;--light:#F5F2EF;--disp:"Shrikhand",cursive;--body:"Libre Baskerville",serif;--mono:"Space Grotesk",sans-serif;}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:var(--bg);color:var(--dark);font-family:var(--body);-webkit-font-smoothing:antialiased;}
#root{width:100%;height:100%;position:relative;display:flex;flex-direction:column;justify-content:center;padding:${Math.round(h * 0.09)}px ${Math.round(w * 0.07)}px;}
#eyebrow{font-family:var(--mono);font-weight:600;text-transform:uppercase;letter-spacing:3px;font-size:${Math.round(w * 0.028)}px;color:var(--red);margin-bottom:${Math.round(h * 0.02)}px;opacity:0;}
.stack{display:flex;flex-direction:column;align-items:flex-start;}
.hl{font-family:var(--disp);font-weight:400;line-height:.86;transform-origin:left;opacity:0;margin:${Math.round(h * 0.004)}px 0;}
#tagline{font-family:var(--body);font-size:${Math.round(w * 0.038)}px;line-height:1.6;color:var(--dark);max-width:${Math.round(w * 0.82)}px;margin-top:${Math.round(h * 0.035)}px;opacity:0;}
#pbar{position:absolute;bottom:0;left:0;height:${Math.round(h * 0.006)}px;width:100%;background:var(--red);transform-origin:left;}
#mark{position:absolute;bottom:${Math.round(h * 0.02)}px;right:${Math.round(w * 0.05)}px;font-family:var(--mono);font-weight:600;text-transform:uppercase;letter-spacing:2px;font-size:${Math.round(w * 0.026)}px;color:var(--dark);opacity:.5;}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${total.toFixed(3)}" data-width="${w}" data-height="${h}" data-motion-blur="on">
  ${eyebrow ? `<div id="eyebrow">${esc(eyebrow)}</div>` : ""}
  <div class="stack">
      ${lineHtml}
  </div>
  ${tagline ? `<div id="tagline">${esc(tagline)}</div>` : ""}
  <div id="pbar"></div>
  ${mark ? `<div id="mark">${esc(mark)}</div>` : ""}
</div>
<script>
const tl=gsap.timeline({paused:true});
${tl.join("\n")}
window.__timelines=window.__timelines||{};window.__timelines["main"]=tl;
</script></body></html>`;
}

// Scene FOOTAGE (hybrid P4): 1 klip brand full-frame + Ken Burns + caption bold-poster
// (opsional) + brandmark. Menampilkan tempat NYATA di antara frame desain.
export type BoldFootageInput = {
  orientation?: "portrait" | "landscape" | "square";
  videoUrl: string; durationSeconds?: number; caption?: string; mark?: string;
};
export function buildBoldFootage(input: BoldFootageInput): string {
  const { orientation = "portrait", videoUrl, durationSeconds = 3.5, caption = "", mark = "" } = input;
  const { w, h } = DIM[orientation] || DIM.portrait;
  const total = Math.max(1.5, durationSeconds);
  const tl: string[] = [];
  // Ken Burns kuat pada klip.
  tl.push(`tl.fromTo("#bg",{scale:1.12,xPercent:-3},{scale:1.34,xPercent:3,duration:${total.toFixed(2)},ease:"power1.out"},0);`);
  if (caption) tl.push(`tl.fromTo("#cap",{opacity:0,y:40,scale:.9},{opacity:1,y:0,scale:1,duration:.5,ease:"back.out(1.6)"},.25);`);
  tl.push(`tl.fromTo("#pbar",{scaleX:0},{scaleX:1,duration:${total.toFixed(2)},ease:"none"},0);`);
  return `${headShell(w, h)}
#bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
#scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(28,20,16,.15) 0%,rgba(28,20,16,0) 40%,rgba(28,20,16,.7) 100%);}
#cap{position:absolute;left:${Math.round(w * 0.06)}px;right:${Math.round(w * 0.06)}px;bottom:${Math.round(h * 0.11)}px;opacity:0;}
#cap .bar{width:${Math.round(w * 0.1)}px;height:${Math.round(h * 0.008)}px;background:var(--red);margin-bottom:${Math.round(h * 0.015)}px;}
#cap .t{font-family:var(--disp);font-weight:400;font-size:${Math.round(w * 0.082)}px;line-height:1.0;color:var(--bg);text-shadow:2px 3px 0 rgba(28,20,16,.45);}
#mk{position:absolute;top:${Math.round(h * 0.03)}px;left:${Math.round(w * 0.06)}px;font-family:var(--mono);font-weight:600;text-transform:uppercase;letter-spacing:2px;font-size:${Math.round(w * 0.028)}px;color:var(--bg);background:var(--red);padding:${Math.round(h * 0.008)}px ${Math.round(w * 0.035)}px;border-radius:100px;}
#pbar{position:absolute;bottom:0;left:0;height:${Math.round(h * 0.006)}px;width:100%;background:var(--red);transform-origin:left;}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${total.toFixed(3)}" data-width="${w}" data-height="${h}" data-motion-blur="on">
  <video id="bg" class="clip" muted playsinline data-start="0" data-duration="${total.toFixed(3)}" data-media-start="0" data-track-index="0" src="${esc(videoUrl)}"></video>
  <div id="scrim"></div>
  ${caption ? `<div id="cap"><div class="bar"></div><div class="t">${esc(caption)}</div></div>` : ""}
  ${mark ? `<div id="mk">${esc(mark)}</div>` : ""}
  <div id="pbar"></div>
</div>
<script>
const tl=gsap.timeline({paused:true});
${tl.join("\n")}
window.__timelines=window.__timelines||{};window.__timelines["main"]=tl;
</script></body></html>`;
}

// <head> bersama (font Google + token bold-poster) - dipakai Stat & Closing.
function headShell(w: number, h: number): string {
  return `<!doctype html>
<html lang="id"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=${w}, height=${h}"/>
<script src="./vendor/gsap.min.js"></script>
<style>
/* Font ter-vendor di worker base/fonts (Fase 0, 2026-11-03) - path relatif, TANPA CDN. */
@font-face{font-family:"Shrikhand";font-weight:400;src:url("./fonts/shrikhand-400.woff2") format("woff2");}
@font-face{font-family:"Libre Baskerville";font-weight:400;font-style:normal;src:url("./fonts/libre-baskerville-400.woff2") format("woff2");}
@font-face{font-family:"Libre Baskerville";font-weight:700;font-style:normal;src:url("./fonts/libre-baskerville-700.woff2") format("woff2");}
@font-face{font-family:"Libre Baskerville";font-weight:400;font-style:italic;src:url("./fonts/libre-baskerville-400i.woff2") format("woff2");}
@font-face{font-family:"Space Grotesk";font-weight:400;src:url("./fonts/space-grotesk-400.woff2") format("woff2");}
@font-face{font-family:"Space Grotesk";font-weight:600;src:url("./fonts/space-grotesk-600.woff2") format("woff2");}
:root{--bg:#FFFFFF;--dark:#1C1410;--red:#D8000F;--light:#F5F2EF;--disp:"Shrikhand",cursive;--body:"Libre Baskerville",serif;--mono:"Space Grotesk",sans-serif;}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:var(--bg);color:var(--dark);font-family:var(--body);-webkit-font-smoothing:antialiased;}
#root{width:100%;height:100%;position:relative;}`;
}

// Scene STAT-BIG (f2): panel MERAH penuh, angka raksasa putih miring -6 shadow bertumpuk,
// label di atas + sub di bawah. value numerik -> count-up. Momen "wow" / angka kunci.
export type BoldStatInput = {
  orientation?: "portrait" | "landscape" | "square";
  value: string; label?: string; sub?: string; mark?: string; durationSeconds?: number;
};
export function buildBoldStat(input: BoldStatInput): string {
  const { orientation = "portrait", value, label = "", sub = "", mark = "", durationSeconds = 3 } = input;
  const { w, h } = DIM[orientation] || DIM.portrait;
  const total = Math.max(2, durationSeconds);
  // Ukuran angka diskalakan ke panjang (biar muat, tak membungkus). ~lebar/len.
  const len = Math.max(1, String(value).length);
  const bigPx = Math.min(Math.round(w * 0.42), Math.round((w * 0.92) / (len * 0.62)));
  // count-up kalau ada angka
  const m = String(value).match(/^(\D*?)(\d[\d.,]*)(\D*)$/);
  const grouped = m ? /[.,]/.test(m[2]) : false;
  const num = m ? parseInt(m[2].replace(/[.,]/g, ""), 10) : null;
  const bigInner = m && num && num > 0 ? `${esc(m[1])}<span id="cnum">0</span>${esc(m[3])}` : esc(value);
  const tl: string[] = [];
  if (label) tl.push(`tl.fromTo("#lab",{opacity:0,y:-20},{opacity:.85,y:0,duration:.4,ease:"power2.out"},.1);`);
  tl.push(`tl.fromTo("#big",{opacity:0,scale:.5,rotate:-18},{opacity:1,scale:1,rotate:-6,duration:.55,ease:"back.out(1.8)"},.25);`);
  if (m && num && num > 0) tl.push(`var ob={v:0};tl.to(ob,{v:${num},duration:.8,ease:"power2.out",onUpdate:function(){document.getElementById("cnum").textContent=fmtNum(ob.v,${grouped});}},.25);`);
  if (sub) tl.push(`tl.fromTo("#sub",{opacity:0,y:20},{opacity:.9,y:0,duration:.45,ease:"power2.out"},.7);`);
  return `${headShell(w, h)}
#root{background:var(--red);display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;color:var(--bg);padding:0 ${Math.round(w * 0.06)}px;}
#lab{font-family:var(--mono);font-weight:600;text-transform:uppercase;letter-spacing:3px;font-size:${Math.round(w * 0.03)}px;color:var(--bg);opacity:0;margin-bottom:${Math.round(h * 0.015)}px;}
#big{font-family:var(--disp);font-weight:400;font-size:${bigPx}px;line-height:.82;color:var(--bg);opacity:0;transform:rotate(-6deg);text-shadow:3px 3px 0 rgba(28,20,16,.25),6px 6px 0 rgba(28,20,16,.2),9px 9px 0 rgba(28,20,16,.15);}
#sub{font-family:var(--body);font-size:${Math.round(w * 0.04)}px;color:var(--bg);opacity:0;margin-top:${Math.round(h * 0.03)}px;max-width:${Math.round(w * 0.8)}px;}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${total.toFixed(3)}" data-width="${w}" data-height="${h}" data-motion-blur="on">
  ${label ? `<div id="lab">${esc(label)}</div>` : ""}
  <div id="big">${bigInner}</div>
  ${sub ? `<div id="sub">${esc(sub)}</div>` : ""}
  ${mark ? `<div style="position:absolute;bottom:${Math.round(h * 0.02)}px;right:${Math.round(w * 0.05)}px;font-family:var(--mono);font-weight:600;letter-spacing:2px;font-size:${Math.round(w * 0.026)}px;color:var(--bg);opacity:.6;">${esc(mark)}</div>` : ""}
</div>
<script>
const tl=gsap.timeline({paused:true});
function fmtNum(x,g){x=Math.round(x);return g?x.toLocaleString("id-ID"):String(x);}
${tl.join("\n")}
window.__timelines=window.__timelines||{};window.__timelines["main"]=tl;
</script></body></html>`;
}

// Scene CLOSING/CTA: kanvas putih, judul penutup besar merah miring -5 + pill CTA.
export type BoldClosingInput = {
  orientation?: "portrait" | "landscape" | "square";
  title: string; cta?: string; mark?: string; durationSeconds?: number;
};
export function buildBoldClosing(input: BoldClosingInput): string {
  const { orientation = "portrait", title, cta = "", mark = "", durationSeconds = 3.5 } = input;
  const { w, h } = DIM[orientation] || DIM.portrait;
  const total = Math.max(2, durationSeconds);
  const lines = splitLines(title, 3);
  const bigPx = orientation === "portrait" ? Math.round(w * 0.13) : Math.round(w * 0.09);
  const lineHtml = lines.map((ln, i) => `<div class="cl" id="cl${i}" style="transform:rotate(${i === 1 ? -5 : i === 0 ? -2 : 2}deg);">${esc(ln)}</div>`).join("\n      ");
  const tl: string[] = [];
  lines.forEach((_l, i) => tl.push(`tl.fromTo("#cl${i}",{opacity:0,y:60,scale:.85},{opacity:1,y:0,scale:1,duration:.5,ease:"back.out(1.6)"},${(0.15 + i * 0.14).toFixed(2)});`));
  if (cta) tl.push(`tl.fromTo("#cta",{opacity:0,scale:.8},{opacity:1,scale:1,duration:.45,ease:"back.out(2)"},${(0.15 + lines.length * 0.14 + 0.15).toFixed(2)});`);
  tl.push(`tl.fromTo("#pbar",{scaleX:0},{scaleX:1,duration:${total.toFixed(2)},ease:"none"},0);`);
  return `${headShell(w, h)}
#root{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:0 ${Math.round(w * 0.07)}px;}
.cl{font-family:var(--disp);font-weight:400;font-size:${bigPx}px;line-height:.9;color:var(--red);opacity:0;transform-origin:center;margin:${Math.round(h * 0.003)}px 0;}
#cta{margin-top:${Math.round(h * 0.045)}px;font-family:var(--mono);font-weight:600;text-transform:uppercase;letter-spacing:2px;font-size:${Math.round(w * 0.038)}px;color:var(--bg);background:var(--dark);padding:${Math.round(h * 0.014)}px ${Math.round(w * 0.06)}px;border-radius:100px;opacity:0;}
#pbar{position:absolute;bottom:0;left:0;height:${Math.round(h * 0.006)}px;width:100%;background:var(--red);transform-origin:left;}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${total.toFixed(3)}" data-width="${w}" data-height="${h}" data-motion-blur="on">
  <div class="stack">
      ${lineHtml}
  </div>
  ${cta ? `<div id="cta">${esc(cta)}</div>` : ""}
  <div id="pbar"></div>
  ${mark ? `<div style="position:absolute;bottom:${Math.round(h * 0.02)}px;right:${Math.round(w * 0.05)}px;font-family:var(--mono);font-weight:600;letter-spacing:2px;font-size:${Math.round(w * 0.026)}px;color:var(--dark);opacity:.5;">${esc(mark)}</div>` : ""}
</div>
<script>
const tl=gsap.timeline({paused:true});
${tl.join("\n")}
window.__timelines=window.__timelines||{};window.__timelines["main"]=tl;
</script></body></html>`;
}

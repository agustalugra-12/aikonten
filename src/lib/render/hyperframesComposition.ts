// HyperFrames Composition Generator (Opsi C, 2026-11-02) - port dari composition.mjs v2.
// Dari input konten (footage + TTS url + wordTimings + hook + Brand Kit) -> HTML HyperFrames
// video penuh + overlay profesional (kinetic caption kata-per-kata, intro, lower-third, stat,
// CTA). Pola seek-safe: master timeline paused + window.__timelines; footage/audio = timed clip
// (id + class=clip). Dirender di worker terpisah (lihat hyperframesClient.ts). Overlay via GSAP.

export type HfWord = { word: string; start: number; end: number };
export type HfClip = { videoUrl: string; durationSeconds: number };
export type HfCompositionInput = {
  orientation?: "portrait" | "landscape" | "square";
  brand?: {
    primary?: string; bg2?: string; accent?: string; ink?: string; cta?: string; font?: string; mark?: string;
  };
  hook?: string;
  introSeconds?: number;
  clips?: HfClip[];
  audioUrl?: string | null;
  audioDurationSeconds?: number;
  words?: HfWord[];
  cta?: string;
  stat?: { label?: string; value?: string } | null;
  stats?: Array<{ label?: string; value?: string }> | null; // Fase 5 data blocks (AI statOverlays, >1)
  lowerThird?: { title?: string; subtitle?: string; atSeconds?: number; durationSeconds?: number } | null;
  look?: string; // Fase 3 Look system: clean|cinematic|warm|cool|vivid|mono (default clean)
  pacing?: string; // Fase 4 AI Director: fast|medium|calm - cadence cut + intensitas Ken Burns
};

const DIM = { portrait: { w: 1080, h: 1920 }, landscape: { w: 1920, h: 1080 }, square: { w: 1080, h: 1080 } };
function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Grup word-timings: 2-4 kata, pecah di jeda >=0.18s / akhir kalimat / batas kata.
function groupWords(words: HfWord[], maxWords = 4): HfWord[][] {
  const groups: HfWord[][] = [];
  let cur: HfWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w);
    const nxt = words[i + 1];
    const gap = nxt ? nxt.start - w.end : Infinity;
    const endsSentence = /[.!?]$/.test(w.word);
    if (cur.length >= maxWords || gap >= 0.18 || endsSentence) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}
function tileClips(clips: HfClip[], dur: number, maxTile = 99): Array<{ url: string; start: number; dur: number }> {
  const out: Array<{ url: string; start: number; dur: number }> = [];
  let t = 0, i = 0;
  const safe = clips && clips.length ? clips : [{ videoUrl: "", durationSeconds: 5 }];
  while (t < dur - 0.05 && out.length < 200) {
    const c = safe[i % safe.length];
    // maxTile (Fase 4 pacing): batasi durasi tiap potongan -> cut lebih sering utk pacing cepat.
    const L = Math.min(maxTile, typeof c.durationSeconds === "number" && c.durationSeconds > 0 ? c.durationSeconds : 5);
    const d = Math.min(L, dur - t);
    out.push({ url: c.videoUrl, start: t, dur: d });
    t += d; i++;
  }
  return out;
}

export function buildComposition(input: HfCompositionInput): string {
  const {
    orientation = "portrait", brand = {}, hook = "", introSeconds = 3,
    clips = [], audioUrl = null, audioDurationSeconds = 10, words = [], cta = "",
    stat = null, stats = null, lowerThird = null, look = "clean", pacing = "medium",
  } = input;
  // Fase 5 (data blocks): render BEBERAPA statOverlays AI (bukan cuma 1), staggered di
  // tengah video, tiap blok pop+punch lalu hilang. Fallback ke `stat` tunggal (back-compat).
  const statsArr = (stats && stats.length ? stats : stat ? [stat] : [])
    .filter((s) => s && (s.value || s.label)).slice(0, 3);

  const { w, h } = DIM[orientation] || DIM.portrait;
  const bg1 = brand.primary || "#14213D", bg2 = brand.bg2 || "#0c1526", accent = brand.accent || "#FFD84D";
  const ink = brand.ink || "#FFFFFF", ctaColor = brand.cta || "#CC1F1F", font = brand.font || "Poppins", mark = brand.mark || "";
  const total = introSeconds + audioDurationSeconds;

  // Fase 3 (Look system): grade sinematik per brand. CSS filter di footage (.bg) + tint
  // blend-mode (#grade) + vignette (#vignette). Default "clean" = grade halus universal
  // (low-risk, tak ada cast warna mencolok). Filter hanya kena .bg (footage); tint+vignette
  // kena footage & faceless. Brand pilih via brandKit.look.
  const LOOKS: Record<string, { filter: string; tint?: string; blend?: string; op?: number; vig: number }> = {
    clean: { filter: "contrast(1.06) saturate(1.10) brightness(1.02)", vig: 0.35 },
    cinematic: { filter: "contrast(1.12) saturate(1.16)", tint: "linear-gradient(180deg,#1a5f7a 0%,#ff9a3d 100%)", blend: "soft-light", op: 0.28, vig: 0.5 },
    warm: { filter: "contrast(1.06) saturate(1.12) sepia(0.12) brightness(1.03)", tint: "#ff8a3d", blend: "soft-light", op: 0.18, vig: 0.4 },
    cool: { filter: "contrast(1.10) saturate(0.96) brightness(0.98)", tint: "#2d6cff", blend: "soft-light", op: 0.20, vig: 0.45 },
    vivid: { filter: "contrast(1.14) saturate(1.32) brightness(1.02)", vig: 0.3 },
    mono: { filter: "grayscale(0.65) contrast(1.18) brightness(1.02)", tint: accent, blend: "soft-light", op: 0.12, vig: 0.45 },
  };
  const lk = LOOKS[look] || LOOKS.clean;
  const gradeHtml = lk.tint ? `<div id="grade"></div>` : "";
  const vignetteHtml = `<div id="vignette"></div>`;
  // Faceless (tanpa footage): HyperFrames gambar background brand beranimasi sendiri (ringan,
  // tak ada decode video) - cocok konten edukasi/quote/tips/fakta. Kalau ada footage -> tile.
  const faceless = !clips || clips.length === 0;
  // Fase 4 (AI Director pacing): cadence cut (tileMax) + intensitas zoom Ken Burns (kb).
  const tileMax = pacing === "fast" ? 2.6 : pacing === "calm" ? 6.5 : 4.2;
  const kb = pacing === "fast" ? 0.20 : pacing === "calm" ? 0.08 : 0.14;
  const vids = faceless ? [] : tileClips(clips, audioDurationSeconds, tileMax);
  const groups = groupWords(words);
  const capFont = Math.round(w * 0.078), introFont = Math.round(w * 0.115);

  // Fase 2 (camera motion + transisi): tiap klip dapat Ken Burns (zoom in/out + pan,
  // gantian arah per klip) + crossfade masuk (overlap XFADE dtk, klip i>0 mulai lebih
  // awal & fade opacity 0->1 nutup klip sebelumnya yg z-index lebih rendah). Transform &
  // opacity dianimasikan GSAP di master timeline (data-start/duration tetap atur window
  // media runtime). Scale >=1.14 + pan <=3.5% jaga frame tetap nutup (tak ada tepi hitam).
  const XFADE = 0.45;
  const clipWins = vids.map((v, i) => {
    const over = i > 0 ? XFADE : 0;
    const estart = Math.max(introSeconds, introSeconds + v.start - over);
    const edur = Math.min(v.dur + over, total - estart);
    const zoomIn = i % 2 === 0, dir = i % 2 === 0 ? 1 : -1;
    return {
      url: v.url, estart, edur, fade: i > 0,
      s0: zoomIn ? 1.10 : 1.10 + kb, s1: zoomIn ? 1.10 + kb : 1.10,
      x0: dir * 3.5, x1: -dir * 3.5, y0: dir * 2, y1: -dir * 2,
    };
  });
  const videoEls = clipWins.map((v, i) => `<video id="bg${i}" class="clip bg" muted playsinline data-start="${v.estart.toFixed(3)}" data-duration="${v.edur.toFixed(3)}" data-media-start="0" data-track-index="0" style="z-index:${1 + i}" src="${esc(v.url)}"></video>`).join("\n    ");
  const facelessHtml = faceless ? `<div id="facelessBg"></div>\n    <div class="blob" id="blob1"></div>\n    <div class="blob" id="blob2"></div>` : "";
  const audioEl = audioUrl ? `<audio id="vo" class="clip" data-start="${introSeconds.toFixed(3)}" data-volume="1" data-track-index="80" src="${esc(audioUrl)}"></audio>` : "";

  const capHtml = groups.map((g, gi) => {
    const ws = g.map((wd, wi) => `<span class="cw" id="g${gi}w${wi}">${esc(wd.word)}</span>`).join(" ");
    return `<div class="capgroup" id="cg${gi}">${ws}</div>`;
  }).join("\n    ");

  const tlLines: string[] = [];
  tlLines.push(`tl.fromTo("#bar",{scaleX:0},{scaleX:1,duration:.5,ease:"power2.inOut"},0);`);
  if (mark) tlLines.push(`tl.fromTo("#mark",{opacity:0,filter:"blur(6px)"},{opacity:1,filter:"blur(0px)",duration:.35,ease:"power4.out"},.3);`);
  const hookWords = esc(hook).split(/\s+/).filter(Boolean);
  hookWords.forEach((_wd, i) => { tlLines.push(`tl.fromTo("#hw${i}",{opacity:0,filter:"blur(6px)"},{opacity:1,filter:"blur(0px)",duration:.13,ease:"power4.out"},${(0.55 + i * 0.09).toFixed(3)});`); });
  tlLines.push(`tl.to("#introLayer",{opacity:0,filter:"blur(8px)",duration:.3,ease:"power3.in"},${(introSeconds - 0.3).toFixed(3)});`);
  tlLines.push(`tl.set("#introLayer",{visibility:"hidden"},${introSeconds.toFixed(3)});`);
  // Caption lead (2026-11-02, fix sync TTS<->teks): kata muncul CAP_LEAD dtk lebih awal utk
  // kompensasi durasi pop-in + persepsi (subtitle idealnya pas/sedikit SEBELUM kata diucapkan,
  // bukan sesudah). Pop dipercepat .22->.16. Di-clamp >= introSeconds (tak muncul saat intro).
  const CAP_LEAD = 0.14;
  const gStarts = groups.map((g) => Math.max(introSeconds, introSeconds + g[0].start - CAP_LEAD));
  groups.forEach((g, gi) => {
    const gStart = gStarts[gi];
    const naturalEnd = introSeconds + g[g.length - 1].end + 0.15;
    // Anti tumpang-tindih: grup N sembunyi TEPAT saat grup N+1 muncul (clamp ke gStart
    // berikutnya) -> cuma 1 grup caption terlihat. Grup terakhir pakai akhir natural.
    const gEnd = gi + 1 < gStarts.length ? Math.min(naturalEnd, gStarts[gi + 1]) : naturalEnd;
    g.forEach((wd, wi) => {
      const t = Math.max(introSeconds, introSeconds + wd.start - CAP_LEAD), te = introSeconds + wd.end;
      // Pop-in (scale+y) + karaoke: kata aktif warna aksen saat diucapkan, balik ink di akhir.
      tlLines.push(`tl.fromTo("#g${gi}w${wi}",{opacity:0,scale:.5,y:22},{opacity:1,scale:1,y:0,duration:.16,ease:"back.out(2)"},${t.toFixed(3)});`);
      tlLines.push(`tl.set("#g${gi}w${wi}",{color:"${accent}"},${t.toFixed(3)});`);
      tlLines.push(`tl.set("#g${gi}w${wi}",{color:"${ink}"},${te.toFixed(3)});`);
    });
    tlLines.push(`tl.set("#cg${gi}",{visibility:"hidden"},${gEnd.toFixed(3)});`);
    tlLines.push(`tl.set("#cg${gi}",{visibility:"visible"},${gStart.toFixed(3)});`);
  });
  if (lowerThird) {
    const lt = introSeconds + (lowerThird.atSeconds ?? 1.5), ld = lowerThird.durationSeconds ?? 3.5;
    tlLines.push(`tl.fromTo("#lt",{opacity:0,y:30},{opacity:1,y:0,duration:.4,ease:"power3.out"},${lt.toFixed(3)});`);
    tlLines.push(`tl.to("#lt",{opacity:0,duration:.35,ease:"power2.in"},${(lt + ld).toFixed(3)});`);
  }
  if (statsArr.length) {
    const n = statsArr.length;
    const base = introSeconds + audioDurationSeconds * 0.20;   // mulai stlh pembukaan
    const slot = (audioDurationSeconds * 0.58) / n;             // bagi rata di tengah video
    const hold = Math.min(2.4, Math.max(1.3, slot - 0.4));
    statsArr.forEach((_s, j) => {
      const st = base + j * slot;
      tlLines.push(`tl.fromTo("#statCard${j}",{opacity:0,scale:.7,y:24},{opacity:1,scale:1,y:0,duration:.42,ease:"back.out(2)"},${st.toFixed(3)});`);
      tlLines.push(`tl.to("#statCard${j}",{opacity:0,scale:.92,duration:.3,ease:"power2.in"},${(st + hold).toFixed(3)});`);
    });
  }
  const ctaStart = total - 2.6;
  if (cta) tlLines.push(`tl.fromTo("#cta",{opacity:0,y:28},{opacity:1,y:0,duration:.5,ease:"back.out(1.5)"},${ctaStart.toFixed(3)});`);
  // Camera motion + transisi klip (Fase 2) - lihat clipWins di atas.
  if (!faceless) {
    clipWins.forEach((v, i) => {
      if (v.fade) tlLines.push(`tl.fromTo("#bg${i}",{opacity:0},{opacity:1,duration:${XFADE},ease:"power1.inOut"},${v.estart.toFixed(3)});`);
      tlLines.push(`tl.fromTo("#bg${i}",{scale:${v.s0},xPercent:${v.x0},yPercent:${v.y0}},{scale:${v.s1},xPercent:${v.x1},yPercent:${v.y1},duration:${v.edur.toFixed(3)},ease:"power1.out"},${v.estart.toFixed(3)});`);
    });
  }
  // Faceless bg: 2 blob lembut drift PELAN satu arah sepanjang video (ambient, bukan loop
  // "breathing" yg terlihat AI-generated). Gerak halus = latar "hidup" tanpa footage.
  if (faceless) {
    tlLines.push(`tl.fromTo("#blob1",{x:-${Math.round(w*0.2)},y:-${Math.round(h*0.05)}},{x:${Math.round(w*0.15)},y:${Math.round(h*0.08)},duration:${total.toFixed(3)},ease:"power1.inOut"},0);`);
    tlLines.push(`tl.fromTo("#blob2",{x:${Math.round(w*0.2)},y:${Math.round(h*0.1)}},{x:-${Math.round(w*0.1)},y:-${Math.round(h*0.06)},duration:${total.toFixed(3)},ease:"power1.inOut"},0);`);
  }

  const hookSpans = hookWords.map((wd, i) => `<span class="hw" id="hw${i}">${wd}</span>`).join(" ");

  return `<!doctype html>
<html lang="id"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=${w}, height=${h}"/>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
:root{--bg1:${bg1};--bg2:${bg2};--accent:${accent};--ink:${ink};--cta:${ctaColor};--font:"${font}",sans-serif;}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:var(--bg1);}
#root{width:100%;height:100%;position:relative;font-family:var(--font);}
.bg{position:absolute;left:0;top:0;width:${w}px;height:${h}px;object-fit:cover;filter:${lk.filter};}
#grade{position:absolute;inset:0;z-index:250;pointer-events:none;background:${lk.tint || "transparent"};mix-blend-mode:${lk.blend || "normal"};opacity:${lk.op ?? 0};}
#vignette{position:absolute;inset:0;z-index:310;pointer-events:none;background:radial-gradient(ellipse 78% 72% at 50% 42%,transparent 48%,rgba(0,0,0,${lk.vig}) 100%);}
#facelessBg{position:absolute;inset:0;z-index:0;background:radial-gradient(120% 90% at 50% 10%,var(--bg1),var(--bg2));}
.blob{position:absolute;z-index:0;width:${Math.round(w * 0.9)}px;height:${Math.round(w * 0.9)}px;border-radius:50%;filter:blur(90px);}
#blob1{top:${Math.round(h * 0.04)}px;left:${Math.round(w * 0.08)}px;background:var(--accent);opacity:.26;}
#blob2{bottom:${Math.round(h * 0.06)}px;right:${Math.round(w * 0.04)}px;background:var(--cta);opacity:.22;}
#scrim{position:absolute;inset:0;z-index:300;background:linear-gradient(180deg,rgba(12,21,38,.22) 0%,rgba(12,21,38,.06) 40%,rgba(12,21,38,.78) 100%);}
.bar{position:absolute;top:0;left:0;height:12px;width:100%;background:var(--accent);z-index:650;transform-origin:left;}
.mark{position:absolute;top:70px;left:0;right:0;text-align:center;color:var(--accent);font-weight:800;font-size:${Math.round(w * 0.04)}px;letter-spacing:.05em;z-index:650;opacity:0;text-shadow:0 2px 12px rgba(0,0,0,.5);}
#introLayer{position:absolute;inset:0;z-index:600;background:radial-gradient(130% 90% at 50% 0%,var(--bg1),var(--bg2));display:flex;align-items:center;justify-content:center;text-align:center;padding:0 80px;}
#introText{color:var(--ink);font-weight:800;font-size:${introFont}px;line-height:1.02;letter-spacing:-.03em;overflow:visible;}
#introText .hw{display:inline-block;opacity:0;}
.capgroup{position:absolute;left:0;right:0;bottom:${Math.round(h * 0.17)}px;text-align:center;padding:0 60px;z-index:500;overflow:visible;visibility:hidden;}
.capgroup .cw{display:inline-block;transform-origin:center bottom;color:var(--ink);font-weight:800;font-size:${capFont}px;line-height:1.12;letter-spacing:-.02em;margin:0 .12em;opacity:0;text-shadow:0 4px 18px rgba(0,0,0,.65);}
#lt{position:absolute;left:64px;right:64px;bottom:${Math.round(h * 0.30)}px;z-index:520;opacity:0;background:rgba(15,16,22,.78);backdrop-filter:blur(18px);border-left:8px solid var(--accent);border-radius:14px;padding:26px 32px;}
#lt .t{color:var(--ink);font-weight:800;font-size:${Math.round(w * 0.052)}px;letter-spacing:-.01em;}
#lt .s{color:rgba(255,255,255,.8);font-weight:600;font-size:${Math.round(w * 0.036)}px;margin-top:6px;}
.statCard{position:absolute;left:0;right:0;top:${Math.round(h * 0.30)}px;text-align:center;z-index:540;opacity:0;}
.statCard .v{display:inline-block;background:var(--accent);color:#14213D;font-weight:800;font-size:${Math.round(w * 0.095)}px;padding:18px 40px;border-radius:18px;box-shadow:0 12px 34px rgba(0,0,0,.4);}
.statCard .l{display:block;color:var(--ink);font-weight:600;font-size:${Math.round(w * 0.04)}px;margin-top:14px;text-shadow:0 2px 12px rgba(0,0,0,.6);}
#cta{position:absolute;left:0;right:0;bottom:${Math.round(h * 0.075)}px;text-align:center;z-index:700;opacity:0;}
#cta span{display:inline-flex;align-items:center;gap:14px;background:var(--cta);color:#fff;font-weight:700;font-size:${Math.round(w * 0.046)}px;padding:26px 46px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.4);}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${total.toFixed(3)}" data-width="${w}" data-height="${h}" data-motion-blur="on">
    ${videoEls}${facelessHtml}
    ${gradeHtml}
    <div id="scrim"></div>
    ${vignetteHtml}
    ${audioEl}
    ${capHtml}
    ${lowerThird ? `<div id="lt"><div class="t">${esc(lowerThird.title || "")}</div>${lowerThird.subtitle ? `<div class="s">${esc(lowerThird.subtitle)}</div>` : ""}</div>` : ""}
    ${statsArr.map((s, j) => `<div class="statCard" id="statCard${j}"><span class="v">${esc(s.value || "")}</span><span class="l">${esc(s.label || "")}</span></div>`).join("")}
    <div class="bar" id="bar"></div>
    ${mark ? `<div class="mark" id="mark">${esc(mark)}</div>` : ""}
    <div id="introLayer"><div id="introText">${hookSpans}</div></div>
    ${cta ? `<div id="cta"><span>${esc(cta)} &#8594;</span></div>` : ""}
</div>
<script>
const tl=gsap.timeline({paused:true});
${tlLines.join("\n")}
window.__timelines=window.__timelines||{};window.__timelines["main"]=tl;
</script></body></html>`;
}

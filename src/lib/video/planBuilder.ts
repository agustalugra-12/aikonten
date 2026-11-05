// Builder VideoPlan -> komposisi HyperFrames (Tahap 6). Menerima plan YANG SUDAH VALID, menyusun input
// buildComposition lama (caption kata-per-kata, callout, audio VO, musik, look, Ken Burns, mediaStart) +
// layer adegan dari sceneLibrary. buildComposition lama tetap jalur default & fallback.
// Flag per brand: brandKit.videoPlanMode (lihat brandKit.ts) - default OFF, validator menolak aktivasi.
import { createHash } from "node:crypto";
import { buildComposition, type HfClip, type HfCompositionInput, type HfWord } from "@/lib/render/hyperframesComposition";
import type { Scene, VideoPlan } from "./videoPlan";
import { designBg, flashLayer, renderScene, safeHex, type BrandColors, type Layer } from "./sceneLibrary";
import { applyGlossary, fixText, freeZone, hookConfidence, isBlurry, MIN_FRAME_SHARP, officialName, subjectScore, subjectSource, type ClipAnalysis, type FootageSubject, type Zone } from "./footageFit";
import { captionLayer, hookLayer } from "./planText";

// mediaStart = awal segmen di sumber; subject = metadata isi (footage_bank/Pexels); analysis = ketajaman & letak subjek.
export type PlanFootage = { videoUrl: string; durationSeconds: number; mediaStart?: number; subject?: FootageSubject; analysis?: ClipAnalysis };
export type PlanMedia = {
  footage: Record<string, PlanFootage>;
  audioUrl: string | null;
  audioDurationSeconds: number;
  words: HfWord[];
  musicUrl?: string | null;
  brand: Partial<BrandColors> & { name?: string };
  brandLook?: string | null;        // brandKit.look menang atas plan.look
  emphasisPhrases?: string[];
  seed: string;                      // projectId -> variasi deterministik per video
  beatSeconds?: number | null;       // periode beat musik (bila diketahui) utk snap cut
  sfxBase?: string | null;           // mis. "./sfx" - null = tanpa efek suara
  glossary?: string[];               // istilah wajib benar di caption (nama brand otomatis ditambahkan)
};
export type SceneWindow = { scene: Scene; start: number; dur: number };

const DIM = { portrait: { w: 1080, h: 1920 }, landscape: { w: 1920, h: 1080 }, square: { w: 1080, h: 1080 } };
const MIN_SCENE = 0.8;

// Jendela waktu tiap adegan. Hook = intro (sebelum VO). Adegan lain diskalakan agar total = durasi VO, lalu
// tiap batas di-snap ke jeda kata terdekat (±0.35s) dan, bila beat diketahui, ke beat terdekat (±0.15s).
export function planWindows(plan: VideoPlan, audioDur: number, words: HfWord[], beat?: number | null): SceneWindow[] {
  const [hook, ...rest] = plan.scenes;
  const H = hook.duration;
  const sum = rest.reduce((a, s) => a + s.duration, 0) || 1;
  const k = audioDur / sum;
  const bounds = [H];
  for (const s of rest) bounds.push(bounds[bounds.length - 1] + s.duration * k);
  const gaps = words.slice(0, -1).map((w, i) => H + (w.end + words[i + 1].start) / 2);
  for (let i = 1; i < bounds.length - 1; i++) {
    let b = bounds[i];
    const g = gaps.reduce((best, x) => (Math.abs(x - b) < Math.abs(best - b) ? x : best), Infinity);
    if (Math.abs(g - b) <= 0.35) b = g;
    if (beat && beat > 0.2) { const q = Math.round(b / beat) * beat; if (Math.abs(q - b) <= 0.15) b = q; }
    if (b - bounds[i - 1] >= MIN_SCENE && bounds[i + 1] - b >= MIN_SCENE) bounds[i] = b;
  }
  const out: SceneWindow[] = [{ scene: hook, start: 0, dur: H }];
  rest.forEach((s, i) => out.push({ scene: s, start: bounds[i], dur: bounds[i + 1] - bounds[i] }));
  return out;
}

const hashInt = (s: string) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16);
const refOf = (s: Scene): string | undefined => ("footageRef" in s ? (s as { footageRef?: string }).footageRef : undefined);
const startOf = (s: Scene): number | undefined => ("mediaStart" in s ? (s as { mediaStart?: number }).mediaStart : undefined);

export type PlanBuild = { hookBox: [number, number] | null; hookAvoid: [number, number] | null; hookWhy: Record<string, string>; html: string; input: HfCompositionInput; windows: SceneWindow[]; clipScenes: string[]; heroRef: string | null; hookMode: "footage" | "design"; designScenes: string[]; footageKurang: string[]; framed: string[]; glossaryFixed: string[]; captionLines: Array<{ text: string; start: number; end: number; zone: Zone | null }> };

// Field teks adegan yg ikut dikoreksi glossary.
function fixScene(s: Scene, terms: string[]): Scene {
  const f = (x: unknown) => (typeof x === "string" ? fixText(x, terms) : x);
  const o = { ...s } as Record<string, unknown>;
  for (const k of ["text", "caption", "title", "label", "quote", "author", "sub", "tagline", "value"]) if (k in o) o[k] = f(o[k]);
  if (Array.isArray(o.items)) o.items = (o.items as string[]).map((x) => fixText(x, terms));
  for (const k of ["before", "after"]) if (o[k]) o[k] = { ...(o[k] as object), label: f((o[k] as { label: string }).label) };
  return o as Scene;
}

export function buildCompositionFromPlan(plan0: VideoPlan, m: PlanMedia): PlanBuild {
  const { w, h } = DIM[plan0.orientation];
  const brand: BrandColors = {
    primary: safeHex(m.brand.primary, "#14213D"), bg2: safeHex(m.brand.bg2, "#0c1526"), accent: safeHex(m.brand.accent, "#FFD84D"),
    ink: safeHex(m.brand.ink, "#FFFFFF"), cta: safeHex(m.brand.cta, "#CC1F1F"), font: m.brand.font || "Poppins", mark: (m.brand.mark || m.brand.name || "").toUpperCase(),
  };
  // Glossary: nama brand + istilah Brand Kit -> koreksi ejaan caption VO & teks adegan.
  const terms = [officialName(m.brand.name), m.brand.mark, ...(m.glossary ?? [])].filter((x): x is string => !!x);
  const g = applyGlossary(m.words, terms);
  const words = g.words;
  const plan: VideoPlan = { ...plan0, scenes: plan0.scenes.map((s) => fixScene(s, terms)) as VideoPlan["scenes"] };
  const windows = planWindows(plan, m.audioDurationSeconds, words, m.beatSeconds);

  // Kecocokan footage per adegan: subjek adegan (atau teks hook) harus ada di metadata footage. Adegan
  // tanpa subject & footage tanpa metadata (plan lama) tetap diterima, KECUALI hook (wajib terbukti cocok).
  const known = (r?: string) => (r && m.footage[r] ? r : undefined);
  const sharpOf = (r: string) => m.footage[r].analysis?.sharp;
  const bestSharp = Math.max(0, ...Object.keys(m.footage).map((r) => sharpOf(r) ?? 0));
  const sharpOk = (r: string) => !isBlurry(sharpOf(r), bestSharp);
  const hookWhy: Record<string, string> = {}; // alasan tiap kandidat hero diterima/ditolak (debug/QC)
  const fits = (s: Scene, r: string | undefined, isHook: boolean): boolean => {
    if (!r) return false;
    const subj = s.subject || (isHook && s.type === "hook" ? s.text : "");
    const meta = m.footage[r].subject;
    if (isHook) { const c = hookConfidence(subj, meta); hookWhy[r] = sharpOk(r) ? c.reason : "buram"; return c.ok && sharpOk(r); }
    // Klaim subjek (subject adegan, caption berlabel footage-caption, atau before-after) WAJIB footage ber-metadata
    // isi frame (source=="vision" / ber-tags), bukan query Pexels atau tanpa metadata -> kalau tidak, adegan desain
    // (sama seperti hook: klip query "vampire finch" ternyata burung kecil di tangan). Tanpa klaim subjek ->
    // footage bebas (pemakaian latar / plan lama tanpa subject tetap diterima).
    const claim = !!s.subject || (s.type === "footage-caption" && !!s.caption) || s.type === "before-after";
    if (!claim) return true;
    if (subjectSource(meta) !== "vision") return false;
    return !s.subject || subjectScore(s.subject, meta) > 0;
  };
  const hook = windows[0].scene;
  // Hero hanya bila YAKIN (hookConfidence: metadata isi frame, bukan query Pexels; cakupan subjek ≥50%) & tak buram.
  // Hero = footage hook bila cocok; kalau tidak, cari footage plan lain yg cocok dgn hook. Tak ada -> hook desain.
  // Kandidat: footage hook dulu, lalu footage lain di plan, lalu seluruh footage tersedia; yg cocok subjek & tak buram,
  // tertajam menang (tanpa analisis = dianggap tajam), seri -> skor subjek.
  const cands = [...new Set([refOf(hook), ...plan.scenes.map(refOf), ...Object.keys(m.footage)].map(known).filter((x): x is string => !!x))];
  const hookSubj = hook.subject || (hook.type === "hook" ? hook.text : "");
  const sh = (r: string) => sharpOf(r) ?? Infinity;
  const heroRef = cands.filter((r) => fits(hook, r, true)).sort((a, b) => (sh(b) - sh(a)) || subjectScore(hookSubj, m.footage[b].subject) - subjectScore(hookSubj, m.footage[a].subject))[0] ?? null;
  const hookMode: "footage" | "design" = heroRef ? "footage" : "design";
  // Utamakan footage nyata (PRIORITAS 1): adegan ber-klaim subjek yg klip BAWAANnya tak cocok boleh memakai klip
  // LAIN yg isinya terbukti cocok (vision + skor subjek >0, tertajam menang) SEBELUM jatuh ke adegan desain.
  const altFor = (subj: string): string | undefined =>
    Object.keys(m.footage).filter((r) => subjectSource(m.footage[r].subject) === "vision" && subjectScore(subj, m.footage[r].subject) > 0).sort((a, b) => sh(b) - sh(a))[0];
  const claimSubj = (s: Scene): string | undefined => s.subject || (s.type === "footage-caption" ? s.caption : undefined);
  const footageKurang: string[] = []; // subjek yg tak punya footage cocok -> sinyal "tenant perlu tambah footage"

  // Klip per adegan (panjang = jendela adegan). Adegan desain: footage tak dipakai (klip sebelumnya
  // diperpanjang di bawah latar desain). Jendela sebelum klip pertama ditanggung klip pertama (mulai t=0).
  const used = new Map<string, number>();
  const clips: HfClip[] = [], transitions: string[] = [], clipScenes: string[] = [], clipRefs: string[] = [], flashes: number[] = [];
  const designScenes: string[] = [];
  let lead = 0;
  const push = (ref: string, dur: number, ms: number | undefined, trans: string, sceneId: string) => {
    const f = m.footage[ref];
    const base = f.mediaStart ?? 0;
    const full = dur + (clips.length ? 0 : lead);
    let off = ms ?? used.get(ref) ?? 0;
    if (off + full > f.durationSeconds) off = Math.max(0, f.durationSeconds - full);
    used.set(ref, off + full);
    clips.push({ videoUrl: f.videoUrl, durationSeconds: full, mediaStart: base + off });
    transitions.push(clips.length === 1 ? "cut" : trans === "flash" ? "cut" : trans);
    clipScenes.push(sceneId); clipRefs.push(ref);
  };
  const clipAt: Array<string | null> = []; // footage yg tampil per jendela (null = desain)
  windows.forEach((win, i) => {
    const s = win.scene;
    if (s.transition === "flash" && i > 0) flashes.push(win.start);
    if (s.type === "before-after") {
      const ok = [s.before.footageRef, s.after.footageRef].every((r) => known(r) && fits(s, r, false));
      if (ok) {
        push(s.before.footageRef, win.dur / 2, s.before.mediaStart, s.transition, s.id);
        push(s.after.footageRef, win.dur / 2, s.after.mediaStart, "slide", s.id);
        clipAt.push(s.before.footageRef); return;
      }
      designScenes.push(s.id); if (s.subject) footageKurang.push(s.subject);
      clipAt.push(null);
      if (clips.length) clips[clips.length - 1].durationSeconds += win.dur; else lead += win.dur;
      return;
    }
    const ref0 = i === 0 ? heroRef ?? undefined : known(refOf(s));
    let ref = ref0, ok = i === 0 ? !!heroRef : !!ref && fits(s, ref, false);
    if (!ok && i > 0 && s.subject) { const alt = altFor(s.subject); if (alt) { ref = alt; ok = true; } } // footage lain yg cocok
    if (ref && ok) { push(ref, win.dur, ref === ref0 ? startOf(s) : undefined, s.transition, s.id); clipAt.push(ref); return; }
    if (i > 0 && (ref0 || claimSubj(s))) designScenes.push(s.id);
    if (i > 0) { const cs = claimSubj(s); if (cs) footageKurang.push(cs); }
    clipAt.push(null);
    if (clips.length) clips[clips.length - 1].durationSeconds += win.dur; else lead += win.dur;
  });
  if (!clips.length) lead = 0; // tanpa footage sama sekali -> faceless

  // Zona subjek per jendela (analisis frame): teks/kartu ditaruh di zona yg tak menimpa subjek.
  const subOf = (i: number) => { const r = clipAt[i]; return r ? m.footage[r].analysis : undefined; };
  const CARD = new Set(["stat", "testimonial", "feature-list", "footage-caption", "cta"]);
  const cardZone = windows.map((win, i) => (CARD.has(win.scene.type) ? freeZone(subOf(i), win.scene.type === "cta" ? "bottom" : "top") : null));
  // Caption SELALU tampil (keterbacaan VO diutamakan): di zona lain dari kartu; tanpa kartu di zona yg paling
  // sedikit menimpa subjek. Proxy subjek (energi tepi) hampir selalu menyentuh zona bawah -> tak boleh menyembunyikan.
  const capZone = windows.map((_w, i): Zone => {
    const cz = cardZone[i];
    return cz ? (cz === "top" ? "bottom" : "top") : freeZone(subOf(i), "bottom");
  });
  const winAt = (t: number) => { let k = 0; windows.forEach((x, i) => { if (t >= x.start - 1e-6) k = i; }); return k; };

  // Klip buram/resolusi rendah (sharp < MIN_FRAME_SHARP): tampil terbingkai di atas latar brand. Revisi-3: lebar
  // bingkai = lebar sumber (tanpa upscale); sumber < 40% lebar layar boleh naik sampai 40% (bingkai terlalu kecil
  // lebih buruk); tanpa Ken Burns & tanpa transisi zoom/whip (scale memperburuk blur).
  const frameOf = (r: string) => {
    const a = m.footage[r].analysis;
    if (!a || a.sharp >= MIN_FRAME_SHARP || !a.srcW || !a.srcH) return null;
    const fw = Math.round(Math.min(w * 0.86, Math.max(a.srcW, w * 0.4))), fh = Math.round((fw * a.srcH) / a.srcW);
    return { fw, fh, left: Math.round((w - fw) / 2), top: Math.round((h - fh) / 2) };
  };
  const seed = hashInt(m.seed);
  const layers: Layer[] = [];
  const busy: Array<[number, number]> = [];
  const ctaScene = plan.scenes.find((s) => s.type === "cta");
  // Hook: terbaca penuh di frame 0 (footage hero atau latar desain).
  // Hook tak boleh menimpa subjek: bingkai hero (klip terbingkai) atau rentang subjek hasil analisis (full-bleed).
  const heroFrame = heroRef ? frameOf(heroRef) : null, heroA = heroRef ? m.footage[heroRef].analysis : undefined;
  const hookAvoid: [number, number] | null = heroFrame ? [heroFrame.top, heroFrame.top + heroFrame.fh] : heroA ? [Math.round(heroA.y0 * h), Math.round(heroA.y1 * h)] : null;
  let hookBox: [number, number] | null = null;
  if (hook.type === "hook") { const hl = hookLayer({ text: hook.text, dur: windows[0].dur, avoid: hookAvoid, w, h, tone: plan.brand.tone, brand, design: !heroRef || !clips.length }); hookBox = hl.box; layers.push(hl); }
  windows.forEach((win, i) => {
    if (i === 0) return;
    const design = designScenes.includes(win.scene.id) || (!clips.length && win.scene.type !== "logo-outro");
    const L = renderScene(win.scene, { idx: i, start: win.start, dur: win.dur, w, h, tone: plan.brand.tone, brand, variant: (seed >> i) & 1, place: cardZone[i] ?? undefined, design, ctaText: win.scene.type === "logo-outro" && ctaScene?.type === "cta" ? ctaScene.text : undefined });
    if (design && win.scene.type !== "footage-caption") layers.push(designBg(`vpd${i}`, win.start, win.dur, brand));
    if (L) layers.push(L);
    if (!["hook", "footage-caption"].includes(win.scene.type)) busy.push([win.start, win.start + win.dur]);
    if (win.scene.type === "cta") layers.push({ html: `<div id="vpDim${i}" class="vpdim"></div>`, css: `.vpdim{position:absolute;inset:0;z-index:330;background:rgba(6,10,18,.38);visibility:hidden;}`, tl: [`tl.set("#vpDim${i}",{visibility:"visible"},${win.start.toFixed(3)});`, `tl.set("#vpDim${i}",{visibility:"hidden"},${(win.start + win.dur).toFixed(3)});`] });
  });
  // Plan berakhir dgn CTA tanpa logo-outro -> paruh akhir CTA ditutup end card brand (nama brand + pil CTA),
  // supaya frame terakhir selalu bersih & nama brand terbaca.
  const lastW = windows[windows.length - 1];
  if (lastW.scene.type === "cta") {
    const st = lastW.start + lastW.dur * 0.5, du = lastW.dur * 0.5;
    const L = renderScene({ id: "endcard", type: "logo-outro", duration: du, transition: "crossfade" }, { idx: 99, start: st, dur: du, w, h, tone: plan.brand.tone, brand, variant: 0, ctaText: lastW.scene.text });
    if (L) layers.push(L);
  }
  // Caption VO: 1 baris terpusat, zona bebas subjek/kartu; tak tampil di outro (tertutup layar brand).
  const H = windows[0].dur, total = H + m.audioDurationSeconds;
  const cap = captionLayer(words, { offset: H, total, w, h, brand, zoneAt: (t) => capZone[winAt(t)] });
  layers.push(cap);
  const framed: string[] = [];
  clipRefs.forEach((r, k) => {
    const f = frameOf(r);
    if (!f) return;
    framed.push(r);
    if (transitions[k] === "zoom" || transitions[k] === "whip") transitions[k] = "slide";
    // Latar bingkai ada di wrapper #cwK yg z-index-nya di atas klip sebelumnya & selalu tampil -> tanpa gerbang
    // waktu, latar klip berikutnya menutupi klip yg sedang tayang (footage hilang). Wrapper hanya tampil di
    // jendela klipnya sendiri (data-start/duration dibaca dari <video> agar sama persis dgn builder lama).
    // Bayangan/garis bingkai di ::before wrapper (HyperFrames mengganti <video> dgn <img> tanpa box-shadow),
    // ikut gerbang waktu wrapper -> hanya tampil di jendela klip.
    const gate = `((d)=>{const s=+d.start,e=s+ +d.duration;tl.set("#cw${k}",{visibility:"hidden"},0);tl.set("#cw${k}",{visibility:"visible"},s);tl.set("#cw${k}",{visibility:"hidden"},e);})(document.getElementById("bg${k}").dataset);`;
    const box = `width:${f.fw}px;height:${f.fh}px;left:${f.left}px;top:${f.top}px;border-radius:28px;`;
    // Bayangan bingkai WAJIB terlihat di latar brand gelap MAUPUN terang (bertahan di render JPG): cincin putih
    // tebal (nampak di latar gelap) + garis gelap tipis di luarnya + drop/glow gelap (nampak di latar terang).
    layers.push({ html: "", tl: [gate], css: `#cw${k}{background:radial-gradient(120% 85% at 50% 30%,${brand.primary},${brand.bg2});}#cw${k}::before{content:"";position:absolute;${box}box-shadow:0 28px 70px rgba(0,0,0,.6),0 0 0 5px rgba(255,255,255,.5),0 0 0 7px rgba(0,0,0,.3),0 0 42px 14px rgba(0,0,0,.4);}#bg${k}{${box.replace(/;/g, "!important;").replace("border-radius:28px!important;", "border-radius:28px;")}transform:none!important;}` });
  });
  // Mode plan: intro lama dimatikan (hook pakai hookLayer), scrim layar penuh diperingan; nama brand dlm pil.
  layers.push({ html: "", tl: [], css: `#introLayer{display:none;}#scrim{background:linear-gradient(180deg,rgba(6,12,24,.2) 0%,rgba(6,12,24,0) 22%,rgba(6,12,24,0) 70%,rgba(6,12,24,.28) 100%);}#mark{left:50%;right:auto;transform:translateX(-50%);white-space:nowrap;background:rgba(8,10,14,.72);padding:10px 28px;border-radius:999px;text-shadow:none;}` });
  const fl = flashLayer(clips.length ? flashes : []);
  if (fl) layers.push(fl);
  if (m.sfxBase) {
    const sfx: string[] = [];
    windows.forEach((win, i) => {
      if (i > 0 && win.scene.transition !== "cut" && win.scene.transition !== "crossfade") sfx.push(`<audio id="sfxw${i}" class="clip" data-start="${Math.max(0, win.start - 0.15).toFixed(3)}" data-volume="0.35" data-track-index="${82 + (i % 4)}" src="${m.sfxBase}/whoosh.wav"></audio>`);
      if (win.scene.type === "stat" || win.scene.type === "cta") sfx.push(`<audio id="sfxh${i}" class="clip" data-start="${(win.start + 0.1).toFixed(3)}" data-volume="0.4" data-track-index="${86 + (i % 4)}" src="${m.sfxBase}/hit.wav"></audio>`);
    });
    if (sfx.length) layers.push({ html: sfx.join(""), css: "", tl: [] });
  }

  const input: HfCompositionInput = {
    orientation: plan.orientation,
    brand: { primary: brand.primary, bg2: brand.bg2, accent: brand.accent, ink: brand.ink, cta: brand.cta, font: brand.font, mark: brand.mark },
    hook: "", introSeconds: H,
    clips, audioUrl: m.audioUrl, audioDurationSeconds: m.audioDurationSeconds, words: [],
    musicUrl: plan.music.mood === "none" ? null : m.musicUrl ?? null, musicVolume: plan.music.volume,
    look: m.brandLook || plan.look, pacing: plan.pacing, emphasisPhrases: [],
    cta: "", stats: null, stat: null, lowerThird: null,
    transitions, tileMax: 99, busy, layers,
  };
  return { hookBox, hookAvoid, hookWhy, html: buildComposition(input), input, windows, clipScenes, heroRef, hookMode, designScenes, footageKurang: [...new Set(footageKurang)], framed, glossaryFixed: g.fixed, captionLines: cap.lines.map(({ text, start, end, zone }) => ({ text, start, end, zone })) };
}

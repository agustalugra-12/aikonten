// Builder VideoPlan -> komposisi HyperFrames (Tahap 6). Menerima plan YANG SUDAH VALID, menyusun input
// buildComposition lama (caption kata-per-kata, callout, audio VO, musik, look, Ken Burns, mediaStart) +
// layer adegan dari sceneLibrary. buildComposition lama tetap jalur default & fallback.
// Flag per brand: brandKit.videoPlanMode (lihat brandKit.ts) - default OFF, validator menolak aktivasi.
import { createHash } from "node:crypto";
import { buildComposition, type HfClip, type HfCompositionInput, type HfWord } from "@/lib/render/hyperframesComposition";
import type { Scene, VideoPlan } from "./videoPlan";
import { flashLayer, renderScene, safeHex, type BrandColors, type Layer } from "./sceneLibrary";

export type PlanFootage = { videoUrl: string; durationSeconds: number; mediaStart?: number }; // mediaStart = awal segmen di sumber
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

export type PlanBuild = { html: string; input: HfCompositionInput; windows: SceneWindow[]; clipScenes: string[]; heroRef: string | null };

export function buildCompositionFromPlan(plan: VideoPlan, m: PlanMedia): PlanBuild {
  const { w, h } = DIM[plan.orientation];
  const windows = planWindows(plan, m.audioDurationSeconds, m.words, m.beatSeconds);
  const brand: BrandColors = {
    primary: safeHex(m.brand.primary, "#14213D"), bg2: safeHex(m.brand.bg2, "#0c1526"), accent: safeHex(m.brand.accent, "#FFD84D"),
    ink: safeHex(m.brand.ink, "#FFFFFF"), cta: safeHex(m.brand.cta, "#CC1F1F"), font: m.brand.font || "Poppins", mark: (m.brand.mark || m.brand.name || "").toUpperCase(),
  };

  // Hero-first: footage hook = klip-0. Hook tanpa footageRef -> footage pertama di plan (bila ada).
  const known = (r?: string) => (r && m.footage[r] ? r : undefined);
  const firstRef = plan.scenes.map(refOf).map(known).find(Boolean)
    ?? plan.scenes.flatMap((s) => (s.type === "before-after" ? [known(s.before.footageRef), known(s.after.footageRef)] : [])).find(Boolean);
  const heroRef = known(refOf(windows[0].scene)) ?? firstRef ?? null;

  // Klip per adegan: panjang klip = jendela adegan (cut persis di batas). Footage dipakai ulang -> lanjut dari
  // bagian berikutnya (bukan frame sama). Adegan tanpa footage -> klip sebelumnya diperpanjang.
  const used = new Map<string, number>();
  const clips: HfClip[] = [], transitions: string[] = [], clipScenes: string[] = [], flashes: number[] = [];
  const push = (ref: string, dur: number, ms: number | undefined, trans: string, sceneId: string) => {
    const f = m.footage[ref];
    const base = f.mediaStart ?? 0;
    let off = ms ?? used.get(ref) ?? 0;
    if (off + dur > f.durationSeconds) off = Math.max(0, f.durationSeconds - dur); // jangan lewat ujung sumber
    used.set(ref, off + dur);
    clips.push({ videoUrl: f.videoUrl, durationSeconds: dur, mediaStart: base + off });
    transitions.push(clips.length === 1 ? "cut" : trans === "flash" ? "cut" : trans);
    clipScenes.push(sceneId);
  };
  windows.forEach((win, i) => {
    const s = win.scene;
    const isFlash = s.transition === "flash" && i > 0;
    if (isFlash) flashes.push(win.start);
    if (s.type === "before-after") {
      push(s.before.footageRef, win.dur / 2, s.before.mediaStart, s.transition, s.id);
      push(s.after.footageRef, win.dur / 2, s.after.mediaStart, "slide", s.id);
      return;
    }
    const ref = i === 0 ? heroRef ?? undefined : known(refOf(s));
    if (ref) push(ref, win.dur, startOf(s), s.transition, s.id);
    else if (clips.length) clips[clips.length - 1].durationSeconds += win.dur;
  });
  if (!heroRef) clips.length = 0; // tanpa footage sama sekali -> faceless (background brand)

  // Layer adegan (gaya per tone brand; variasi per video dari seed).
  const seed = hashInt(m.seed);
  const layers: Layer[] = [];
  const busy: Array<[number, number]> = [];
  windows.forEach((win, i) => {
    if (win.scene.type === "hook" && !clips.length) return; // zoom hook butuh klip-0
    const L = renderScene(win.scene, { idx: i, start: win.start, dur: win.dur, w, h, tone: plan.brand.tone, brand, variant: (seed >> i) & 1 });
    if (L) layers.push(L);
    if (!["hook", "footage-caption"].includes(win.scene.type)) busy.push([win.start, win.start + win.dur]);
  });
  const fl = flashLayer(clips.length ? flashes : []);
  if (fl) layers.push(fl);
  // Efek suara (aset lokal hasil generate sendiri, lihat scripts/gen-sfx.sh): whoosh di transisi, hit di stat.
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
    hook: windows[0].scene.type === "hook" ? windows[0].scene.text : "",
    introSeconds: windows[0].dur,
    clips, audioUrl: m.audioUrl, audioDurationSeconds: m.audioDurationSeconds, words: m.words,
    musicUrl: plan.music.mood === "none" ? null : m.musicUrl ?? null, musicVolume: plan.music.volume,
    look: m.brandLook || plan.look, pacing: plan.pacing, emphasisPhrases: m.emphasisPhrases || [],
    cta: "", stats: null, stat: null, lowerThird: null, // CTA/stat/testimoni dari adegan, bukan overlay otomatis lama
    transitions, tileMax: 99, busy, layers,
  };
  return { html: buildComposition(input), input, windows, clipScenes, heroRef };
}

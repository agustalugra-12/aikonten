import { ALL_MOTION_TYPES, type MotionType } from "./cameraMotion";
import { isTransitionType, type TransitionType } from "./transitions";

// Scene Manifest JSON (2026-10-27, Fase 4 - FONDASI utk Timeline Editor Fase 5). Representasi
// TERSTRUKTUR & editable dari urutan adegan video, menyatukan data yg saat ini TERSEBAR
// (clipSelection footage+timing, directorDecision motion/transisi ephemeral, overlay/text,
// orientasi). SENGAJA REUSE type yg ada (MotionType/TransitionType) - tidak menduplikasi.
//
// Modul MURNI (tanpa ffmpeg/DB/IO). Fase 4 BELUM diwire ke processProject & BELUM dipersist
// (kolom DB = langkah berikut, butuh approval) -> NOL perubahan perilaku produksi. Pemakaian:
//   - compileManifestToRenderInputs(manifest) -> subset opts renderFinalVideo (editor/AI -> render).
//   - buildManifestFromRenderInputs(...) -> capture render saat ini jadi manifest (seed editor).
//   - resolveSceneManifest(json) -> manifest|null (invalid/absen -> null -> pakai flow lama).
//
// Desain minimal (temuan audit): renderFinalVideo HANYA pakai sourceUrl/start/end dari tiap
// segment + videoUrl/durationSeconds dari broll + motions[]/transitions[] + orientasi + teks
// overlay. Design visual (subtitle/title/kinetic/bg) TETAP dari Brand Kit (tidak digandakan ke
// manifest) - manifest cukup menandai teks & urutan; design di-resolve runtime dari brandKit.

export const SCENE_MANIFEST_VERSION = 1;
export type SceneOrientation = "portrait" | "landscape" | "square"; // = VideoOrientation (ffmpeg.ts)

export type SceneFootage =
  | { kind: "segment"; sourceUrl: string; start: number; end: number }
  | { kind: "broll"; videoUrl: string; durationSeconds: number };

export type Scene = {
  id: string;
  footage: SceneFootage;
  motion?: MotionType;
  transitionAfter?: TransitionType; // transisi ke scene berikutnya (scene terakhir diabaikan)
};

export type SceneManifest = {
  version: typeof SCENE_MANIFEST_VERSION;
  orientation: SceneOrientation;
  scenes: Scene[];
  overlays?: {
    titleText?: string | null;
    kineticText?: string | null;
    ctaText?: string | null;
    lowerThird?: { name: string; tagline: string } | null;
  };
  audio?: { musicUrl?: string | null; hasVoiceover?: boolean };
  subtitlePresent?: boolean;
  maxDurationSeconds?: number;
};

const ORIENTATIONS: SceneOrientation[] = ["portrait", "landscape", "square"];
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

export type ValidateResult = { ok: true; value: SceneManifest } | { ok: false; error: string };

// Validasi KETAT (gerbang): tipe/enum/rentang per-field. Tidak menerima ekspresi filter -
// url/teks hanya string (renderer tetap escape path saat dipakai); motion/transisi dari
// allowlist. Scene kosong ditolak. Aset "tidak ditemukan" di sini = hanya cek bentuk ref
// (string non-kosong); keberadaan file nyata dicek saat render (di luar validasi skema).
export function validateSceneManifest(input: unknown): ValidateResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "manifest harus object" };
  const o = input as Record<string, unknown>;
  if (o.version !== SCENE_MANIFEST_VERSION) return { ok: false, error: `version harus ${SCENE_MANIFEST_VERSION}` };
  if (!ORIENTATIONS.includes(o.orientation as SceneOrientation)) return { ok: false, error: "orientation harus portrait/landscape/square" };
  if (!Array.isArray(o.scenes) || o.scenes.length === 0) return { ok: false, error: "scenes harus array non-kosong" };

  const scenes: Scene[] = [];
  for (let i = 0; i < o.scenes.length; i++) {
    const s = o.scenes[i] as Record<string, unknown>;
    if (typeof s !== "object" || s === null) return { ok: false, error: `scene[${i}] harus object` };
    if (!isStr(s.id) || s.id.length === 0) return { ok: false, error: `scene[${i}].id harus string non-kosong` };
    const f = s.footage as Record<string, unknown>;
    if (typeof f !== "object" || f === null) return { ok: false, error: `scene[${i}].footage harus object` };
    let footage: SceneFootage;
    if (f.kind === "segment") {
      if (!isStr(f.sourceUrl) || f.sourceUrl.length === 0) return { ok: false, error: `scene[${i}].footage.sourceUrl harus string non-kosong` };
      if (!isNum(f.start) || !isNum(f.end) || f.start < 0 || f.end <= f.start) return { ok: false, error: `scene[${i}].footage start/end tidak valid (0<=start<end)` };
      footage = { kind: "segment", sourceUrl: f.sourceUrl, start: f.start, end: f.end };
    } else if (f.kind === "broll") {
      if (!isStr(f.videoUrl) || f.videoUrl.length === 0) return { ok: false, error: `scene[${i}].footage.videoUrl harus string non-kosong` };
      if (!isNum(f.durationSeconds) || f.durationSeconds <= 0) return { ok: false, error: `scene[${i}].footage.durationSeconds harus > 0` };
      footage = { kind: "broll", videoUrl: f.videoUrl, durationSeconds: f.durationSeconds };
    } else {
      return { ok: false, error: `scene[${i}].footage.kind harus segment/broll` };
    }
    const scene: Scene = { id: s.id, footage };
    if (s.motion !== undefined) {
      if (!ALL_MOTION_TYPES.includes(s.motion as MotionType)) return { ok: false, error: `scene[${i}].motion tidak dikenal` };
      scene.motion = s.motion as MotionType;
    }
    if (s.transitionAfter !== undefined) {
      if (!isTransitionType(s.transitionAfter)) return { ok: false, error: `scene[${i}].transitionAfter tidak dikenal` };
      scene.transitionAfter = s.transitionAfter;
    }
    scenes.push(scene);
  }

  const out: SceneManifest = { version: SCENE_MANIFEST_VERSION, orientation: o.orientation as SceneOrientation, scenes };
  if (o.overlays !== undefined && o.overlays !== null) {
    if (typeof o.overlays !== "object" || Array.isArray(o.overlays)) return { ok: false, error: "overlays harus object" };
    const ov = o.overlays as Record<string, unknown>;
    const outOv: NonNullable<SceneManifest["overlays"]> = {};
    for (const k of ["titleText", "kineticText", "ctaText"] as const) {
      if (k in ov && ov[k] !== undefined) {
        if (ov[k] !== null && !isStr(ov[k])) return { ok: false, error: `overlays.${k} harus string atau null` };
        outOv[k] = ov[k] as string | null;
      }
    }
    if ("lowerThird" in ov && ov.lowerThird !== undefined && ov.lowerThird !== null) {
      const lt = ov.lowerThird as Record<string, unknown>;
      if (!isStr(lt.name) || !isStr(lt.tagline)) return { ok: false, error: "overlays.lowerThird butuh name & tagline string" };
      outOv.lowerThird = { name: lt.name, tagline: lt.tagline };
    } else if (ov.lowerThird === null) {
      outOv.lowerThird = null;
    }
    out.overlays = outOv;
  }
  if (o.audio !== undefined && o.audio !== null) {
    if (typeof o.audio !== "object" || Array.isArray(o.audio)) return { ok: false, error: "audio harus object" };
    const au = o.audio as Record<string, unknown>;
    const outAu: NonNullable<SceneManifest["audio"]> = {};
    if ("musicUrl" in au && au.musicUrl !== undefined) {
      if (au.musicUrl !== null && !isStr(au.musicUrl)) return { ok: false, error: "audio.musicUrl harus string atau null" };
      outAu.musicUrl = au.musicUrl as string | null;
    }
    if ("hasVoiceover" in au && au.hasVoiceover !== undefined) {
      if (typeof au.hasVoiceover !== "boolean") return { ok: false, error: "audio.hasVoiceover harus boolean" };
      outAu.hasVoiceover = au.hasVoiceover;
    }
    out.audio = outAu;
  }
  if (o.subtitlePresent !== undefined) {
    if (typeof o.subtitlePresent !== "boolean") return { ok: false, error: "subtitlePresent harus boolean" };
    out.subtitlePresent = o.subtitlePresent;
  }
  if (o.maxDurationSeconds !== undefined) {
    if (!isNum(o.maxDurationSeconds) || o.maxDurationSeconds <= 0) return { ok: false, error: "maxDurationSeconds harus > 0" };
    out.maxDurationSeconds = o.maxDurationSeconds;
  }
  return { ok: true, value: out };
}

// Parse + validasi dari JSON mentah (kolom DB nanti). Invalid/absen -> null (pemanggil pakai
// flow lama = backward-compat; proyek lama tanpa manifest TIDAK berubah).
export function resolveSceneManifest(json: string | null | undefined): SceneManifest | null {
  if (!json || !json.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const res = validateSceneManifest(parsed);
  return res.ok ? res.value : null;
}

// Subset opts renderFinalVideo yg DITURUNKAN dari manifest (footage+urutan+motion+transisi+
// orientasi+teks). Design visual & audio buffer & wordTimings = runtime (dari brandKit/TTS),
// digabung di processProject nanti - BUKAN tanggung jawab manifest.
export type ManifestRenderInputs = {
  segments: Array<{ sourceUrl: string; start: number; end: number }>;
  brollClips: Array<{ videoUrl: string; durationSeconds: number }>;
  motions: MotionType[];
  transitions: TransitionType[];
  orientation: SceneOrientation;
  titleText?: string | null;
  kineticText?: string | null;
  ctaText?: string;
  lowerThird?: { name: string; tagline: string } | null;
  musicUrl?: string | null;
  maxDurationSeconds?: number;
};

// Compile manifest -> input render. allClips renderer = [segments..., broll...] (lihat
// ffmpeg.ts) jadi motions/transitions disusun dlm urutan itu. transitions = N-1 (antar
// allClips berurutan), dari transitionAfter; celah tanpa nilai -> "fade" default.
export function compileManifestToRenderInputs(manifest: SceneManifest): ManifestRenderInputs {
  const segScenes = manifest.scenes.filter((s) => s.footage.kind === "segment");
  const brollScenes = manifest.scenes.filter((s) => s.footage.kind === "broll");
  const allScenes = [...segScenes, ...brollScenes];

  const segments = segScenes.map((s) => {
    const f = s.footage as Extract<SceneFootage, { kind: "segment" }>;
    return { sourceUrl: f.sourceUrl, start: f.start, end: f.end };
  });
  const brollClips = brollScenes.map((s) => {
    const f = s.footage as Extract<SceneFootage, { kind: "broll" }>;
    return { videoUrl: f.videoUrl, durationSeconds: f.durationSeconds };
  });
  const motions = allScenes.map((s) => s.motion ?? "static");
  const transitions = allScenes.slice(0, -1).map((s) => s.transitionAfter ?? "fade");

  const inputs: ManifestRenderInputs = { segments, brollClips, motions, transitions, orientation: manifest.orientation };
  if (manifest.overlays) {
    if (manifest.overlays.titleText !== undefined) inputs.titleText = manifest.overlays.titleText;
    if (manifest.overlays.kineticText !== undefined) inputs.kineticText = manifest.overlays.kineticText;
    if (manifest.overlays.ctaText != null) inputs.ctaText = manifest.overlays.ctaText;
    if (manifest.overlays.lowerThird !== undefined) inputs.lowerThird = manifest.overlays.lowerThird;
  }
  if (manifest.audio?.musicUrl !== undefined) inputs.musicUrl = manifest.audio.musicUrl;
  if (manifest.maxDurationSeconds !== undefined) inputs.maxDurationSeconds = manifest.maxDurationSeconds;
  return inputs;
}

// Capture input render saat ini -> manifest (seed editor Fase 5). Urutan scene = segments dulu
// lalu broll (sesuai allClips renderer). id deterministik "scene-<index>".
export function buildManifestFromRenderInputs(args: {
  segments: Array<{ sourceUrl: string; start: number; end: number }>;
  brollClips?: Array<{ videoUrl: string; durationSeconds: number }>;
  motions?: MotionType[];
  transitions?: TransitionType[];
  orientation: SceneOrientation;
  overlays?: SceneManifest["overlays"];
  audio?: SceneManifest["audio"];
  subtitlePresent?: boolean;
  maxDurationSeconds?: number;
}): SceneManifest {
  const broll = args.brollClips ?? [];
  const scenes: Scene[] = [];
  const total = args.segments.length + broll.length;
  let idx = 0;
  for (const s of args.segments) {
    const scene: Scene = { id: `scene-${idx}`, footage: { kind: "segment", sourceUrl: s.sourceUrl, start: s.start, end: s.end } };
    if (args.motions?.[idx]) scene.motion = args.motions[idx];
    if (idx < total - 1 && args.transitions?.[idx]) scene.transitionAfter = args.transitions[idx];
    scenes.push(scene);
    idx++;
  }
  for (const b of broll) {
    const scene: Scene = { id: `scene-${idx}`, footage: { kind: "broll", videoUrl: b.videoUrl, durationSeconds: b.durationSeconds } };
    if (args.motions?.[idx]) scene.motion = args.motions[idx];
    if (idx < total - 1 && args.transitions?.[idx]) scene.transitionAfter = args.transitions[idx];
    scenes.push(scene);
    idx++;
  }
  const manifest: SceneManifest = { version: SCENE_MANIFEST_VERSION, orientation: args.orientation, scenes };
  if (args.overlays) manifest.overlays = args.overlays;
  if (args.audio) manifest.audio = args.audio;
  if (args.subtitlePresent !== undefined) manifest.subtitlePresent = args.subtitlePresent;
  if (args.maxDurationSeconds !== undefined) manifest.maxDurationSeconds = args.maxDurationSeconds;
  return manifest;
}

// Estimasi total durasi video dari manifest (akun overlap transisi 0.5dtk/transisi, SAMA
// aturan dgn transitions.ts) - utk editor/validasi; TIDAK mengubah aturan durasi render.
export function estimateManifestDurationSeconds(manifest: SceneManifest): number {
  const TRANSITION_OVERLAP = 0.5;
  let total = 0;
  let transitionCount = 0;
  for (const s of manifest.scenes) {
    total += s.footage.kind === "segment" ? s.footage.end - s.footage.start : s.footage.durationSeconds;
  }
  for (let i = 0; i < manifest.scenes.length - 1; i++) {
    if (manifest.scenes[i].transitionAfter) transitionCount++;
  }
  return Math.max(0, total - transitionCount * TRANSITION_OVERLAP);
}

// Kontrak VideoPlan (Tahap 4 adopsi HyperFrames, 2026-11-04).
// AI Director hanya boleh MEMILIH struktur: tipe adegan, durasi, transisi, teks pendek, dan referensi footage
// yang ADA di bank/segmen. AI tidak pernah mengirim HTML/CSS/JS, warna, font, atau URL: tampilan dirakit
// deterministik oleh builder dari Brand Kit. Validator murni (tanpa I/O, tanpa dependensi) -> mudah dites.

export const VIDEO_PLAN_VERSION = 1 as const;
export const ORIENTATIONS = ["portrait", "landscape", "square"] as const;
export const LOOKS = ["clean", "cinematic", "warm", "cool", "vivid", "mono"] as const;
export const PACINGS = ["fast", "medium", "calm"] as const;
export const MOODS = ["calm", "mysterious", "upbeat", "dramatic", "neutral", "none"] as const; // = aiDirector.MusicMood
export const TONES = ["premium", "friendly", "playful", "corporate"] as const;
export const TRANSITIONS = ["cut", "crossfade", "slide", "zoom", "whip", "flash"] as const;
export const SCENE_TYPES = ["hook", "footage-caption", "stat", "testimonial", "feature-list", "before-after", "logo-outro", "cta"] as const;

export type SceneType = (typeof SCENE_TYPES)[number];
export type Transition = (typeof TRANSITIONS)[number];
// subject = subjek VISUAL yg harus tampak di footage adegan (kata kunci naskah, mis. "makanan khas Bedugul").
// Builder hanya memakai footage yg tag/deskripsinya cocok; tak cocok -> adegan desain (revisi 2026-11-05).
type Base = { id: string; duration: number; transition: Transition; subject?: string };
export type HookScene = Base & { type: "hook"; text: string; footageRef?: string; mediaStart?: number };
export type FootageCaptionScene = Base & { type: "footage-caption"; footageRef: string; mediaStart?: number; caption?: string };
export type StatScene = Base & { type: "stat"; value: string; label: string; chart?: number[]; footageRef?: string; mediaStart?: number };
export type TestimonialScene = Base & { type: "testimonial"; quote: string; author: string; rating?: number; footageRef?: string; mediaStart?: number };
export type FeatureListScene = Base & { type: "feature-list"; title?: string; items: string[]; footageRef?: string; mediaStart?: number };
export type BeforeAfterScene = Base & { type: "before-after"; before: { label: string; footageRef: string; mediaStart?: number }; after: { label: string; footageRef: string; mediaStart?: number } };
export type LogoOutroScene = Base & { type: "logo-outro"; tagline?: string };
export type CtaScene = Base & { type: "cta"; text: string; sub?: string; footageRef?: string; mediaStart?: number };
export type Scene = HookScene | FootageCaptionScene | StatScene | TestimonialScene | FeatureListScene | BeforeAfterScene | LogoOutroScene | CtaScene;

export type VideoPlan = {
  version: typeof VIDEO_PLAN_VERSION;
  orientation: (typeof ORIENTATIONS)[number];
  look: (typeof LOOKS)[number];
  pacing: (typeof PACINGS)[number];
  music: { mood: (typeof MOODS)[number]; volume: number };
  brand: { tone: (typeof TONES)[number] };
  scenes: Scene[];
};

// Batas teks = karakter maks (+ kata maks bila relevan). Dipilih agar muat di title-safe 1080 lebar
// dengan font terbesar adegannya (lihat sceneLibrary.fitFont).
export const LIMITS = {
  scenes: { min: 3, max: 12 },
  totalSeconds: { min: 5, max: 90 },
  sceneSeconds: { min: 0.8, max: 8 },
  hookSeconds: { min: 1.2, max: 4 },
  beforeAfterMinSeconds: 2,
  musicVolumeMax: 0.3,
  mediaStartMax: 3600,
  text: {
    subject: { chars: 60, words: 8 },
    hook: { chars: 56, words: 7 }, caption: { chars: 60, words: 10 }, statValue: { chars: 16, words: 3 },
    statLabel: { chars: 40, words: 7 }, quote: { chars: 110, words: 20 }, author: { chars: 32, words: 5 },
    featureTitle: { chars: 36, words: 6 }, featureItem: { chars: 28, words: 5 }, baLabel: { chars: 18, words: 3 },
    tagline: { chars: 40, words: 7 }, ctaText: { chars: 28, words: 5 }, ctaSub: { chars: 40, words: 7 },
  },
  featureItems: { min: 2, max: 4 },
  chart: { min: 2, max: 6 },
} as const;

// Pola markup/kode yang DITOLAK di semua teks (AI tak boleh menyelipkan HTML/CSS/JS/URL).
const FORBIDDEN = /[<>{}`\\]|javascript:|data:|url\(|@import|https?:\/\/|\bon[a-z]+\s*=|&#|&[a-z]+;|<\/?script/i;

export type ValidateCtx = {
  footageIds: Iterable<string>;        // id footage bank / segmen yang boleh dirujuk
  audioDurationSeconds?: number;       // bila ada: total plan harus dekat durasi VO+hook
  maxScenes?: number;                  // dari plan/kredit (≤ LIMITS.scenes.max)
};
export type ValidateResult = { ok: true; plan: VideoPlan } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === "string" && (list as readonly string[]).includes(v);

export function validateVideoPlan(input: unknown, ctx: ValidateCtx): ValidateResult {
  const errors: string[] = [];
  const err = (path: string, code: string) => errors.push(`${path}: ${code}`);
  const footage = new Set(ctx.footageIds);

  const strict = (o: Record<string, unknown>, path: string, allowed: string[]) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) err(`${path}.${k}`, "unknown_field");
  };
  const text = (v: unknown, path: string, lim: { chars: number; words: number }, optional = false): string | undefined => {
    if (v === undefined && optional) return undefined;
    if (typeof v !== "string") { err(path, "not_string"); return; }
    const s = v.trim();
    if (!s) { err(path, "empty"); return; }
    if (FORBIDDEN.test(s)) { err(path, "markup_forbidden"); return; }
    if (/[\u0000-\u001f]/.test(s)) { err(path, "control_char"); return; }
    if (s.length > lim.chars) err(path, `too_long(${s.length}>${lim.chars})`);
    if (s.split(/\s+/).length > lim.words) err(path, `too_many_words(>${lim.words})`);
    return s;
  };
  const ref = (v: unknown, path: string, optional: boolean) => {
    if (v === undefined && optional) return;
    if (typeof v !== "string" || !v) return err(path, "footage_ref_missing");
    if (!footage.has(v)) err(path, "footage_ref_unknown");
  };
  const mediaStart = (v: unknown, path: string) => {
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > LIMITS.mediaStartMax) err(path, "bad_media_start");
  };

  if (!isObj(input)) return { ok: false, errors: ["$: not_object"] };
  strict(input, "$", ["version", "orientation", "look", "pacing", "music", "brand", "scenes"]);
  if (input.version !== VIDEO_PLAN_VERSION) err("$.version", "unsupported_version");
  if (!oneOf(ORIENTATIONS, input.orientation)) err("$.orientation", "invalid");
  if (!oneOf(LOOKS, input.look)) err("$.look", "invalid");
  if (!oneOf(PACINGS, input.pacing)) err("$.pacing", "invalid");
  if (!isObj(input.music)) err("$.music", "not_object");
  else {
    strict(input.music, "$.music", ["mood", "volume"]);
    if (!oneOf(MOODS, input.music.mood)) err("$.music.mood", "invalid");
    const vol = input.music.volume;
    if (typeof vol !== "number" || !(vol >= 0 && vol <= LIMITS.musicVolumeMax)) err("$.music.volume", "out_of_range");
  }
  if (!isObj(input.brand)) err("$.brand", "not_object");
  else {
    strict(input.brand, "$.brand", ["tone"]);
    if (!oneOf(TONES, input.brand.tone)) err("$.brand.tone", "invalid");
  }

  const scenes = input.scenes;
  if (!Array.isArray(scenes)) { err("$.scenes", "not_array"); return { ok: false, errors }; }
  const maxScenes = Math.min(LIMITS.scenes.max, ctx.maxScenes ?? LIMITS.scenes.max);
  if (scenes.length < LIMITS.scenes.min || scenes.length > maxScenes) err("$.scenes", `count(${scenes.length} not in ${LIMITS.scenes.min}..${maxScenes})`);

  const ids = new Set<string>();
  let total = 0;
  scenes.forEach((sc, i) => {
    const p = `$.scenes[${i}]`;
    if (!isObj(sc)) return err(p, "not_object");
    const t = sc.type;
    if (!oneOf(SCENE_TYPES, t)) return err(`${p}.type`, "invalid");
    if (typeof sc.id !== "string" || !/^[a-z0-9-]{1,24}$/.test(sc.id)) err(`${p}.id`, "invalid");
    else if (ids.has(sc.id)) err(`${p}.id`, "duplicate");
    else ids.add(sc.id);
    const lim = t === "hook" ? LIMITS.hookSeconds : LIMITS.sceneSeconds;
    const d = sc.duration;
    if (typeof d !== "number" || !Number.isFinite(d) || d < lim.min || d > lim.max) err(`${p}.duration`, `out_of_range(${lim.min}..${lim.max})`);
    else {
      total += d;
      if (t === "before-after" && d < LIMITS.beforeAfterMinSeconds) err(`${p}.duration`, "before_after_too_short");
    }
    if (!oneOf(TRANSITIONS, sc.transition)) err(`${p}.transition`, "invalid");
    else if (i === 0 && sc.transition !== "cut") err(`${p}.transition`, "first_scene_must_cut");
    // Urutan naratif: hook HANYA di awal; logo-outro HANYA di akhir; maksimal 1 CTA.
    if (i === 0 && t !== "hook") err(`${p}.type`, "first_scene_must_be_hook");
    if (i > 0 && t === "hook") err(`${p}.type`, "hook_only_first");
    if (t === "logo-outro" && i !== scenes.length - 1) err(`${p}.type`, "logo_outro_only_last");

    const base = ["id", "type", "duration", "transition", "subject"];
    const T = LIMITS.text;
    text(sc.subject, `${p}.subject`, T.subject, true);
    switch (t) {
      case "hook":
        strict(sc, p, [...base, "text", "footageRef", "mediaStart"]);
        text(sc.text, `${p}.text`, T.hook); ref(sc.footageRef, `${p}.footageRef`, true); mediaStart(sc.mediaStart, `${p}.mediaStart`);
        break;
      case "footage-caption":
        strict(sc, p, [...base, "footageRef", "mediaStart", "caption"]);
        ref(sc.footageRef, `${p}.footageRef`, false); mediaStart(sc.mediaStart, `${p}.mediaStart`); text(sc.caption, `${p}.caption`, T.caption, true);
        break;
      case "stat":
        strict(sc, p, [...base, "value", "label", "chart", "footageRef", "mediaStart"]);
        text(sc.value, `${p}.value`, T.statValue); text(sc.label, `${p}.label`, T.statLabel);
        ref(sc.footageRef, `${p}.footageRef`, true); mediaStart(sc.mediaStart, `${p}.mediaStart`);
        if (sc.chart !== undefined) {
          const c = sc.chart;
          if (!Array.isArray(c) || c.length < LIMITS.chart.min || c.length > LIMITS.chart.max || !c.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0)) err(`${p}.chart`, "invalid");
        }
        break;
      case "testimonial":
        strict(sc, p, [...base, "quote", "author", "rating", "footageRef", "mediaStart"]);
        text(sc.quote, `${p}.quote`, T.quote); text(sc.author, `${p}.author`, T.author);
        if (sc.rating !== undefined && !(Number.isInteger(sc.rating) && (sc.rating as number) >= 1 && (sc.rating as number) <= 5)) err(`${p}.rating`, "invalid");
        ref(sc.footageRef, `${p}.footageRef`, true); mediaStart(sc.mediaStart, `${p}.mediaStart`);
        break;
      case "feature-list":
        strict(sc, p, [...base, "title", "items", "footageRef", "mediaStart"]);
        text(sc.title, `${p}.title`, T.featureTitle, true);
        if (!Array.isArray(sc.items) || sc.items.length < LIMITS.featureItems.min || sc.items.length > LIMITS.featureItems.max) err(`${p}.items`, "count");
        else sc.items.forEach((it, j) => text(it, `${p}.items[${j}]`, T.featureItem));
        ref(sc.footageRef, `${p}.footageRef`, true); mediaStart(sc.mediaStart, `${p}.mediaStart`);
        break;
      case "before-after":
        strict(sc, p, [...base, "before", "after"]);
        for (const side of ["before", "after"] as const) {
          const s = sc[side];
          if (!isObj(s)) { err(`${p}.${side}`, "not_object"); continue; }
          strict(s, `${p}.${side}`, ["label", "footageRef", "mediaStart"]);
          text(s.label, `${p}.${side}.label`, T.baLabel); ref(s.footageRef, `${p}.${side}.footageRef`, false); mediaStart(s.mediaStart, `${p}.${side}.mediaStart`);
        }
        break;
      case "logo-outro":
        strict(sc, p, [...base, "tagline"]);
        text(sc.tagline, `${p}.tagline`, T.tagline, true);
        break;
      case "cta":
        strict(sc, p, [...base, "text", "sub", "footageRef", "mediaStart"]);
        text(sc.text, `${p}.text`, T.ctaText); text(sc.sub, `${p}.sub`, T.ctaSub, true);
        ref(sc.footageRef, `${p}.footageRef`, true); mediaStart(sc.mediaStart, `${p}.mediaStart`);
        break;
    }
  });
  if (scenes.filter((s) => isObj(s) && s.type === "cta").length > 1) err("$.scenes", "max_one_cta");
  if (scenes.length && !scenes.some((s) => isObj(s) && (s.type === "cta" || s.type === "logo-outro"))) err("$.scenes", "missing_ending(cta|logo-outro)");
  if (total && (total < LIMITS.totalSeconds.min || total > LIMITS.totalSeconds.max)) err("$.scenes", `total_out_of_range(${total.toFixed(1)}s)`);
  // Durasi plan harus dekat VO (+hook). Builder menyesuaikan cut ke VO, tapi selisih besar = AI salah baca naskah.
  if (ctx.audioDurationSeconds && total) {
    const target = ctx.audioDurationSeconds + (isObj(scenes[0]) && typeof scenes[0].duration === "number" ? scenes[0].duration : 0);
    if (Math.abs(total - target) > Math.max(2, target * 0.25)) err("$.scenes", `total_vs_audio(${total.toFixed(1)}s vs ${target.toFixed(1)}s)`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, plan: input as unknown as VideoPlan };
}

// Ringkasan skema utk prompt AI (dibangun dari konstanta di atas -> prompt & validator tak pernah selisih).
export function videoPlanPromptSpec(): string {
  const T = LIMITS.text;
  return [
    `JSON VideoPlan v${VIDEO_PLAN_VERSION}. HANYA field berikut (field lain DITOLAK). Teks polos: tanpa HTML/CSS/JS/URL/kurung kurawal.`,
    `{"version":1,"orientation":${ORIENTATIONS.join("|")},"look":${LOOKS.join("|")},"pacing":${PACINGS.join("|")},`,
    ` "music":{"mood":${MOODS.join("|")},"volume":0..${LIMITS.musicVolumeMax}},"brand":{"tone":${TONES.join("|")}},"scenes":[...]}`,
    `scene umum: {"id":"a-z0-9-","type":...,"duration":${LIMITS.sceneSeconds.min}..${LIMITS.sceneSeconds.max} (hook ${LIMITS.hookSeconds.min}..${LIMITS.hookSeconds.max}),"transition":${TRANSITIONS.join("|")}}`,
    `hook{text≤${T.hook.chars}c/${T.hook.words}kata,footageRef?} · footage-caption{footageRef,mediaStart?,caption?≤${T.caption.chars}c}`,
    `stat{value≤${T.statValue.chars}c,label≤${T.statLabel.chars}c,chart?:${LIMITS.chart.min}-${LIMITS.chart.max} angka,footageRef?} · testimonial{quote≤${T.quote.chars}c,author≤${T.author.chars}c,rating?1-5,footageRef?}`,
    `feature-list{title?≤${T.featureTitle.chars}c,items:${LIMITS.featureItems.min}-${LIMITS.featureItems.max}×≤${T.featureItem.chars}c,footageRef?} · before-after{before:{label≤${T.baLabel.chars}c,footageRef},after:{...}} (≥${LIMITS.beforeAfterMinSeconds}s)`,
    `logo-outro{tagline?≤${T.tagline.chars}c} (hanya terakhir) · cta{text≤${T.ctaText.chars}c,sub?≤${T.ctaSub.chars}c,footageRef?} (maks 1)`,
    `Aturan: ${LIMITS.scenes.min}-${LIMITS.scenes.max} adegan; adegan pertama hook dgn transition "cut"; akhiri dgn cta atau logo-outro; footageRef HARUS dari daftar footage DAN subjeknya cocok dgn isi adegan (isi subject tiap adegan; hook wajib footage yg menggambarkan isi hook, kalau tak ada yg cocok JANGAN isi footageRef -> adegan desain); total ${LIMITS.totalSeconds.min}-${LIMITS.totalSeconds.max}s ≈ durasi VO + hook.`,
  ].join("\n");
}

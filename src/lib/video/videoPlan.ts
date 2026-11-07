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
  const S = LIMITS.sceneSeconds, H = LIMITS.hookSeconds, TOT = LIMITS.totalSeconds;
  const F = LIMITS.featureItems;
  // Dibangun dari konstanta di atas -> prompt & validator tak pernah selisih.
  //
  // REVISI 2026-11-07 (pass rate 1/15 pada brief nyata). Notasi lama `hook{text<=56c}`
  // TERBACA sebagai objek bersarang, dan AI benar-benar mengirim
  // {"type":"hook","hook":{"text":...}} -> "hook: unknown_field" + "text: not_string".
  // Pola itu saja menyumbang mayoritas pelanggaran. Sekarang: contoh JSON NYATA,
  // daftar field per tipe, contoh BENAR vs SALAH, dan batas yang ditulis utuh.
  return [
    `JSON VideoPlan v${VIDEO_PLAN_VERSION}. Balas HANYA JSON. Teks polos: tanpa HTML/CSS/JS/URL/kurung kurawal.`,
    ``,
    `BENTUK WAJIB - semua field adegan DATAR, sejajar dengan "type":`,
    `{"version":${VIDEO_PLAN_VERSION},"orientation":"${ORIENTATIONS.join('|')}","look":"${LOOKS.join('|')}","pacing":"${PACINGS.join('|')}",`,
    ` "music":{"mood":"${MOODS.join('|')}","volume":0..${LIMITS.musicVolumeMax}},"brand":{"tone":"${TONES.join('|')}"},`,
    ` "scenes":[`,
    `   {"id":"hook-1","type":"hook","duration":3,"transition":"cut","text":"Cucian menumpuk lagi?","subject":"tumpukan cucian"},`,
    `   {"id":"fitur-1","type":"feature-list","duration":5,"transition":"crossfade","items":["Antar jemput gratis","Selesai dua hari"]},`,
    `   {"id":"cta-1","type":"cta","duration":3,"transition":"cut","text":"Pesan sekarang"}`,
    ` ]}`,
    ``,
    `SALAH - JANGAN bungkus isi adegan dalam objek bernama tipe. Ini DITOLAK:`,
    `   {"type":"hook","hook":{"text":"..."}}                  -> "hook" field tak dikenal, "text" hilang`,
    `   {"type":"feature-list","feature-list":{"items":[...]}}  -> "feature-list" field tak dikenal, "items" hilang`,
    `   {"type":"stat","stat":{"value":"5","label":"menit"}}    -> "stat" field tak dikenal`,
    `BENAR: {"type":"hook","text":"..."} · {"type":"feature-list","items":[...]} · {"type":"stat","value":"5","label":"menit"}`,
    ``,
    `NILAI TETAP - hanya boleh salah satu dari daftar ini, jangan mengarang:`,
    `  transition : ${TRANSITIONS.join(" | ")}   (TIDAK ADA "fade" - pakai "crossfade")`,
    `  orientation: ${ORIENTATIONS.join(" | ")} · look: ${LOOKS.join(" | ")} · pacing: ${PACINGS.join(" | ")}`,
    `  music.mood : ${MOODS.join(" | ")} · brand.tone: ${TONES.join(" | ")}`,
    ``,
    `FIELD YANG DIIZINKAN per type. Field lain APA PUN DITOLAK:`,
    `  semua adegan : id, type, duration, transition, subject(opsional)`,
    `  hook            : text(WAJIB), footageRef, mediaStart`,
    `  footage-caption : footageRef(WAJIB), caption, mediaStart`,
    `  stat            : value(WAJIB), label(WAJIB), chart, footageRef, mediaStart`,
    `  testimonial     : quote(WAJIB), author(WAJIB), rating, footageRef, mediaStart`,
    `  feature-list    : items(WAJIB), title, footageRef, mediaStart`,
    `  before-after    : before(WAJIB), after(WAJIB) - masing2 {label, footageRef, mediaStart}`,
    `  logo-outro      : tagline`,
    `  cta             : text(WAJIB), sub, footageRef, mediaStart`,
    ``,
    `BATAS TEKS - karakter DAN kata, keduanya wajib lolos:`,
    `  hook.text <=${T.hook.chars} karakter, <=${T.hook.words} kata`,
    `    BENAR "Cucian menumpuk lagi?" (20 karakter, 3 kata)`,
    `    SALAH "Apakah kamu merasa cucian di rumah terus menumpuk setiap akhir pekan?" (68 karakter, 11 kata)`,
    `  feature-list.items: ${F.min}-${F.max} item, tiap item <=${T.featureItem.chars} karakter, <=${T.featureItem.words} kata`,
    `    BENAR ["Antar jemput gratis","Selesai dua hari"]`,
    `    SALAH ["Kami menjemput cucian Anda di rumah lalu mengantarkannya kembali"] (62 karakter, 10 kata)`,
    `  footage-caption.caption <=${T.caption.chars} karakter, <=${T.caption.words} kata`,
    `  stat.value <=${T.statValue.chars} karakter/<=${T.statValue.words} kata · stat.label <=${T.statLabel.chars} karakter/<=${T.statLabel.words} kata`,
    `    BENAR {"value":"2 hari","label":"Selesai dalam"}   SALAH {"value":"hanya dua hari saja","label":"Waktu pengerjaan cucian Anda"}`,
    `  testimonial.quote <=${T.quote.chars} karakter/<=${T.quote.words} kata · testimonial.author <=${T.author.chars} karakter/<=${T.author.words} kata`,
    `  feature-list.title <=${T.featureTitle.chars} karakter/<=${T.featureTitle.words} kata · before-after label <=${T.baLabel.chars} karakter/<=${T.baLabel.words} kata`,
    `  logo-outro.tagline <=${T.tagline.chars} karakter/<=${T.tagline.words} kata · cta.text <=${T.ctaText.chars} karakter/<=${T.ctaText.words} kata · cta.sub <=${T.ctaSub.chars} karakter/<=${T.ctaSub.words} kata`,
    `  subject <=${T.subject.chars} karakter/<=${T.subject.words} kata`,
    `  HITUNG karakternya sebelum menulis. Lewat satu karakter pun DITOLAK: 29 karakter untuk batas 28 = GAGAL.`,
    `  cta.text paling ketat (${T.ctaText.chars} karakter): BENAR "Pesan sekarang" (14) · "Coba gratis" (11)`,
    `                                      SALAH "Hubungi kami sekarang juga ya" (29) · "Pesan sekarang lewat WhatsApp" (29)`,
    `  Aman: pakai 2-4 kata per item, bukan kalimat. "Antar jemput gratis" (19) aman; "Layanan antar jemput gratis se-Bali" (35) gagal.`,
    `  Kalau kalimatmu melewati batas: POTONG jadi lebih pendek, jangan dipaksa masuk.`,
    ``,
    `DURASI - dijumlahkan dan diperiksa:`,
    `  tiap adegan ${S.min}-${S.max} detik (hook ${H.min}-${H.max})`,
    `  JUMLAH semua "duration" harus masuk rentang "totalTargetDetik" di masukan, dan tetap ${TOT.min}-${TOT.max} detik.`,
    `  PAKAI "adeganDisarankan" dari masukan sebagai JUMLAH ADEGAN. Itu angka yang sudah dihitung`,
    `  dari durasi audio - bukan sekadar saran longgar, dan BUKAN batas atas yang harus dikejar.`,
    `  "adeganMaksimum" hanya pagar; mendekatinya untuk audio pendek hampir selalu membuat total kelebihan.`,
    `  Cara menghitung: bagi tengah rentang dengan jumlah adegan itu -> itulah durasi tiap adegan.`,
    `    Contoh BENAR : totalTargetDetik 11,8-15,9 & adeganDisarankan 4 -> 4 adegan x 3,5 detik = 14 detik`,
    `    Contoh SALAH : totalTargetDetik 11,8-15,9 & adeganDisarankan 4 -> 8 adegan x 3 detik = 24 detik (kelebihan)`,
    `    Contoh SALAH : totalTargetDetik 24-40 & adeganDisarankan 9 -> 4 adegan x 3 detik = 12 detik (kekurangan)`,
    ``,
    `ATURAN LAIN: ${LIMITS.scenes.min}-${LIMITS.scenes.max} adegan; adegan pertama WAJIB type "hook" dengan transition "cut"; akhiri dengan cta atau logo-outro; maksimal 1 cta; logo-outro hanya di posisi terakhir; footageRef HARUS salah satu id dari daftar footage DAN subjeknya cocok dengan isi adegan (isi "subject" tiap adegan; hook wajib footage yang menggambarkan isi hook, kalau tak ada yang cocok JANGAN isi footageRef -> jadi adegan desain).`,
  ].join("\n");
}

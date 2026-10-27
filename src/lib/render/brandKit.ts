import {
  resolveFont,
  isFontFamilyId,
  isFontWeight,
  type FontFamilyId,
  type FontWeight,
} from "./fontRegistry";
import {
  DEFAULT_SUBTITLE_DESIGN,
  type SubtitleDesign,
  type SubtitleAnimation,
} from "./subtitleDesign";
import { DEFAULT_TITLE_CARD_DESIGN, type TitleCardDesign } from "./titleCard";
import {
  isTitleAnimation,
  isTitlePosition,
  resolveTitleAnimation,
  resolveKineticPreset,
  isKineticPreset,
  DEFAULT_TITLE_POSITION,
  type TitleAnimation,
  type TitlePosition,
  type KineticPreset,
} from "./motionPresets";
import { isBrandTransitionStyle, type BrandTransitionStyle } from "./transitions";
import { DEFAULT_KINETIC_DESIGN, type KineticDesign } from "./kineticText";

// Brand Kit (2026-10-25, Phase 2). Tipografi & palet per-tenant yg DISIMPAN sbg 1 kolom
// JSON `brandKit` di tabel brands (lihat schema.ts). SEMUA field opsional - yg kosong
// jatuh ke DEFAULT_SUBTITLE_DESIGN (= tampilan brand lama, backward-compat). brandKit
// null/kosong => resolveBrandKit() balik null => renderer pakai default apa adanya (video
// existing TIDAK berubah kecuali brand set kit-nya sendiri).
export type BrandKit = {
  subtitleFont?: FontFamilyId;
  subtitleWeight?: FontWeight;
  headingFont?: FontFamilyId;
  headingWeight?: FontWeight;
  subtitleColor?: string; // #RRGGBB - warna teks subtitle
  highlightColor?: string; // #RRGGBB - warna kata yg sedang diucapkan
  outlineColor?: string; // #RRGGBB
  outlineWidth?: number; // px @ 1080
  shadow?: boolean;
  subtitleSize?: number; // px @ 1080
  position?: SubtitleDesign["position"];
  animation?: SubtitleAnimation;
  primaryColor?: string; // #RRGGBB - warna brand utama (heading/title, aksen lower third)
  secondaryColor?: string; // #RRGGBB - warna brand sekunder
  ctaColor?: string; // #RRGGBB - warna box CTA/subscribe (Fase 3); undefined = merah YouTube
  // Animated Title (2026-10-26, Fase 3 Motion Library). Opsional & DEFAULT-OFF: kalau
  // title.enabled tidak true, title card TIDAK dirender (video lama tak berubah). Teksnya
  // dari hookText (processProject.ts). Font/warna judul ikut heading font + primaryColor.
  title?: {
    enabled?: boolean;
    preset?: TitleAnimation;
    position?: TitlePosition;
    durationSeconds?: number; // 1-6 dtk tampil
  };
  // Transitions per Brand (2026-10-27, Fase 3D). style "auto"=AI Director (default lama).
  // fade/dissolve/wipe = paksa 1 tipe transisi (durasi/audio tak berubah). "cut" belum.
  transition?: { style?: BrandTransitionStyle };
  // Kinetic Typography (2026-10-27, Fase 3E) - overlay teks hook beranimasi. DEFAULT-OFF:
  // enabled!=true -> tak dirender. Teks dari hookText (processProject). Nol dampak durasi/audio.
  kineticTypography?: {
    enabled?: boolean;
    preset?: KineticPreset;
    position?: TitlePosition;
    durationSeconds?: number; // 1-6
    primaryColor?: string; // #RRGGBB
    highlightColor?: string; // #RRGGBB
  };
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const POSITIONS = ["bottom-center", "middle-center", "top-center"];
const ANIMATIONS = ["PopIn", "FadeIn", "Bounce", "None"];

// Validasi KETAT utk PATCH route - cuma key yg dikenal, tiap nilai dicek. Return objek
// bersih (hanya key valid yg dikirim) atau error string. TIDAK menerima path/string font
// arbitrer: font HARUS id family di registry (gerbang keamanan, lihat fontRegistry.ts).
export function validateBrandKit(input: unknown): { ok: true; value: BrandKit } | { ok: false; error: string } {
  if (input === null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "brandKit harus object atau null" };
  const o = input as Record<string, unknown>;
  const out: BrandKit = {};

  for (const [key, label] of [["subtitleFont", "subtitleFont"], ["headingFont", "headingFont"]] as const) {
    if (key in o && o[key] !== undefined) {
      if (!isFontFamilyId(o[key])) return { ok: false, error: `${label} tidak dikenal (harus salah satu font kurasi)` };
      out[key] = o[key] as FontFamilyId;
    }
  }
  for (const [key, label] of [["subtitleWeight", "subtitleWeight"], ["headingWeight", "headingWeight"]] as const) {
    if (key in o && o[key] !== undefined) {
      if (!isFontWeight(o[key])) return { ok: false, error: `${label} harus regular/medium/semibold/bold` };
      out[key] = o[key] as FontWeight;
    }
  }
  for (const key of ["subtitleColor", "highlightColor", "outlineColor", "primaryColor", "secondaryColor", "ctaColor"] as const) {
    if (key in o && o[key] !== undefined) {
      if (typeof o[key] !== "string" || !HEX.test(o[key] as string)) return { ok: false, error: `${key} harus warna hex #RRGGBB` };
      out[key] = o[key] as string;
    }
  }
  if ("outlineWidth" in o && o.outlineWidth !== undefined) {
    const v = Number(o.outlineWidth);
    if (!Number.isInteger(v) || v < 0 || v > 20) return { ok: false, error: "outlineWidth harus integer 0-20" };
    out.outlineWidth = v;
  }
  if ("subtitleSize" in o && o.subtitleSize !== undefined) {
    const v = Number(o.subtitleSize);
    if (!Number.isInteger(v) || v < 20 || v > 200) return { ok: false, error: "subtitleSize harus integer 20-200" };
    out.subtitleSize = v;
  }
  if ("shadow" in o && o.shadow !== undefined) {
    if (typeof o.shadow !== "boolean") return { ok: false, error: "shadow harus boolean" };
    out.shadow = o.shadow;
  }
  if ("position" in o && o.position !== undefined) {
    if (!POSITIONS.includes(o.position as string)) return { ok: false, error: "position harus bottom-center/middle-center/top-center" };
    out.position = o.position as SubtitleDesign["position"];
  }
  if ("animation" in o && o.animation !== undefined) {
    if (!ANIMATIONS.includes(o.animation as string)) return { ok: false, error: "animation harus PopIn/FadeIn/Bounce/None" };
    out.animation = o.animation as SubtitleAnimation;
  }
  // Animated Title (2026-10-26, Fase 3) - validasi ketat tiap sub-field (enum/bool/range).
  if ("title" in o && o.title !== undefined && o.title !== null) {
    if (typeof o.title !== "object" || Array.isArray(o.title)) return { ok: false, error: "title harus object" };
    const t = o.title as Record<string, unknown>;
    const ot: NonNullable<BrandKit["title"]> = {};
    if ("enabled" in t && t.enabled !== undefined) {
      if (typeof t.enabled !== "boolean") return { ok: false, error: "title.enabled harus boolean" };
      ot.enabled = t.enabled;
    }
    if ("preset" in t && t.preset !== undefined) {
      if (!isTitleAnimation(t.preset)) return { ok: false, error: "title.preset harus FadePop/ZoomIn/PopBounce" };
      ot.preset = t.preset as TitleAnimation;
    }
    if ("position" in t && t.position !== undefined) {
      if (!isTitlePosition(t.position)) return { ok: false, error: "title.position harus top-center/middle-center/bottom-center" };
      ot.position = t.position as TitlePosition;
    }
    if ("durationSeconds" in t && t.durationSeconds !== undefined) {
      const v = Number(t.durationSeconds);
      if (!Number.isFinite(v) || v < 1 || v > 6) return { ok: false, error: "title.durationSeconds harus 1-6" };
      ot.durationSeconds = v;
    }
    out.title = ot;
  }
  // Transitions per Brand (2026-10-27, Fase 3D) - validasi enum style.
  if ("transition" in o && o.transition !== undefined && o.transition !== null) {
    if (typeof o.transition !== "object" || Array.isArray(o.transition)) return { ok: false, error: "transition harus object" };
    const tr = o.transition as Record<string, unknown>;
    if ("style" in tr && tr.style !== undefined) {
      if (!isBrandTransitionStyle(tr.style)) return { ok: false, error: "transition.style harus auto/fade/dissolve/wipe" };
      out.transition = { style: tr.style as BrandTransitionStyle };
    }
  }
  // Kinetic Typography (2026-10-27, Fase 3E) - validasi ketat tiap sub-field.
  if ("kineticTypography" in o && o.kineticTypography !== undefined && o.kineticTypography !== null) {
    if (typeof o.kineticTypography !== "object" || Array.isArray(o.kineticTypography)) return { ok: false, error: "kineticTypography harus object" };
    const k = o.kineticTypography as Record<string, unknown>;
    const ok2: NonNullable<BrandKit["kineticTypography"]> = {};
    if ("enabled" in k && k.enabled !== undefined) {
      if (typeof k.enabled !== "boolean") return { ok: false, error: "kineticTypography.enabled harus boolean" };
      ok2.enabled = k.enabled;
    }
    if ("preset" in k && k.preset !== undefined) {
      if (!isKineticPreset(k.preset)) return { ok: false, error: "kineticTypography.preset harus FadeIn/SlideUp/Pop/WordByWord/HighlightKeyword" };
      ok2.preset = k.preset as KineticPreset;
    }
    if ("position" in k && k.position !== undefined) {
      if (!isTitlePosition(k.position)) return { ok: false, error: "kineticTypography.position harus top-center/middle-center/bottom-center" };
      ok2.position = k.position as TitlePosition;
    }
    if ("durationSeconds" in k && k.durationSeconds !== undefined) {
      const v = Number(k.durationSeconds);
      if (!Number.isFinite(v) || v < 1 || v > 6) return { ok: false, error: "kineticTypography.durationSeconds harus 1-6" };
      ok2.durationSeconds = v;
    }
    for (const key of ["primaryColor", "highlightColor"] as const) {
      if (key in k && k[key] !== undefined) {
        if (typeof k[key] !== "string" || !HEX.test(k[key] as string)) return { ok: false, error: `kineticTypography.${key} harus warna hex #RRGGBB` };
        ok2[key] = k[key] as string;
      }
    }
    out.kineticTypography = ok2;
  }
  return { ok: true, value: out };
}

export type ResolvedBrandKit = {
  subtitleDesign: SubtitleDesign;
  titleCardDesign: TitleCardDesign;
  headingFontFile: string; // path absolut utk drawtext fontfile=
  usedFallbacks: string[]; // non-kosong = ada font yg disubstitusi (WAJIB di-log)
  // Animated Title (Fase 3). titleEnabled=false => renderer TIDAK render title card
  // (default-off, backward-compat). Posisi/durasi dipakai saat enabled.
  titleEnabled: boolean;
  titlePosition: TitlePosition;
  titleDurationSeconds: number;
  // Lower Third (Fase 3) - warna aksen bar = primaryColor brand (undefined -> putih lama).
  lowerThirdAccentColor?: string;
  // CTA (Fase 3) - warna box subscribe/follow = ctaColor brand (undefined -> merah lama).
  ctaButtonColor?: string;
  // Transitions per Brand (Fase 3D) - "auto" (default) = AI Director; fade/dissolve/wipe
  // = paksa 1 tipe. Dipakai processProject utk override directorDecision.transitions.
  transitionStyle: BrandTransitionStyle;
  // Kinetic Typography (Fase 3E). kineticEnabled=false => tak render (default-off).
  kineticEnabled: boolean;
  kineticDesign: KineticDesign;
  kineticPosition: TitlePosition;
  kineticDurationSeconds: number;
};

// Dipakai renderer (processProject). json = kolom brands.brandKit mentah. null/kosong/
// parse-gagal => null (pemanggil pakai DEFAULT - video existing tak berubah). Nilai yg
// invalid di DB (seharusnya tak terjadi krn divalidasi saat simpan) di-abaikan per-field
// via ?? default, jadi tetap aman.
export function resolveBrandKit(json: string | null | undefined): ResolvedBrandKit | null {
  if (!json || !json.trim()) return null;
  let bk: BrandKit;
  try {
    bk = JSON.parse(json) as BrandKit;
  } catch {
    return null;
  }
  const sub = resolveFont(bk.subtitleFont, bk.subtitleWeight);
  const heading = resolveFont(bk.headingFont, bk.headingWeight);

  const subtitleDesign: SubtitleDesign = {
    font: sub.assName,
    bold: sub.assBold === -1,
    size: bk.subtitleSize ?? DEFAULT_SUBTITLE_DESIGN.size,
    color: bk.subtitleColor ?? DEFAULT_SUBTITLE_DESIGN.color,
    outline: bk.outlineColor ?? DEFAULT_SUBTITLE_DESIGN.outline,
    outlineWidth: bk.outlineWidth ?? DEFAULT_SUBTITLE_DESIGN.outlineWidth,
    shadow: bk.shadow ?? DEFAULT_SUBTITLE_DESIGN.shadow,
    highlightColor: bk.highlightColor ?? DEFAULT_SUBTITLE_DESIGN.highlightColor,
    animation: bk.animation ?? DEFAULT_SUBTITLE_DESIGN.animation,
    position: bk.position ?? DEFAULT_SUBTITLE_DESIGN.position,
    maxLines: DEFAULT_SUBTITLE_DESIGN.maxLines,
  };

  const titleAnim = resolveTitleAnimation(bk.title?.preset);
  const titleCardDesign: TitleCardDesign = {
    ...DEFAULT_TITLE_CARD_DESIGN,
    font: heading.assName,
    color: bk.primaryColor ?? DEFAULT_TITLE_CARD_DESIGN.color,
    outline: bk.outlineColor ?? DEFAULT_TITLE_CARD_DESIGN.outline,
    animation: titleAnim.animation,
  };

  const usedFallbacks: string[] = [];
  if (sub.usedFallback) usedFallbacks.push(`subtitle font (${String(bk.subtitleFont)}/${String(bk.subtitleWeight)} -> ${sub.family}/${sub.weight})`);
  if (heading.usedFallback) usedFallbacks.push(`heading font (${String(bk.headingFont)}/${String(bk.headingWeight)} -> ${heading.family}/${heading.weight})`);
  if (titleAnim.usedFallback) usedFallbacks.push(`title preset (${String(bk.title?.preset)} -> ${titleAnim.animation})`);

  return {
    subtitleDesign,
    titleCardDesign,
    headingFontFile: heading.fileAbsolute,
    usedFallbacks,
    titleEnabled: bk.title?.enabled === true,
    titlePosition: isTitlePosition(bk.title?.position) ? (bk.title!.position as TitlePosition) : DEFAULT_TITLE_POSITION,
    titleDurationSeconds: typeof bk.title?.durationSeconds === "number" ? bk.title.durationSeconds : 2.5,
    lowerThirdAccentColor: bk.primaryColor,
    ctaButtonColor: bk.ctaColor,
    transitionStyle: isBrandTransitionStyle(bk.transition?.style) ? (bk.transition!.style as BrandTransitionStyle) : "auto",
    kineticEnabled: bk.kineticTypography?.enabled === true,
    kineticDesign: {
      ...DEFAULT_KINETIC_DESIGN,
      font: heading.assName,
      color: bk.kineticTypography?.primaryColor ?? bk.primaryColor ?? DEFAULT_KINETIC_DESIGN.color,
      highlightColor: bk.kineticTypography?.highlightColor ?? bk.highlightColor ?? DEFAULT_KINETIC_DESIGN.highlightColor,
      outline: bk.outlineColor ?? DEFAULT_KINETIC_DESIGN.outline,
      preset: resolveKineticPreset(bk.kineticTypography?.preset).preset,
    },
    kineticPosition: isTitlePosition(bk.kineticTypography?.position) ? (bk.kineticTypography!.position as TitlePosition) : DEFAULT_TITLE_POSITION,
    kineticDurationSeconds: typeof bk.kineticTypography?.durationSeconds === "number" ? bk.kineticTypography.durationSeconds : 2.5,
  };
}

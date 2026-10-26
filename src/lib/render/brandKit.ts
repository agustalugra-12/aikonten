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
  primaryColor?: string; // #RRGGBB - warna brand utama (heading/title, aksen)
  secondaryColor?: string; // #RRGGBB - warna brand sekunder
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
  for (const key of ["subtitleColor", "highlightColor", "outlineColor", "primaryColor", "secondaryColor"] as const) {
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
  return { ok: true, value: out };
}

export type ResolvedBrandKit = {
  subtitleDesign: SubtitleDesign;
  titleCardDesign: TitleCardDesign;
  headingFontFile: string; // path absolut utk drawtext fontfile=
  usedFallbacks: string[]; // non-kosong = ada font yg disubstitusi (WAJIB di-log)
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

  const titleCardDesign: TitleCardDesign = {
    ...DEFAULT_TITLE_CARD_DESIGN,
    font: heading.assName,
    color: bk.primaryColor ?? DEFAULT_TITLE_CARD_DESIGN.color,
    outline: bk.outlineColor ?? DEFAULT_TITLE_CARD_DESIGN.outline,
  };

  const usedFallbacks: string[] = [];
  if (sub.usedFallback) usedFallbacks.push(`subtitle font (${String(bk.subtitleFont)}/${String(bk.subtitleWeight)} -> ${sub.family}/${sub.weight})`);
  if (heading.usedFallback) usedFallbacks.push(`heading font (${String(bk.headingFont)}/${String(bk.headingWeight)} -> ${heading.family}/${heading.weight})`);

  return { subtitleDesign, titleCardDesign, headingFontFile: heading.fileAbsolute, usedFallbacks };
}

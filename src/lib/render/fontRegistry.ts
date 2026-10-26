import path from "path";

// Font Registry (2026-10-25, Phase 2 Font Studio & Brand Kit). SATU sumber kebenaran utk
// SEMUA font yg boleh dipakai render - kurasi KECIL yg di-BUNDLE di repo
// (src/lib/render/assets/fonts), BUKAN download font sembarang saat render & BUKAN path
// dari input user. INI gerbang keamanan: brandKit cuma menyimpan FONT FAMILY ID (enum di
// bawah), resolver di sini yg memetakan ke file .ttf nyata - input user TIDAK PERNAH jadi
// path file langsung (cegah path traversal / font arbitrer). Font di-resolve libass lewat
// fontconfig+fontsdir (assName) utk subtitle/title (lihat ffmpeg.ts) & lewat fontfile
// absolut (fileAbsolute) utk drawtext overlay.
//
// Lisensi (semua kompatibel SaaS komersial, file lisensi disertakan per-folder):
//   Poppins, Bebas Neue, Anton, Archivo Black, DM Serif Display, Pacifico = SIL OFL 1.1.
// Semua file STATIC (bukan variable font) supaya pemilihan weight pasti & konsisten di
// libass (assName) MAUPUN freetype/drawtext (file spesifik per weight).

export const FONT_FAMILY_IDS = [
  "poppins",
  "bebasneue",
  "anton",
  "archivoblack",
  "dmserifdisplay",
  "pacifico",
] as const;
export type FontFamilyId = (typeof FONT_FAMILY_IDS)[number];

export const FONT_WEIGHTS = ["regular", "medium", "semibold", "bold"] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

// assName = nama family yg dikenal fontconfig (dicek via fc-query saat bundling).
// assBold = flag Bold di Style ASS (-1 true / 0 false) - dipakai HANYA utk weight yg tidak
// punya family terpisah sendiri (mis. Poppins Bold family-nya tetap "Poppins", bedanya di
// flag bold). file = relatif thd folder assets/fonts.
export type FontVariant = { file: string; assName: string; assBold: 0 | -1 };

type FamilyEntry = { label: string; category: "sans" | "display" | "serif" | "script"; weights: Partial<Record<FontWeight, FontVariant>> };

export const FONT_REGISTRY: Record<FontFamilyId, FamilyEntry> = {
  poppins: {
    label: "Poppins",
    category: "sans",
    weights: {
      regular: { file: "poppins/Poppins-Regular.ttf", assName: "Poppins", assBold: 0 },
      medium: { file: "poppins/Poppins-Medium.ttf", assName: "Poppins Medium", assBold: 0 },
      semibold: { file: "poppins/Poppins-SemiBold.ttf", assName: "Poppins SemiBold", assBold: 0 },
      bold: { file: "poppins/Poppins-Bold.ttf", assName: "Poppins", assBold: -1 },
    },
  },
  bebasneue: {
    label: "Bebas Neue",
    category: "display",
    weights: { regular: { file: "bebasneue/BebasNeue-Regular.ttf", assName: "Bebas Neue", assBold: 0 } },
  },
  anton: {
    label: "Anton",
    category: "display",
    weights: { regular: { file: "anton/Anton-Regular.ttf", assName: "Anton", assBold: 0 } },
  },
  archivoblack: {
    label: "Archivo Black",
    category: "display",
    weights: { regular: { file: "archivoblack/ArchivoBlack-Regular.ttf", assName: "Archivo Black", assBold: 0 } },
  },
  dmserifdisplay: {
    label: "DM Serif Display",
    category: "serif",
    weights: { regular: { file: "dmserifdisplay/DMSerifDisplay-Regular.ttf", assName: "DM Serif Display", assBold: 0 } },
  },
  pacifico: {
    label: "Pacifico",
    category: "script",
    weights: { regular: { file: "pacifico/Pacifico-Regular.ttf", assName: "Pacifico", assBold: 0 } },
  },
};

// Default = Poppins SemiBold - SAMA PERSIS dgn DEFAULT_SUBTITLE_DESIGN lama (backward-compat:
// brand tanpa Brand Kit tetap tampil identik).
export const DEFAULT_FONT_FAMILY: FontFamilyId = "poppins";
export const DEFAULT_FONT_WEIGHT: FontWeight = "semibold";

export function fontsBaseDir(): string {
  // process.cwd() (BUKAN __dirname) - lihat alasan di lottieOverlay.ts (Turbopack).
  return path.join(process.cwd(), "src/lib/render/assets/fonts");
}

export function isFontFamilyId(v: unknown): v is FontFamilyId {
  return typeof v === "string" && (FONT_FAMILY_IDS as readonly string[]).includes(v);
}
export function isFontWeight(v: unknown): v is FontWeight {
  return typeof v === "string" && (FONT_WEIGHTS as readonly string[]).includes(v);
}

export type ResolvedFont = FontVariant & { family: FontFamilyId; weight: FontWeight; fileAbsolute: string; usedFallback: boolean };

// Resolve (family, weight) -> variant nyata. TIDAK PERNAH lempar: family/weight invalid
// jatuh ke default yg pasti ada, dgn usedFallback=true supaya pemanggil bisa LOG (syarat
// "font fallback is detectable" - substitusi tidak boleh diam2 spt bug Poppins Phase 1).
export function resolveFont(family: unknown, weight: unknown): ResolvedFont {
  let usedFallback = false;
  let fam: FontFamilyId;
  if (isFontFamilyId(family)) {
    fam = family;
  } else {
    fam = DEFAULT_FONT_FAMILY;
    if (family !== undefined && family !== null) usedFallback = true;
  }
  const entry = FONT_REGISTRY[fam];
  let wt: FontWeight;
  if (isFontWeight(weight) && entry.weights[weight]) {
    wt = weight;
  } else {
    // weight diminta tapi family ini tak punya -> pakai weight pertama yg tersedia.
    if (weight !== undefined && weight !== null && !(isFontWeight(weight) && entry.weights[weight])) usedFallback = true;
    wt = (FONT_WEIGHTS.find((w) => entry.weights[w]) ?? "regular") as FontWeight;
  }
  const variant = entry.weights[wt]!;
  return { ...variant, family: fam, weight: wt, fileAbsolute: path.join(fontsBaseDir(), variant.file), usedFallback };
}

// Opsi utk UI (dropdown) - family + weight yg tersedia.
export function fontCatalog(): { id: FontFamilyId; label: string; category: string; weights: FontWeight[] }[] {
  return FONT_FAMILY_IDS.map((id) => ({
    id,
    label: FONT_REGISTRY[id].label,
    category: FONT_REGISTRY[id].category,
    weights: FONT_WEIGHTS.filter((w) => FONT_REGISTRY[id].weights[w]),
  }));
}

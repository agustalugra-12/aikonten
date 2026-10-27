// Motion Library - registry preset reusable (2026-10-26, Fase 3). SATU sumber definisi
// animasi, pola SAMA dgn SUBTITLE_ANIMATION_PRESETS (subtitleDesign.ts): tiap preset =
// fungsi murni yg mengembalikan fragmen ASS/filter - gampang diuji tanpa render & aman
// (tak ada string filter mentah dari user; brandKit cuma simpan ID enum, di-resolve di
// sini). Fase 3 dimulai dari TITLE_ANIMATIONS (Animated Title). Kategori lain (lower
// third, CTA, transisi, dst) menyusul dgn pola yg sama.

// ---------- Title Animations ----------
// Semua preset: tag override ASS inline utk 1 event title card (lihat titleCard.ts).
// Coordinate-free (hanya \fad + transform skala) supaya aman di posisi mana pun (\an
// diisi pemanggil sesuai posisi) & tidak bergantung ukuran frame. Durasi dalam ms.
export const TITLE_ANIMATION_IDS = ["FadePop", "ZoomIn", "PopBounce"] as const;
export type TitleAnimation = (typeof TITLE_ANIMATION_IDS)[number];
export const DEFAULT_TITLE_ANIMATION: TitleAnimation = "FadePop";

export function isTitleAnimation(v: unknown): v is TitleAnimation {
  return typeof v === "string" && (TITLE_ANIMATION_IDS as readonly string[]).includes(v);
}

type TitleAnimCtx = { an: number };

export const TITLE_ANIMATIONS: Record<TitleAnimation, (ctx: TitleAnimCtx) => string> = {
  // Fase 1 (dipertahankan PERSIS sbg default): fade in/out + pop skala 60%->100% dlm 250ms.
  FadePop: ({ an }) => `{\\an${an}\\fad(300,300)\\fscx60\\fscy60\\t(0,250,\\fscx100\\fscy100)}`,
  // Zoom lebih dramatis: 35%->100% dlm 350ms.
  ZoomIn: ({ an }) => `{\\an${an}\\fad(250,300)\\fscx35\\fscy35\\t(0,350,\\fscx100\\fscy100)}`,
  // Overshoot "bounce": 50%->112%->100% (lebih berenergi).
  PopBounce: ({ an }) =>
    `{\\an${an}\\fad(250,250)\\fscx50\\fscy50\\t(0,160,\\fscx112\\fscy112)\\t(160,300,\\fscx100\\fscy100)}`,
};

// Posisi title -> alignment ASS numpad (atas 8 / tengah 5 / bawah 2, kolom tengah).
export const TITLE_POSITIONS = ["top-center", "middle-center", "bottom-center"] as const;
export type TitlePosition = (typeof TITLE_POSITIONS)[number];
export const DEFAULT_TITLE_POSITION: TitlePosition = "middle-center";

export function isTitlePosition(v: unknown): v is TitlePosition {
  return typeof v === "string" && (TITLE_POSITIONS as readonly string[]).includes(v);
}

export function titleAlignment(position: TitlePosition): number {
  if (position === "top-center") return 8;
  if (position === "bottom-center") return 2;
  return 5; // middle-center
}

// Resolve preset title (fallback aman ke default kalau ID tak dikenal - pola resolveFont).
export function resolveTitleAnimation(id: unknown): { animation: TitleAnimation; usedFallback: boolean } {
  if (isTitleAnimation(id)) return { animation: id, usedFallback: false };
  return { animation: DEFAULT_TITLE_ANIMATION, usedFallback: id !== undefined && id !== null };
}

// ---------- Kinetic Typography (2026-10-27, Fase 3E) ----------
// Preset teks kinetik utk hook/judul promosi (lihat kineticText.ts). Reuse posisi (\an)
// & pola fallback yg sama. FadeIn/SlideUp/Pop = animasi masuk SELURUH teks; WordByWord =
// kata muncul bertahap (timing RATA sepanjang durasi, bukan Whisper -> nol dampak audio);
// HighlightKeyword = kata kunci (terpanjang) diberi warna highlight. Perilaku detail ada
// di buildKineticTextAss - di sini cuma enum + resolver (gerbang: brand simpan ID enum).
export const KINETIC_PRESET_IDS = ["FadeIn", "SlideUp", "Pop", "WordByWord", "HighlightKeyword"] as const;
export type KineticPreset = (typeof KINETIC_PRESET_IDS)[number];
export const DEFAULT_KINETIC_PRESET: KineticPreset = "FadeIn";

export function isKineticPreset(v: unknown): v is KineticPreset {
  return typeof v === "string" && (KINETIC_PRESET_IDS as readonly string[]).includes(v);
}

export function resolveKineticPreset(id: unknown): { preset: KineticPreset; usedFallback: boolean } {
  if (isKineticPreset(id)) return { preset: id, usedFallback: false };
  return { preset: DEFAULT_KINETIC_PRESET, usedFallback: id !== undefined && id !== null };
}

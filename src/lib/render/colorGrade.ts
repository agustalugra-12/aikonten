// Color Grading (2026-08-10, permintaan Agus - preset editing "AI EDITING PRESET v2"
// utk Animal Story & Co, "Netflix Wildlife compressed into 30 seconds") - filter FFmpeg
// NATIVE semua (eq/unsharp/vignette/colortemperature, dicek langsung `ffmpeg -filters`
// SEBELUM dipakai - bukan asumsi), BUKAN keputusan AI per-scene (grading FIXED per
// preset, spt "LUT" konsisten - proporsional, beda dari motion/transisi yg memang
// perlu variasi per klip). Spec asli minta Highlights/Shadows terpisah - `eq` filter
// FFmpeg TIDAK punya parameter highlights/shadows terpisah (cuma brightness/contrast/
// saturation/gamma) - disederhanakan jadi contrast (mendekati efek gabungan highlight
// naik+shadow turun) + brightness kecil, BUKAN tiruan sempurna color-grading software
// profesional (DaVinci dst) - cukup utk nuansa "premium" yg diminta, proporsional utk
// ffmpeg native drpd bangun color-grading engine sendiri.
export type ColorGradeConfig = {
  contrast: number; // 1.0 = netral
  saturation: number; // 1.0 = netral
  brightness: number; // 0.0 = netral, range praktis -1..1
  sharpenAmount: number; // 0 = tidak ada, ~0.5-1.5 wajar
  vignette: boolean;
  temperatureKelvin: number | null; // null = tidak diubah, mis. 6700 = sedikit hangat
};

export function buildColorGradeFilter(config: ColorGradeConfig): string {
  const parts: string[] = [
    `eq=contrast=${config.contrast}:saturation=${config.saturation}:brightness=${config.brightness}`,
  ];
  if (config.sharpenAmount > 0) {
    parts.push(`unsharp=5:5:${config.sharpenAmount}`);
  }
  if (config.vignette) {
    parts.push("vignette=PI/5");
  }
  if (config.temperatureKelvin !== null) {
    parts.push(`colortemperature=temperature=${config.temperatureKelvin}`);
  }
  return parts.join(",");
}

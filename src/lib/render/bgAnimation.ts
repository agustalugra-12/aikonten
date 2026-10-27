import type { BgAnimation } from "./motionPresets";

// Background Animation (2026-10-27, Fase 3F). Efek latar RINGAN di seluruh frame, di-apply
// sbg stage filter PALING AWAL (atas footage, DI BAWAH subtitle/title/overlay) di graph
// filter_complex yg SUDAH ada - TANPA input/proses/video-perantara baru & TANPA mengubah
// durasi/audio/subtitle. Smoke terukur: Gradient ~325MB, Ambient ~294MB peak (VPS 4GB OK).
//
// Slow Zoom & Pan SENGAJA TIDAK di sini - sudah disediakan camera motion AI Director
// (cameraMotion.ts/imageToClip.ts). Reimplement = duplikasi + gerak-ganda.

export type BgDesign = {
  preset: BgAnimation;
  primaryColor: string; // #RRGGBB
  secondaryColor: string; // #RRGGBB
  intensity: number; // 0-100
  durationSeconds: number; // periode siklus animasi (dtk)
};

export const DEFAULT_BG_DESIGN: BgDesign = {
  preset: "None",
  primaryColor: "#14213D",
  secondaryColor: "#FFD84D",
  intensity: 50,
  durationSeconds: 6,
};

// #RRGGBB (tervalidasi di hulu) -> 0xRRGGBB utk ffmpeg; non-hex -> fallback aman.
function toFfColor(hex: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `0x${hex.slice(1)}` : fallback;
}
function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Bangun stage filter utk preset BG. Return array string stage ("[in]filter[out]" dll) -
// KOSONG utk None (caller lewati). curLabel = label stream masuk, outLabel = keluar.
// videoDurationSeconds dipakai supaya sumber Gradient menutup seluruh durasi video.
export function buildBackgroundStages(
  design: BgDesign,
  frameWidth: number,
  frameHeight: number,
  videoDurationSeconds: number,
  curLabel: string,
  outLabel: string
): string[] {
  const intensity = clampNum(Number(design.intensity) || 0, 0, 100);
  const period = clampNum(Number(design.durationSeconds) || 6, 2, 20);

  switch (design.preset) {
    case "Ambient": {
      // Hue bergoyang HALUS (shimmer warna) - 1 filter, nyaris gratis, tak ubah durasi.
      // Amplitudo 2..14 derajat sesuai intensity. `t` mentah (fase absolut tak terlihat).
      const amp = (2 + (intensity / 100) * 12).toFixed(2);
      return [`[${curLabel}]hue=h='${amp}*sin(2*PI*t/${period})'[${outLabel}]`];
    }
    case "Gradient": {
      // Overlay gradasi warna brand (primary->secondary) ber-alpha rendah, berotasi perlahan.
      // gradients = SOURCE filter (tak perlu -i), d = durasi video supaya menutup penuh.
      const c0 = toFfColor(design.primaryColor, "0x14213D");
      const c1 = toFfColor(design.secondaryColor, "0xFFD84D");
      const alpha = (0.08 + (intensity / 100) * 0.32).toFixed(3); // 0.08..0.40
      const speed = (0.008 + (intensity / 100) * 0.03).toFixed(4); // lambat (range sah 1e-5..1)
      const dur = Math.ceil(videoDurationSeconds + 1); // margin biar tak kehabisan frame
      return [
        `gradients=s=${frameWidth}x${frameHeight}:c0=${c0}:c1=${c1}:speed=${speed}:d=${dur}:type=linear,format=yuva420p,colorchannelmixer=aa=${alpha}[bgsrc]`,
        `[${curLabel}][bgsrc]overlay=0:0:format=auto[${outLabel}]`,
      ];
    }
    case "None":
    default:
      return [];
  }
}

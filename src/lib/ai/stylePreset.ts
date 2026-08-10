import type { MotionType } from "@/lib/render/cameraMotion";
import type { TransitionType } from "@/lib/render/transitions";
import type { ColorGradeConfig } from "@/lib/render/colorGrade";

// AI Style Preset (2026-08-10, PRD "AI Content Editing Engine" Roadmap V3) - SEBELUM
// ini, mapEnergyToMotion/mapEnergyToTransition (aiDirector.ts) SELALU pakai 1 pool
// pilihan yg sama (motion/transisi cepat+dramatis, progress bar+sticker selalu aktif) -
// cocok utk niche cepat gaya TikTok/Shorts, TAPI brand dokumenter/edukasi/homestay yg
// mau nuansa lebih tenang terpaksa dapat gaya yg sama juga. 3 preset di sini BUKAN
// bikin ulang motion/transisi/overlay dari nol - reuse SEMUA yg sudah ada (MotionType/
// TransitionType/overlay flags), cuma beda KOMBINASI mana yg dipakai & seberapa sering
// elemen dekoratif (progress bar/sticker) muncul.
export type StylePreset = "energetic" | "documentary" | "minimal";
export const ALL_STYLE_PRESETS: StylePreset[] = ["energetic", "documentary", "minimal"];

export type StylePresetConfig = {
  // Motion per level energi ("peak"/"build"/"resolve"/"calm", sama key persis dgn
  // energyLevels di aiDirector.ts) - 2 pilihan per level (indeks genap/ganjil) utk
  // variasi, SAMA pola dgn i%2 yg sudah dipakai mapEnergyToMotion sebelum preset ada.
  motionsByEnergy: Record<string, [MotionType, MotionType]>;
  // Transisi "naik"-ke-peak, "naik" biasa, & "turun/sama" - 2 pilihan tiap kategori,
  // SAMA struktur dgn mapEnergyToTransition sebelum preset ada.
  transitionsRisingToPeak: [TransitionType, TransitionType];
  transitionsRising: [TransitionType, TransitionType];
  transitionsFalling: [TransitionType, TransitionType];
  showProgressBar: boolean;
  allowSticker: boolean;
  // Intensity gerakan kamera (2026-08-10, lihat cameraMotion.ts) - 1.0 = penuh
  // (perilaku lama), <1 = zoom/pan berhenti di tengah jalan, terasa lebih halus/lambat.
  motionIntensity: number;
  // Color Grading (2026-08-10, lihat colorGrade.ts) - null = TIDAK ada grading sama
  // sekali (footage apa adanya, perilaku lama).
  colorGrade: ColorGradeConfig | null;
};

const STYLE_PRESET_CONFIGS: Record<StylePreset, StylePresetConfig> = {
  // Default LAMA (2026-08-10, sebelum preset ada) - dipertahankan APA ADANYA persis di
  // sini spy brand yg sudah jalan tidak berubah tampilannya (default kolom DB jg
  // "energetic", lihat schema.ts) - motion/transisi cepat & tegas, progress bar+sticker
  // aktif, cocok Shorts/TikTok/Reels ritme cepat.
  energetic: {
    motionsByEnergy: {
      peak: ["zoom-in", "pan-left"],
      build: ["pan-right", "pan-left"],
      resolve: ["zoom-out", "zoom-out"],
      calm: ["static", "zoom-in"],
    },
    transitionsRisingToPeak: ["zoomin", "fadewhite"],
    transitionsRising: ["slideleft", "hblur"],
    transitionsFalling: ["fade", "coverleft"],
    showProgressBar: true,
    allowSticker: true,
    motionIntensity: 1.0,
    colorGrade: null,
  },
  // Dokumenter/edukasi (2026-08-10, DIPERBARUI sesuai preset "AI EDITING PRESET v2"
  // Animal Story & Co - "Netflix Wildlife compressed into 30 seconds") - motion LEBIH
  // LAMBAT/halus (pan drpd zoom yg terasa "kaget", DITAMBAH motionIntensity 0.55 -
  // gerakan tetap ADA tiap klip [spec: "Never allow static visuals"], TAPI jangkauannya
  // dipersingkat spy terasa subtle bukan agresif), transisi fade-family + 1 "whip"
  // (hlwind) di momen puncak (spec izinkan "Whip" sbg salah satu transisi resmi, TIDAK
  // PERNAH flash/blur-gimmick lain yg terasa "murah" utk nuansa dokumenter), TANPA
  // progress bar/sticker (elemen dekoratif gaya Shorts, mengganggu nuansa serius/
  // informatif), + color grade premium (kontras naik, saturasi sedikit naik, sedikit
  // vignette, warna sedikit hangat - lihat colorGrade.ts).
  documentary: {
    motionsByEnergy: {
      peak: ["pan-left", "pan-right"],
      build: ["pan-right", "static"],
      resolve: ["zoom-out", "static"],
      calm: ["static", "static"],
    },
    transitionsRisingToPeak: ["fade", "hlwind"],
    transitionsRising: ["fade", "fade"],
    transitionsFalling: ["fade", "fade"],
    showProgressBar: false,
    allowSticker: false,
    motionIntensity: 0.55,
    colorGrade: {
      contrast: 1.1,
      saturation: 1.04,
      brightness: 0.02,
      sharpenAmount: 0.8,
      vignette: true,
      temperatureKelvin: 6700,
    },
  },
  // Minimal (2026-08-10) - SEPALING RESTRAINED: motion nyaris statis (cuma zoom-in
  // pelan di "peak" spy tidak 100% diam), transisi cuma "fade" polos (satu2nya
  // transisi yg TIDAK PERNAH terasa "efek", murni potongan halus), tanpa progress
  // bar/sticker - cocok brand yg mau kesan bersih/premium, bukan energik.
  minimal: {
    motionsByEnergy: {
      peak: ["zoom-in", "static"],
      build: ["static", "static"],
      resolve: ["static", "static"],
      calm: ["static", "static"],
    },
    transitionsRisingToPeak: ["fade", "fade"],
    transitionsRising: ["fade", "fade"],
    transitionsFalling: ["fade", "fade"],
    showProgressBar: false,
    allowSticker: false,
    motionIntensity: 0.4,
    colorGrade: null, // sengaja TANPA grading - "minimal" identitasnya justru footage apa adanya, beda dari "documentary" yg eksplisit minta look premium
  },
};

export function getStylePresetConfig(preset: string | null | undefined): StylePresetConfig {
  return STYLE_PRESET_CONFIGS[(preset as StylePreset) || "energetic"] || STYLE_PRESET_CONFIGS.energetic;
}

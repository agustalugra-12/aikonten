// Camera Motion / Ken Burns (2026-08-10, PRD "AI Content Editing Engine" - AI Director
// modul 1) - pipeline lama (ffmpeg.ts sblm ini) MURNI potong+tempel klip statis, TIDAK
// ADA gerakan kamera sama sekali (dicek langsung ke kode sblm nulis modul ini, bukan
// asumsi). Fix: crop dinamis (bukan zoompan filter - zoompan didesain utk gambar diam
// frame-by-frame, lebih cocok utk foto; utk klip VIDEO yg sudah bergerak sendiri, crop
// filter dgn ekspresi waktu [`t`] jauh lebih ringan CPU-nya & tetap smooth) di atas
// canvas yg SENGAJA di-scale lebih besar dari target (HEADROOM) supaya ada "ruang gerak"
// utk zoom/pan tanpa keluar frame. Semua murni filter FFmpeg native - TIDAK butuh
// headless browser/GPU, tetap ringan di VPS 2 core.
export type MotionType = "static" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right";

export const ALL_MOTION_TYPES: MotionType[] = ["static", "zoom-in", "zoom-out", "pan-left", "pan-right"];

// 18% lebih besar dari target - cukup utk pan/zoom terasa (bukan cuma getar
// mikroskopis), tapi tidak berlebihan sampai footage kelihatan pecah/blur di area tepi
// (crop yg terlalu jauh dari sumber aslinya kualitasnya turun).
const HEADROOM_RATIO = 1.18;

export function buildCameraMotionFilter(
  motion: MotionType,
  targetWidth: number,
  targetHeight: number,
  durationSeconds: number
): string {
  const scaledW = Math.round(targetWidth * HEADROOM_RATIO);
  const scaledH = Math.round(targetHeight * HEADROOM_RATIO);
  // Ganjil-genap dipaksa genap (libx264 butuh dimensi genap utk yuv420p) - HEADROOM_RATIO
  // bisa hasilkan angka ganjil tergantung target.
  const scaledWEven = scaledW % 2 === 0 ? scaledW : scaledW + 1;
  const scaledHEven = scaledH % 2 === 0 ? scaledH : scaledH + 1;

  // Step A - normalisasi ke kanvas oversized TETAP (sama teknik dgn pipeline lama, cuma
  // lebih besar) - deterministik apa pun resolusi sumber asli klip.
  const base = `scale=${scaledWEven}:${scaledHEven}:force_original_aspect_ratio=increase,crop=${scaledWEven}:${scaledHEven},setsar=1,fps=30`;

  const d = Math.max(0.5, durationSeconds); // hindari div/0 utk klip super pendek
  const panRangeX = scaledWEven - targetWidth;

  let motionFilter: string;
  switch (motion) {
    case "zoom-in":
      // Crop menyusut dari FULL kanvas turun ke ukuran target, terpusat - hasil akhir
      // terlihat perlahan "mendekat" ke tengah frame.
      motionFilter =
        `crop=w='max(${targetWidth}\\,${scaledWEven}-(${scaledWEven}-${targetWidth})*min(t\\,${d})/${d})':` +
        `h='max(${targetHeight}\\,${scaledHEven}-(${scaledHEven}-${targetHeight})*min(t\\,${d})/${d})':` +
        `x='(in_w-out_w)/2':y='(in_h-out_h)/2'`;
      break;
    case "zoom-out":
      // Kebalikan zoom-in - mulai dari crop target (paling "dekat"), melebar ke penuh
      // kanvas (paling "jauh") - kesan "menjauh"/reveal.
      motionFilter =
        `crop=w='min(${scaledWEven}\\,${targetWidth}+(${scaledWEven}-${targetWidth})*min(t\\,${d})/${d})':` +
        `h='min(${scaledHEven}\\,${targetHeight}+(${scaledHEven}-${targetHeight})*min(t\\,${d})/${d})':` +
        `x='(in_w-out_w)/2':y='(in_h-out_h)/2'`;
      break;
    case "pan-left":
      // Zoom level TETAP (ukuran crop konstan) - cuma titik-x bergeser dari kanan ke
      // kiri kanvas oversized selama durasi klip.
      motionFilter =
        `crop=w=${targetWidth}:h=${targetHeight}:` +
        `x='${panRangeX}-${panRangeX}*min(t\\,${d})/${d}':y='(in_h-out_h)/2'`;
      break;
    case "pan-right":
      motionFilter =
        `crop=w=${targetWidth}:h=${targetHeight}:` +
        `x='${panRangeX}*min(t\\,${d})/${d}':y='(in_h-out_h)/2'`;
      break;
    case "static":
    default:
      motionFilter = `crop=${targetWidth}:${targetHeight}:(in_w-out_w)/2:(in_h-out_h)/2`;
      break;
  }

  // Scale akhir WAJIB ke ukuran target PERSIS (2026-08-10, bug nyata dicoba lokal -
  // ekspresi crop w/h yg dibulatkan per-frame bisa geser 1-2px dari target nominal,
  // concat demuxer `-c copy` WAJIB semua klip beresolusi identik persis atau gagal) -
  // scale redundan kalau sudah pas TAPI aman/murah drpd concat gagal diam-diam.
  return `${base},${motionFilter},scale=${targetWidth}:${targetHeight},setsar=1`;
}

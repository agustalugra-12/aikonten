import path from "path";

// Sticker/Emoji Overlay (2026-08-10, PRD "AI Content Editing Engine" - Overlay:
// "Sticker, Emoji") - satu-satunya elemen overlay PRD yg BELUM ada sama sekali sblm
// ini. Dicoba 3 pendekatan render emoji WARNA di server ini SEBELUM sampai ke desain
// final, semua GAGAL diverifikasi via tes render nyata: (1) ffmpeg drawtext langsung
// pakai font Noto Color Emoji -> error "invalid library handle" (drawtext/libfreetype
// tidak dukung bitmap-strike color font di build ffmpeg ini), (2) ImageMagick convert
// -font Noto -> hasil PNG kosong (1x129 grayscale, tidak ada glyph), (3) sharp+librsvg
// via SVG <text> -> RENDER tapi cuma silsuet HITAM (bukan warna asli, librsvg fallback
// ke outline glyph). Solusi yg BENAR2 terverifikasi bekerja: PNG emoji SUDAH JADI
// (bukan di-render dari font sama sekali) di-composite via `overlay` filter - TEKNIK
// SAMA PERSIS dgn logo brand (buildCircularLogoPng, PNG statis di-overlay). Asset
// (sticker_fire.png, 72x72, dari Twemoji - CC-BY 4.0, atribusi: "Twemoji" oleh
// Twitter/X, https://github.com/twitter/twemoji) di-download SEKALI ke repo, bukan
// fetch jaringan tiap render.
// BUG NYATA (2026-08-11, ditemukan lewat 12 video GAGAL nyata semalam via cron
// auto-generate) - __dirname di sini kena SAMA masalah dgn statIcons.ts (lihat
// catatan lengkap di sana) - build Turbopack project ini menulis ulang __dirname jadi
// string literal SALAH CASING ("/ROOT/..." bukan "/root/..."). Fix: process.cwd()
// (runtime, bukan build-time), bukan __dirname. Ini artinya sticker KEMUNGKINAN BESAR
// SUDAH GAGAL DIAM-DIAM di SEMUA render production sejak fitur ini dibuat - test tsx
// saya sendiri selalu lolos krn tidak lewat build production sungguhan.
const STICKER_PATH = path.join(process.cwd(), "src/lib/render/assets/sticker_fire.png");

export function getStickerAssetPath(): string {
  return STICKER_PATH;
}

// Durasi tampil sticker (2026-08-10) - flash SINGKAT (fade in 0.15dtk, tahan 1.1dtk,
// fade out 0.3dtk = ~1.55dtk total) di momen "peak" (klimaks/fakta paling menarik,
// lihat aiDirector.ts stickerClipIndex) - BUKAN elemen permanen spt logo (kalau
// permanen/terlalu sering, jadi mengganggu drpd menambah, PRD: "transisi... tidak
// berlebihan" - prinsip yg sama berlaku ke sticker).
const FADE_IN_SECONDS = 0.15;
const HOLD_SECONDS = 1.1;
const FADE_OUT_SECONDS = 0.3;

export function getStickerTotalSeconds(): number {
  return FADE_IN_SECONDS + HOLD_SECONDS + FADE_OUT_SECONDS;
}

// Bangun 2 filter stage: (1) format+fade in/out pada stream sticker (INPUT WAJIB pakai
// "-loop 1", lihat catatan bug nyata di ffmpeg.ts pd logo - tanpa loop, fade cuma
// kena 1 frame tunggal & sticker hilang total), (2) overlay ke video utama. Posisi
// pojok KIRI-atas (bukan kanan spt logo, supaya tidak tumpang tindih).
export function buildStickerFilterStages(
  stickerInputIdx: number,
  startSeconds: number,
  targetWidth: number,
  curLabel: string,
  outLabel: string
): string[] {
  const fadeOutStart = startSeconds + FADE_IN_SECONDS + HOLD_SECONDS;
  const margin = Math.round(targetWidth * 0.04);
  const stickerSize = Math.round(targetWidth * 0.14);
  return [
    `[${stickerInputIdx}:v]format=rgba,scale=${stickerSize}:${stickerSize},` +
      `fade=t=in:st=${startSeconds.toFixed(2)}:d=${FADE_IN_SECONDS}:alpha=1,` +
      `fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${FADE_OUT_SECONDS}:alpha=1[stickerfmt]`,
    `[${curLabel}][stickerfmt]overlay=${margin}:${margin}[${outLabel}]`,
  ];
}

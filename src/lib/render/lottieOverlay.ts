import path from "path";
import { readFileSync } from "fs";

// Lottie Animation Overlay (2026-08-11, permintaan Agus - "ya lanjut kerjakan semua
// ya", 9 file JSON dikirim via Drive). Sistem UMUM (bukan cuma 1 animasi) - JSON
// Lottie DI-PRE-RENDER SEKALI jadi urutan PNG transparan (lihat
// scripts/lottie/render_lottie.py, python `lottie` package export SVG per-frame +
// sharp rasterize - cairosvg/glaxnimate TIDAK terinstall, dihindari sengaja), lalu
// di-composite ke video via teknik SAMA PERSIS dgn overlay statis lain di project ini
// (format=rgba + overlay filter) - bedanya cuma input-nya SEQUENCE (`-framerate FPS
// -i dir/f%04d.png`, BUKAN "-loop 1" single image spt logo/sticker/bell) & disinkron
// ke titik mulai (startSeconds) di linimasa video utama via `tpad start_mode=clone`.
// Teknik sinkronisasi ini DITES LANGSUNG via render sintetis SEBELUM dipakai di sini
// (background biru + sequence WOW, overlay muncul TEPAT di t=startSeconds bukan t=0 -
// dicek 4 frame lewat screenshot, bukan asumsi dari dokumentasi) - pola verifikasi yg
// sama dipakai di seluruh overlay lain project ini (counter drawtext, scale pop-in,
// pulse sin()).
//
// process.cwd() (BUKAN __dirname) - lihat bug nyata & penjelasan lengkap di
// statIcons.ts/stickerOverlay.ts (build Turbopack project ini salah tulis ulang
// __dirname jadi path salah casing yg tidak pernah ada di disk).
function assetRoot(): string {
  return path.join(process.cwd(), "src/lib/render/assets/lottie");
}

export function getLottieAssetDir(name: string): string {
  return path.join(assetRoot(), name);
}

export function getLottieFramePattern(name: string): string {
  return path.join(getLottieAssetDir(name), "f%04d.png");
}

export type LottieMeta = { frameCount: number; fps: number; nativeWidth: number; nativeHeight: number };

export function getLottieMeta(name: string): LottieMeta {
  const raw = readFileSync(path.join(getLottieAssetDir(name), "meta.json"), "utf-8");
  return JSON.parse(raw) as LottieMeta;
}

export function getLottieNaturalSeconds(meta: LottieMeta): number {
  return meta.frameCount / meta.fps;
}

// Bangun 2 filter stage (format+scale+sinkron+fade opsional, lalu overlay) - pola SAMA
// dgn buildStickerFilterStages/buildSubscribeButtonFilterStages, cuma input-nya
// sequence. `x`/`y` posisi ABSOLUT (pixel) - pemanggil yg hitung margin/tengah, modul
// ini tidak berasumsi soal layout (dipakai utk beberapa slot beda: pojok kiri-atas
// reaction, full-bleed outro accent, dst).
export function buildLottieOverlayFilterStages(
  seqInputIdx: number,
  meta: LottieMeta,
  displayWidth: number,
  startSeconds: number,
  x: number | string,
  y: number | string,
  curLabel: string,
  outLabel: string,
  opts: { fadeOutSeconds?: number; alpha?: number; inputAlreadyOffset?: boolean } = {}
): string[] {
  const naturalSeconds = getLottieNaturalSeconds(meta);
  const endSeconds = startSeconds + naturalSeconds;
  const fadeOutSeconds = opts.fadeOutSeconds ?? 0;
  const alpha = opts.alpha ?? 1;
  const fmtLabel = `${outLabel}_fmt`;

  // (2026-09-01, audit reliability - render timeout 120 menit di VPS 2-core) `tpad`
  // SEBELUMNYA selalu dipakai utk menunda kemunculan sequence ini ke `startSeconds` -
  // utk confetti outro (biasa muncul di ~4 detik TERAKHIR video panjang, mis.
  // startSeconds=427 di video 431 detik), ini artinya ffmpeg meng-clone & memproses
  // (format/scale/fade/colorchannelmixer) ~427 detik frame PADDING yang TIDAK PERNAH
  // terlihat (confetti asli cuma tampil di enable='between()' window-nya) - kerja CPU
  // besar utk sesuatu yang secara visual tidak ada. Kalau pemanggil SUDAH menunda input
  // ini di level ffmpeg (`-itsoffset startSeconds` sebelum `-i`, lihat ffmpeg.ts), frame
  // dari input ini SUDAH mulai muncul tepat di t=startSeconds tanpa perlu tpad clone
  // sama sekali - set `inputAlreadyOffset: true` utk skip tpad di kasus itu.
  let stage = opts.inputAlreadyOffset
    ? `[${seqInputIdx}:v]format=rgba,scale=${displayWidth}:-2`
    : `[${seqInputIdx}:v]format=rgba,scale=${displayWidth}:-2,` +
      `tpad=start_duration=${startSeconds.toFixed(2)}:start_mode=clone`;
  if (fadeOutSeconds > 0) {
    stage += `,fade=t=out:st=${(endSeconds - fadeOutSeconds).toFixed(2)}:d=${fadeOutSeconds}:alpha=1`;
  }
  if (alpha < 1) {
    stage += `,colorchannelmixer=aa=${alpha}`;
  }
  stage += `[${fmtLabel}]`;

  return [
    stage,
    `[${curLabel}][${fmtLabel}]overlay=${x}:${y}:enable='between(t,${startSeconds.toFixed(2)},${endSeconds.toFixed(2)})'[${outLabel}]`,
  ];
}

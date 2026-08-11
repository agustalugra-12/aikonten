// Subscribe Button Animasi (2026-08-11, permintaan Agus - "seperti subscribe apa
// bisa?") - upgrade dari CTA teks polos (overlayEngine.ts buildCtaTextFilter) jadi
// tombol lonceng+teks dgn box + pulse berkelanjutan (BUKAN cuma pop sekali spt stat
// card icon - lonceng "berdenyut" TERUS selama tombol tampil, khas animasi subscribe
// YouTube asli). Teknik scale time-varying `eval=frame` SAMA persis dgn statOverlay.ts
// (sudah terverifikasi 2x via render nyata) - dites LAGI khusus utk pola sin() SEBELUM
// dipakai (osilasi kontinu beda dari pop-in yg cuma sekali naik). ctaText tetap
// APA ADANYA dari ctaEngine.ts (Subscribe utk YouTube, Follow utk platform lain) -
// modul ini CUMA upgrade visual, bukan ganti keputusan teks.
import path from "path";

const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// process.cwd() (2026-08-11) - BUKAN __dirname, lihat bug nyata & penjelasan lengkap
// di statIcons.ts/stickerOverlay.ts (build Turbopack project ini salah tulis ulang
// __dirname jadi "/ROOT/..." - huruf besar, path tidak pernah ada di disk).
export function getBellAssetPath(): string {
  return path.join(process.cwd(), "src/lib/render/assets/bell.png");
}

const FADE_SECONDS = 0.6;
const PULSE_HZ = 1.1; // ritme denyut - tidak terlalu cepat (mengganggu) atau lambat (kurang "hidup")
const PULSE_AMPLITUDE = 0.12; // +-12% ukuran lonceng - kelihatan tapi tidak berlebihan

export function buildSubscribeButtonFilterStages(
  bellInputIdx: number,
  ctaText: string,
  targetWidth: number,
  targetHeight: number,
  durationSeconds: number,
  curLabel: string,
  outLabel: string,
  showLastSeconds: number = 4
): string[] {
  const startAt = Math.max(0, durationSeconds - showLastSeconds);
  const fadeInEnd = startAt + FADE_SECONDS;
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "").replace(/:/g, "\\:");
  const text = escape(ctaText);

  const fontSize = Math.round(targetWidth * 0.045);
  const bellSize = Math.round(fontSize * 1.3);
  const boxH = Math.round(bellSize * 1.7);
  const boxPad = Math.round(targetWidth * 0.04);
  // Lebar box PERKIRAAN dari panjang teks (drawtext text_w baru diketahui SAAT render,
  // tidak bisa dipakai utk hitung posisi box SEBELUM drawtext jalan - box dilebihkan
  // proporsional thd jumlah karakter, cukup akurat utk kebanyakan teks CTA pendek yg
  // dipakai project ini, bukan pengukuran font metrics presisi).
  const estimatedTextW = Math.round(ctaText.length * fontSize * 0.55);
  const boxW = bellSize + boxPad * 3 + estimatedTextW;
  const boxX = Math.round((targetWidth - boxW) / 2);
  const marginBottom = Math.round(targetHeight * 0.1);
  const boxY = targetHeight - marginBottom - boxH;
  const bellX = boxX + boxPad;
  const bellY = boxY + Math.round((boxH - bellSize) / 2);
  const textX = bellX + bellSize + boxPad;

  const boxLabel = `${outLabel}_box`;
  const bellFmtLabel = `${outLabel}_bellfmt`;
  const bellOverlaidLabel = `${outLabel}_bellover`;

  const alphaExpr =
    `if(lt(t,${startAt.toFixed(2)}),0,if(lt(t,${fadeInEnd.toFixed(2)}),(t-${startAt.toFixed(2)})/${FADE_SECONDS},1))`;
  const enableExpr = `gte(t,${startAt.toFixed(2)})`;
  // Pulse (2026-08-11, permintaan Agus) - denyut BERKELANJUTAN selama tombol tampil
  // (bukan sekali pop) - `t` MENTAH dipakai langsung di sin() (bukan t-startAt) supaya
  // fase osilasi konsisten apa pun kapan tombolnya mulai muncul - efek visualnya sama
  // sekali tidak terlihat beda (mata tidak bisa lihat fase absolut), lebih simpel drpd
  // hitung ulang offset fase.
  const pulseScale = `trunc(${bellSize}*(1+${PULSE_AMPLITUDE}*sin(2*PI*t*${PULSE_HZ})))`;

  return [
    `[${curLabel}]drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=#CC1F1F@0.85:t=fill:enable='${enableExpr}'[${boxLabel}]`,
    `[${bellInputIdx}:v]format=rgba,scale=w='${pulseScale}':h='${pulseScale}':eval=frame[${bellFmtLabel}]`,
    `[${boxLabel}][${bellFmtLabel}]overlay=${bellX}:${bellY}:enable='${enableExpr}'[${bellOverlaidLabel}]`,
    `[${bellOverlaidLabel}]drawtext=fontfile=${FONT_PATH}:text='${text}':fontsize=${fontSize}:fontcolor=white:` +
      `x=${textX}:y=${boxY}+(${boxH}-text_h)/2:alpha='${alphaExpr}':enable='${enableExpr}'[${outLabel}]`,
  ];
}

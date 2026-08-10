// Graphic Overlay - Stat Card (2026-08-10, preset editing Animal Story & Co - PRD
// section GRAPHICS: "Weight/Height/Speed/... Never clutter the screen"). Murni
// drawbox+drawtext NATIVE ffmpeg (SAMA teknik dgn Overlay Engine progress bar/CTA yg
// sudah terverifikasi bekerja - TIDAK butuh input gambar/ikon terpisah spt sticker,
// jadi TIDAK nambah kompleksitas index input ffmpeg). Posisi KANAN-TENGAH (2026-08-10)
// - dicek SEMUA overlay lain SUDAH ada tempat masing2: logo pojok kanan-ATAS, sticker
// pojok kiri-atas, subtitle bawah-tengah, CTA+progress bar paling bawah - kanan-tengah
// SATU2NYA area yg masih kosong di 4 preset yg sudah ada.
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const DISPLAY_SECONDS = 1.8;
const FADE_SECONDS = 0.25;

export function getStatOverlayDurationSeconds(): number {
  return DISPLAY_SECONDS;
}

// Box HARD in/out (enable=), teks FADE in/out (alpha= expression, teknik SAMA persis
// dgn buildCtaTextFilter yg sudah terverifikasi render benar) - kombinasi umum di
// motion graphic (box tegas, teks lembut) & lebih simpel/aman drpd fade box juga
// (drawbox tidak py parameter alpha time-varying semudah drawtext).
export function buildStatOverlayFilter(
  label: string,
  value: string,
  startSeconds: number,
  targetWidth: number,
  targetHeight: number
): string {
  const endSeconds = startSeconds + DISPLAY_SECONDS;
  const fadeOutStart = endSeconds - FADE_SECONDS;
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "").replace(/:/g, "\\:");
  const text = escape(`${label.toUpperCase()}: ${value}`);

  const boxW = Math.round(targetWidth * 0.5);
  const boxH = Math.round(targetHeight * 0.06);
  const boxX = targetWidth - boxW - Math.round(targetWidth * 0.04);
  const boxY = Math.round(targetHeight * 0.42);
  const fontSize = Math.round(targetWidth * 0.038);

  return (
    `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=black@0.55:t=fill:` +
    `enable='between(t,${startSeconds.toFixed(2)},${endSeconds.toFixed(2)})',` +
    `drawtext=fontfile=${FONT_PATH}:text='${text}':fontsize=${fontSize}:fontcolor=white:` +
    `x=${boxX}+(${boxW}-text_w)/2:y=${boxY}+(${boxH}-text_h)/2:` +
    `alpha='if(lt(t,${startSeconds.toFixed(2)}),0,if(lt(t,${(startSeconds + FADE_SECONDS).toFixed(2)}),` +
    `(t-${startSeconds.toFixed(2)})/${FADE_SECONDS},if(lt(t,${fadeOutStart.toFixed(2)}),1,` +
    `if(lt(t,${endSeconds.toFixed(2)}),(${endSeconds.toFixed(2)}-t)/${FADE_SECONDS},0))))'`
  );
}

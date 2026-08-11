// Graphic Overlay - Stat Card (2026-08-10, preset editing Animal Story & Co - PRD
// section GRAPHICS: "Weight/Height/Speed/... Never clutter the screen"). Murni
// drawbox+drawtext+overlay NATIVE ffmpeg (SAMA teknik dgn Overlay Engine progress bar/
// CTA yg sudah terverifikasi bekerja - ikon PNG di-composite SAMA teknik dgn sticker,
// bukan gambar baru per video). Posisi KANAN-TENGAH (2026-08-10) - dicek SEMUA overlay
// lain SUDAH ada tempat masing2: logo pojok kanan-ATAS, sticker pojok kiri-atas,
// subtitle bawah-tengah, CTA+progress bar paling bawah - kanan-tengah SATU2NYA area
// yg masih kosong di 4 preset yg sudah ada.
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const DISPLAY_SECONDS = 1.8;
const FADE_SECONDS = 0.25;
// Icon Pop-in (2026-08-11, permintaan Agus "animasi sebanyak mungkin") - dicek dulu
// LANGSUNG via render test drawtext/scale `eval=frame` SEBELUM dipakai (bukan asumsi
// dari dokumentasi) - icon TUMBUH dari 50%->100% ukuran cepat (0.15dtk) di awal
// kemunculan, bukan langsung muncul penuh spt sebelumnya.
const POP_IN_SECONDS = 0.15;
// Counter (2026-08-11) - dicek dulu LANGSUNG via render test `%{eif:EXPR:d}` SEBELUM
// dipakai (sintaks expansion drawtext, BUKAN parameter biasa - beda mekanisme dari
// alpha=/enable= yg sudah dipakai di file lain). Angka MENGHITUNG NAIK dari 0 ke nilai
// asli selama COUNT_SECONDS pertama kemunculan kartu, baru diam di nilai final.
const COUNT_SECONDS = 0.6;

export function getStatOverlayDurationSeconds(): number {
  return DISPLAY_SECONDS;
}

// Deteksi angka BULAT di AWAL string value (2026-08-11) - HANYA aktifkan counter kalau
// polanya jelas/aman (mis. "1938", "250", "5000 kg") - value yg angkanya TIDAK di awal
// (mis. "fewer than 250") atau perlu pengali kata (mis. "66 million years") SENGAJA
// TIDAK dikenali di sini (drpd salah tampil "66" tanpa "million", teks statis biasa
// tetap dipakai - fallback aman, bukan best-effort yg berisiko salah makna).
function parseLeadingInteger(value: string): { number: number; suffix: string } | null {
  const m = value.match(/^(\d[\d,]*)(.*)$/);
  if (!m) return null;
  const num = parseInt(m[1].replace(/,/g, ""), 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  return { number: num, suffix: m[2] };
}

// Box+ikon HARD in/out (enable=), teks FADE in/out (alpha= expression, teknik SAMA
// persis dgn buildCtaTextFilter yg sudah terverifikasi render benar) - kombinasi umum
// di motion graphic (box tegas, teks lembut) & lebih simpel/aman drpd fade box/ikon
// jg (drawbox/overlay tidak py parameter alpha time-varying semudah drawtext).
// iconInputIdx = index input ffmpeg utk PNG ikon (SUDAH "-loop 1", lihat ffmpeg.ts -
// WAJIB sama alasannya dgn logo/sticker: gambar statis tanpa loop cuma 1 frame).
export function buildStatOverlayFilterStages(
  iconInputIdx: number,
  label: string,
  value: string,
  startSeconds: number,
  targetWidth: number,
  targetHeight: number,
  curLabel: string,
  outLabel: string
): string[] {
  const endSeconds = startSeconds + DISPLAY_SECONDS;
  const fadeOutStart = endSeconds - FADE_SECONDS;
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "").replace(/:/g, "\\:");

  // Counter (lihat catatan const di atas) - label TETAP teks statis biasa, cuma bagian
  // ANGKA (kalau polanya cocok) yg jadi expression `%{eif:...}` digabung LANGSUNG di
  // string `text=` yg sama (dicek: kombinasi statis+%{} dalam 1 text= SUDAH terverifikasi
  // render benar via tes langsung) - suffix (mis. " kg") tetap statis, cuma angkanya hidup.
  const labelPart = escape(`${label.toUpperCase()}: `);
  const counterInfo = parseLeadingInteger(value);
  const valuePart = counterInfo
    ? `%{eif\\:${counterInfo.number}*max(0\\,min(1\\,(t-${startSeconds.toFixed(2)})/${COUNT_SECONDS}))\\:d}${escape(counterInfo.suffix)}`
    : escape(value);
  const text = labelPart + valuePart;

  const boxW = Math.round(targetWidth * 0.5);
  const boxH = Math.round(targetHeight * 0.06);
  const boxX = targetWidth - boxW - Math.round(targetWidth * 0.04);
  const boxY = Math.round(targetHeight * 0.42);
  const fontSize = Math.round(targetWidth * 0.036);
  const iconSize = Math.round(boxH * 0.65);
  const iconPad = Math.round(boxH * 0.18);
  const iconX = boxX + iconPad;
  const iconY = boxY + Math.round((boxH - iconSize) / 2);
  const textX = iconX + iconSize + iconPad; // teks mulai SETELAH ikon, bukan di tengah box lagi (beda dari versi tanpa ikon)

  const boxLabel = `${outLabel}_box`;
  const iconFmtLabel = `${outLabel}_iconfmt`;
  const iconedLabel = `${outLabel}_iconed`;

  // Pop-in: scale ikon 50%->100% dari ukuran akhir selama POP_IN_SECONDS pas box mulai
  // muncul - `eval=frame` WAJIB (scale filter defaultnya cuma evaluasi expression SEKALI
  // di awal, bukan tiap frame - dicek langsung, bukan asumsi).
  const popScale = `trunc(${iconSize}*min(1\\,0.5+0.5*(t-${startSeconds.toFixed(2)})/${POP_IN_SECONDS}))`;

  return [
    `[${curLabel}]drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=black@0.55:t=fill:` +
      `enable='between(t,${startSeconds.toFixed(2)},${endSeconds.toFixed(2)})'[${boxLabel}]`,
    `[${iconInputIdx}:v]format=rgba,scale=w='${popScale}':h='${popScale}':eval=frame[${iconFmtLabel}]`,
    `[${boxLabel}][${iconFmtLabel}]overlay=${iconX}:${iconY}:enable='between(t,${startSeconds.toFixed(2)},${endSeconds.toFixed(2)})'[${iconedLabel}]`,
    `[${iconedLabel}]drawtext=fontfile=${FONT_PATH}:text='${text}':fontsize=${fontSize}:fontcolor=white:` +
      `x=${textX}:y=${boxY}+(${boxH}-text_h)/2:` +
      `alpha='if(lt(t,${startSeconds.toFixed(2)}),0,if(lt(t,${(startSeconds + FADE_SECONDS).toFixed(2)}),` +
      `(t-${startSeconds.toFixed(2)})/${FADE_SECONDS},if(lt(t,${fadeOutStart.toFixed(2)}),1,` +
      `if(lt(t,${endSeconds.toFixed(2)}),(${endSeconds.toFixed(2)}-t)/${FADE_SECONDS},0))))'[${outLabel}]`,
  ];
}

// Lower Third (2026-08-10, "Overlay System PRD" Category A) - murni drawbox+drawtext
// NATIVE ffmpeg (SAMA teknik dgn CTA/progress bar), TIDAK butuh input tambahan (beda
// dari stat card yg py ikon). Posisi bawah-KIRI, DI ATAS zona subtitle (bukan
// bertumpuk) - dicek posisi subtitle di subtitleDesign.ts (MarginV dari dasar), lower
// third ditaruh lebih tinggi lagi drpd itu. Muncul SEKALI SAJA di awal video (khas
// intro dokumenter), bukan berulang.
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const START_SECONDS = 0.6; // sedikit setelah video mulai, bukan tepat t=0 (hindari numpuk dgn hook motion/fade lain)
const DISPLAY_SECONDS = 2.6;
const FADE_SECONDS = 0.3;

// Diekspor (2026-08-11, bug nyata ditemukan lewat render SUNGGUHAN - "Pink Fairy
// Armadillo" - stat card "LENGTH: four inches" muncul BARENGAN dgn lower third di
// 0.6-3.2dtk, dua overlay numpuk persis di area yg sama pas frame dicek langsung)
// - dipakai ffmpeg.ts utk tunda stat card PERTAMA kalau jatuh di jendela waktu ini,
// drpd 2 angka magic terpisah yg bisa menyimpang kalau salah satu diubah nanti.
export const LOWER_THIRD_END_SECONDS = START_SECONDS + DISPLAY_SECONDS;

// Estimasi lebar teks (2026-08-11, bug nyata ditemukan di render sama - nama panjang
// spt "PINK FAIRY ARMADILLO" di fontsize tetap 7% lebar video KELUAR LAYAR di KEDUA
// sisi, terlihat jelas lewat cek frame langsung, bukan cuma hitungan teori) - drawtext
// TIDAK py cara hitung text_w SEBELUM render (chicken-egg, fontsize sendiri yg
// menentukan text_w), jadi dipakai heuristik char-count SAMA POLA dgn
// subscribeButton.ts (estimatedTextW) - fontsize name di-KECILKAN proporsional kalau
// perkiraan lebarnya bakal melebihi ruang aman, bukan dibiarkan overflow apa adanya.
// 0.68 (2026-08-11) - DIUKUR LANGSUNG (render teks -> convert -trim -> baca lebar
// piksel asli), BUKAN ditebak. 0.62 dicoba dulu, ternyata sedikit meleset (ukur 2
// contoh nyata: 978px/20karakter@75px=0.652, 1070px/21karakter@75px=0.679) - cukup
// dekat KE ambang batas hingga kasus asli "Pink Fairy Armadillo" LOLOS dari deteksi
// (930px dihitung vs 932px batas aman, padahal lebar sungguhannya jauh lebih besar).
// 0.68 dibulatkan ke ATAS dari rata2 terukur (bukan pas-pasan) - lebih baik teks
// sedikit lebih kecil dari perlu drpd overflow lagi.
const CHAR_WIDTH_FACTOR = 0.68; // DejaVu Sans Bold huruf besar, diukur langsung
const MIN_NAME_FONT_RATIO = 0.045;

export function buildLowerThirdFilter(
  name: string,
  tagline: string,
  targetWidth: number,
  targetHeight: number
): string {
  const endSeconds = START_SECONDS + DISPLAY_SECONDS;
  const fadeOutStart = endSeconds - FADE_SECONDS;
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "").replace(/:/g, "\\:");
  const nameUpper = name.toUpperCase();
  const nameEsc = escape(nameUpper);
  const taglineEsc = escape(tagline);

  const barX = Math.round(targetWidth * 0.06);
  // 0.48 (2026-08-10, DIKOREKSI dari 0.66 - bug nyata ditemukan lewat render+cek
  // frame sungguhan, bukan cuma hitungan) - zona subtitle PORTRAIT (subtitleDesign.ts
  // marginVFor: 760/1920 ~ 39.6% dari BAWAH = mulai ~60.4% dari ATAS) ternyata
  // tumpang tindih dgn 0.66 lama. 0.48 kasih jarak aman JAUH di atas 60.4%, tetap
  // masuk kategori "lower third" (bawah-tengah frame, bukan area atas/tengah).
  const barY = Math.round(targetHeight * 0.48);
  const barW = Math.round(targetWidth * 0.012); // aksen vertikal tipis khas lower third broadcast
  const barH = Math.round(targetHeight * 0.09);
  const textX = barX + barW + Math.round(targetWidth * 0.025);
  const maxNameWidth = targetWidth - textX - Math.round(targetWidth * 0.04);
  const baseNameFontSize = Math.round(targetWidth * 0.07);
  const estimatedNameWidth = nameUpper.length * baseNameFontSize * CHAR_WIDTH_FACTOR;
  const nameFontSize =
    estimatedNameWidth > maxNameWidth
      ? Math.max(
          Math.round(targetWidth * MIN_NAME_FONT_RATIO),
          Math.round(maxNameWidth / (nameUpper.length * CHAR_WIDTH_FACTOR))
        )
      : baseNameFontSize;
  const taglineFontSize = Math.round(targetWidth * 0.036);

  const alphaExpr =
    `if(lt(t,${START_SECONDS}),0,if(lt(t,${(START_SECONDS + FADE_SECONDS).toFixed(2)}),` +
    `(t-${START_SECONDS})/${FADE_SECONDS},if(lt(t,${fadeOutStart.toFixed(2)}),1,` +
    `if(lt(t,${endSeconds.toFixed(2)}),(${endSeconds.toFixed(2)}-t)/${FADE_SECONDS},0))))`;

  return (
    `drawbox=x=${barX}:y=${barY}:w=${barW}:h=${barH}:color=white@0.9:t=fill:` +
    `enable='between(t,${START_SECONDS},${endSeconds.toFixed(2)})',` +
    `drawtext=fontfile=${FONT_PATH}:text='${nameEsc}':fontsize=${nameFontSize}:fontcolor=white:` +
    `borderw=2:bordercolor=black@0.6:x=${textX}:y=${barY}:alpha='${alphaExpr}',` +
    `drawtext=fontfile=${FONT_PATH}:text='${taglineEsc}':fontsize=${taglineFontSize}:fontcolor=white@0.85:` +
    `x=${textX}:y=${barY}+${Math.round(nameFontSize * 1.05)}:alpha='${alphaExpr}'`
  );
}

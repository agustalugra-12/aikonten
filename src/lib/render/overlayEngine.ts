// Overlay Engine (2026-08-10, PRD "AI Content Editing Engine" section 21/31) - Logo
// sudah ada (logoOverlay.ts, dipakai LANGSUNG di ffmpeg.ts), 2 elemen BARU di sini:
// Progress Bar (garis tipis di bawah, terisi seiring durasi - umum di format Shorts/
// TikTok modern) & CTA text (ajakan "Subscribe"/"Follow" muncul di akhir video, fade
// in - PRD section 25 "Hook Engine" & 23 "Scene Engine" sebut CTA sbg bagian struktur
// wajib "Ending"). Keduanya filter FFmpeg native (drawbox/drawtext) - nol biaya AI,
// murni komputasi lokal, konsisten dgn seluruh Editing Engine yg sudah dibangun.
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// Progress bar - garis tipis SELALU tampil, lebar bertambah 0% -> 100% seiring waktu
// tayang. `w` pakai ekspresi waktu `t` (FFmpeg drawbox evaluasi ulang tiap frame secara
// default utk parameter numerik spt ini - TIDAK butuh `eval=frame` eksplisit, sudah
// perilaku bawaan filter ini utk ekspresi yg mengandung `t`).
export function buildProgressBarFilter(targetWidth: number, targetHeight: number, durationSeconds: number): string {
  const barHeight = Math.max(4, Math.round(targetHeight * 0.006)); // ~0.6% tinggi frame - tipis, tidak dominan
  return `drawbox=x=0:y=${targetHeight - barHeight}:w='iw*t/${durationSeconds.toFixed(2)}':h=${barHeight}:color=white@0.85:t=fill`;
}

// CTA text - muncul HANYA di beberapa detik terakhir (default 4dtk), fade in
// (alpha naik dari 0->1 selama 0.6dtk pertama kemunculannya) - teks pendek generik
// ("Subscribe for more!" dst), BUKAN AI-generated per-video (proporsional - CTA
// generik konsisten lintas video LEBIH baik utk branding drpd variasi tak perlu,
// beda dgn subtitle/narasi yg memang harus unik per video).
export function buildCtaTextFilter(
  text: string,
  targetWidth: number,
  targetHeight: number,
  durationSeconds: number,
  showLastSeconds: number = 4
): string {
  const startAt = Math.max(0, durationSeconds - showLastSeconds);
  const fadeInEnd = startAt + 0.6;
  const escaped = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
  const fontSize = Math.round(targetWidth * 0.045);
  const marginBottom = Math.round(targetHeight * 0.1);
  return (
    `drawtext=fontfile=${FONT_PATH}:text='${escaped}':fontsize=${fontSize}:fontcolor=white:` +
    `borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-${marginBottom}-text_h:` +
    `alpha='if(lt(t,${startAt.toFixed(2)}),0,if(lt(t,${fadeInEnd.toFixed(2)}),(t-${startAt.toFixed(2)})/0.6,1))':` +
    `enable='gte(t,${startAt.toFixed(2)})'`
  );
}

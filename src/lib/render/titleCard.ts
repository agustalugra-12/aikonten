import { assStyleColor } from "./subtitleDesign";
import {
  TITLE_ANIMATIONS,
  DEFAULT_TITLE_ANIMATION,
  titleAlignment,
  type TitleAnimation,
  type TitlePosition,
} from "./motionPresets";

// Title Card animasi (2026-10-25, Phase 1 audit video engine - "Animated title or
// title-card preset"). Teks judul/hook besar di TENGAH frame utk beberapa detik PERTAMA
// video, dgn animasi masuk (fade + pop skala) & fade keluar - gaya "hook card" khas
// Shorts/Reels. SATU file .ass terpisah (dibakar sbg stage `ass=` tambahan di ffmpeg.ts),
// BUKAN dicampur ke subtitle word-highlight - supaya timing/animasi/posisinya independen
// & tidak mengganggu caption kata-per-kata yg sudah presisi.
//
// Reuse pola & helper warna dari subtitleDesign.ts (assStyleColor - konversi #RRGGBB ->
// &HAABBGGRR& ASS yg mudah salah kalau ditulis manual). Font di-resolve libass via
// fontconfig + fontsdir (lihat ffmpeg.ts) - sama jalur dgn subtitle, jadi Poppins yg
// sudah di-bundle otomatis kepakai di sini juga.
//
// DEFAULT-OFF di pipeline: renderFinalVideo hanya membangun & membakar title card kalau
// caller mengirim `titleText` (lihat opts.titleText di ffmpeg.ts). Jalur generate yg ada
// TIDAK mengirimnya -> output video existing TIDAK berubah sama sekali (backward-compat).
// Sumber teks alami utk Phase 2 = `hookText` yg sudah dihitung di processProject.ts.

export type TitleCardDesign = {
  font: string;
  color: string; // hex "#RRGGBB"
  outline: string; // hex
  size: number; // px @ lebar referensi 1080 (diskalakan ke lebar frame asli)
  outlineWidth: number; // px @ 1080
  // Preset animasi masuk (2026-10-26, Fase 3 - lihat motionPresets.TITLE_ANIMATIONS).
  // undefined = FadePop (perilaku Fase 1 persis).
  animation?: TitleAnimation;
};

export const DEFAULT_TITLE_CARD_DESIGN: TitleCardDesign = {
  font: "Poppins SemiBold",
  color: "#FFFFFF",
  outline: "#000000",
  size: 96,
  outlineWidth: 6,
  animation: DEFAULT_TITLE_ANIMATION,
};

const REFERENCE_WIDTH = 1080;
function scaleToFrame(value: number, frameWidth: number): number {
  return Math.round((value / REFERENCE_WIDTH) * frameWidth);
}

function secondsToAss(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const cs = Math.round((totalSeconds - Math.floor(totalSeconds)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// Bangun 1 file .ass berisi HANYA title card (1 Dialogue event). Animasi masuk:
// fade (`\fad` masuk 300ms / keluar 300ms) + pop skala 60%->100% dlm 250ms (`\t`).
// Alignment 5 = tengah-tengah frame (MarginV diabaikan utk alignment tengah - spec ASS).
export function buildTitleCardAss(
  text: string,
  design: TitleCardDesign,
  frameWidth: number,
  frameHeight: number,
  opts: { startSeconds?: number; durationSeconds?: number; position?: TitlePosition } = {}
): string {
  const start = opts.startSeconds ?? 0;
  const duration = opts.durationSeconds ?? 2.5;
  const end = start + duration;
  const fontSize = scaleToFrame(design.size, frameWidth);
  const outlineWidth = scaleToFrame(design.outlineWidth, frameWidth);

  // Posisi (2026-10-26, Fase 3) - default middle-center (perilaku Fase 1). Alignment 5
  // (tengah) abaikan MarginV; atas/bawah pakai margin ~12% tinggi frame biar tak mepet tepi.
  const position = opts.position ?? "middle-center";
  const alignment = titleAlignment(position);
  const marginV = alignment === 5 ? 0 : Math.round(frameHeight * 0.12);

  // Buang karakter yg bentrok dgn ASS override tags; batasi 1 baris aman (wrap otomatis
  // libass kalau kepanjangan). Judul biasanya pendek (hook) - tidak diparse NLP.
  const clean = text.replace(/[{}\n\r]/g, " ").trim();

  // Animasi masuk dari registry (default FadePop = Fase 1). Fallback aman kalau animation
  // tak dikenal (seharusnya sudah divalidasi di hulu).
  const animFn = TITLE_ANIMATIONS[design.animation ?? DEFAULT_TITLE_ANIMATION] ?? TITLE_ANIMATIONS[DEFAULT_TITLE_ANIMATION];
  const entrance = animFn({ an: alignment });

  const header =
    `[Script Info]\nPlayResX: ${frameWidth}\nPlayResY: ${frameHeight}\nScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Title,${design.font},${fontSize},${assStyleColor(design.color)},&H000000FF,${assStyleColor(design.outline)},&H00000000,-1,0,0,0,100,100,0,0,1,${outlineWidth},0,${alignment},40,40,${marginV},1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  const event = `Dialogue: 0,${secondsToAss(start)},${secondsToAss(end)},Title,,0,0,0,,${entrance}${clean}`;
  return header + event + "\n";
}

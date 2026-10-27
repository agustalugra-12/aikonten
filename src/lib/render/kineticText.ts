import { assStyleColor } from "./subtitleDesign";
import { titleAlignment, DEFAULT_KINETIC_PRESET, type KineticPreset, type TitlePosition } from "./motionPresets";

// Kinetic Typography (2026-10-27, Fase 3E). Overlay teks hook/judul promosi beranimasi,
// DISTINCT dari Animated Title (titleCard - versi polos) & subtitle (narasi). SATU file
// .ass terpisah (stage ass= tambahan di ffmpeg.ts) berisi 1 Dialogue event ringan - tak
// menambah input/stream ffmpeg (hemat RAM/CPU VPS 4GB) & tak mengubah durasi/audio video
// (overlay tampil dalam window-nya sendiri di dalam durasi yg sudah ada). Font di-resolve
// libass via fontsdir (sama jalur subtitle/title). DEFAULT-OFF: renderFinalVideo hanya
// membangun ini kalau caller kirim kineticText (lihat processProject - hanya saat brand
// mengaktifkan kineticTypography). Teks di-SANITASI (buang {}/\/newline) + split kata,
// jadi input user TIDAK bisa menyuntik override/filter.

export type KineticDesign = {
  font: string;
  color: string; // #RRGGBB warna utama
  highlightColor: string; // #RRGGBB (preset HighlightKeyword)
  outline: string; // #RRGGBB
  size: number; // px @ lebar referensi 1080
  outlineWidth: number; // px @ 1080
  preset: KineticPreset;
};

export const DEFAULT_KINETIC_DESIGN: KineticDesign = {
  font: "Poppins SemiBold",
  color: "#FFFFFF",
  highlightColor: "#FFD84D",
  outline: "#000000",
  size: 84,
  outlineWidth: 5,
  preset: DEFAULT_KINETIC_PRESET,
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
// #RRGGBB -> &Hbgr& (inline \c) - urutan ASS kebalikan web. Hanya dipanggil utk warna yg
// SUDAH divalidasi hex di hulu; tetap bersihkan non-hex utk aman.
function inlineColor(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "").padStart(6, "0").slice(-6);
  const r = clean.slice(0, 2), g = clean.slice(2, 4), b = clean.slice(4, 6);
  return `&H${(b + g + r).toUpperCase()}&`;
}
// Buang karakter yg bisa memulai override/escape ASS ({ } \) + newline, rapikan spasi.
function sanitize(text: string): string {
  return text.replace(/[{}\\\n\r]/g, " ").replace(/\s+/g, " ").trim();
}

// Bangun 1 file .ass berisi HANYA kinetic text (1 Dialogue). text = hook/judul (pendek).
export function buildKineticTextAss(
  text: string,
  design: KineticDesign,
  frameWidth: number,
  frameHeight: number,
  opts: { startSeconds?: number; durationSeconds?: number; position?: TitlePosition } = {}
): string {
  const clean = sanitize(text);
  const words = clean.split(" ").filter(Boolean);
  const start = opts.startSeconds ?? 0;
  const duration = Math.min(6, Math.max(1, opts.durationSeconds ?? 2.5));
  const end = start + duration;
  const fontSize = scaleToFrame(design.size, frameWidth);
  const outlineWidth = scaleToFrame(design.outlineWidth, frameWidth);
  const position = opts.position ?? "middle-center";
  const an = titleAlignment(position);
  const marginV = an === 5 ? 0 : Math.round(frameHeight * 0.14);
  const primary = inlineColor(design.color);
  const hl = inlineColor(design.highlightColor);

  // teks kosong -> file ass tanpa event (stage ass= jadi no-op aman).
  const header =
    `[Script Info]\nPlayResX: ${frameWidth}\nPlayResY: ${frameHeight}\nScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Kin,${design.font},${fontSize},${assStyleColor(design.color)},&H000000FF,${assStyleColor(design.outline)},&H00000000,-1,0,0,0,100,100,0,0,1,${outlineWidth},0,${an},60,60,${marginV},1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  if (words.length === 0) return header;

  let body = "";
  switch (design.preset) {
    case "Pop":
      body = `{\\an${an}\\fad(200,200)\\fscx55\\fscy55\\t(0,220,\\fscx100\\fscy100)}${clean}`;
      break;
    case "SlideUp": {
      const cx = Math.round(frameWidth / 2);
      const cy = an === 8 ? Math.round(frameHeight * 0.14) : an === 2 ? Math.round(frameHeight * 0.86) : Math.round(frameHeight / 2);
      const slide = Math.round(frameHeight * 0.06);
      body = `{\\an${an}\\fad(250,300)\\move(${cx},${cy + slide},${cx},${cy},0,350)}${clean}`;
      break;
    }
    case "HighlightKeyword": {
      // kata kunci = kata terpanjang (heuristik sederhana, bukan NLP) - diberi warna highlight.
      const kw = words.reduce((a, b) => (b.length > a.length ? b : a), words[0]);
      body = `{\\an${an}\\fad(250,300)}` + words.map((w) => (w === kw ? `{\\c${hl}}${w}{\\c${primary}}` : w)).join(" ");
      break;
    }
    case "WordByWord": {
      // Kata muncul bertahap, timing RATA sepanjang ~70% durasi (teks TIDAK dinarasikan -
      // bukan Whisper) - jadi NOL dampak audio/durasi. 1 Dialogue, tiap kata fade-in di
      // jadwalnya (\alpha statis FF -> animasi ke 00 via \t relatif ke awal event).
      const revealMs = Math.max(300, Math.round(duration * 1000 * 0.7));
      const per = revealMs / words.length;
      body = `{\\an${an}}` + words
        .map((w, i) => {
          const t0 = Math.round(i * per);
          return `{\\alpha&HFF&\\t(${t0},${t0 + 150},\\alpha&H00&)}${w}`;
        })
        .join(" ");
      break;
    }
    case "FadeIn":
    default:
      body = `{\\an${an}\\fad(300,300)}${clean}`;
      break;
  }

  const event = `Dialogue: 0,${secondsToAss(start)},${secondsToAss(end)},Kin,,0,0,0,,${body}`;
  return header + event + "\n";
}

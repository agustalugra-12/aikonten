import type { WordTiming } from "@/lib/ai/transcribe";

// Subtitle Designer (2026-08-10, permintaan Agus - "gunakan ini juga agar desain font
// lebih bagus... Engine inilah yang membuat subtitle terlihat seperti TikTok atau
// YouTube Shorts modern") - dia kirim contoh bentuk config JSON (font/size/color/
// outline/outlineWidth/shadow/highlightColor/animation/position/maxLines) sbg SKETSA
// spec, bukan kode literal ("ini yang akan kamu buat sendiri") - jadi field2 di bawah
// SENGAJA namanya persis sama dgn contoh dia, tapi implementasinya (grouping kata jadi
// "burst", animasi pop via ASS \t transform, highlight kata yg SEDANG diucapkan) desain
// baru.
//
// SEBELUM ini (lihat ffmpeg.ts buildAssContent versi lama) subtitle = 1 blok teks utuh
// per segmen Whisper (~beberapa detik), muncul/hilang SEKALIGUS, font/warna HARDCODE
// (Arial, putih polos, tanpa animasi) - gaya caption "berita TV" lama, BUKAN gaya
// TikTok/CapCut/Opus Clip modern (kata muncul satu-satu mengikuti ucapan, kata yg
// SEDANG diucapkan disorot warna beda + sedikit membesar/"pop").
export type SubtitleDesign = {
  font: string;
  size: number; // px, skala thd LEBAR frame 1080 (portrait) - lihat toFrameRatio()
  color: string; // hex "#RRGGBB" - warna kata yg BELUM/SUDAH diucapkan
  outline: string; // hex
  outlineWidth: number; // px, skala sama dgn size
  shadow: boolean;
  highlightColor: string; // hex - warna kata yg SEDANG diucapkan saat ini
  animation: "PopIn" | "None";
  position: "bottom-center" | "middle-center" | "top-center";
  maxLines: number; // wrap - burst kata dipecah ke MAKS sekian baris tampil
};

// Default (2026-08-10) - warna/animasi PERSIS mengikuti contoh yg dikirim Agus (putih +
// outline hitam tebal + shadow + highlight kuning + PopIn), font "Poppins SemiBold"
// (di-install nyata ke server, dicek fc-list SEBELUM dipakai - font TIDAK terpasang
// bakal di-substitusi diam-diam oleh fontconfig ke font lain tanpa error, jadi wajib
// dipastikan dulu, bukan asumsi nama font otomatis "ada").
export const DEFAULT_SUBTITLE_DESIGN: SubtitleDesign = {
  font: "Poppins SemiBold",
  size: 64,
  color: "#FFFFFF",
  outline: "#000000",
  outlineWidth: 4,
  shadow: true,
  highlightColor: "#FFD84D",
  animation: "PopIn",
  position: "bottom-center",
  maxLines: 2,
};

// size/outlineWidth di config dikalibrasi utk frame lebar 1080 (portrait standar) -
// diskalakan proporsional ke lebar SUNGGUHAN video ini (bisa 1920 utk landscape/YT
// biasa) - pola SAMA PERSIS dgn SUBTITLE_FONT_SIZE_RATIO lama di ffmpeg.ts, supaya
// visual tetap proporsional di kedua orientasi bukan cuma pas di portrait.
const DESIGN_REFERENCE_WIDTH = 1080;
function toFrameRatio(value: number, frameWidth: number): number {
  return Math.round((value / DESIGN_REFERENCE_WIDTH) * frameWidth);
}

// ASS pakai urutan warna &HAABBGGRR& (alpha-blue-green-red), KEBALIKAN dari hex web
// biasa (#RRGGBB) - salah urutan ini bikin warna sama sekali beda tanpa error apa pun
// (silent wrong color), jadi wajib dikonversi eksplisit di SATU tempat, bukan ditulis
// manual per pemakaian.
function hexToAssBgr(hex: string): string {
  const clean = hex.replace("#", "").padStart(6, "0");
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `${b}${g}${r}`.toUpperCase();
}
// Utk field [V4+ Styles] (butuh prefix alpha 2-digit, 00 = penuh terlihat).
function assStyleColor(hex: string): string {
  return `&H00${hexToAssBgr(hex)}&`;
}
// Utk override tag inline `{\c...}` (tanpa prefix alpha - alpha diatur terpisah lewat
// `\alpha` kalau perlu, tidak dipakai di sini krn subtitle selalu penuh terlihat).
function assTagColor(hex: string): string {
  return `&H${hexToAssBgr(hex)}&`;
}

function alignmentFor(position: SubtitleDesign["position"]): number {
  // Numpad-style ASS alignment: baris bawah 1-3, tengah 4-6, atas 7-9 (kolom
  // kiri/tengah/kanan) - kita selalu "center" (kolom tengah), cuma baris yg beda.
  if (position === "top-center") return 8;
  if (position === "middle-center") return 5;
  return 2; // "bottom-center"
}

function marginVFor(position: SubtitleDesign["position"], frameWidth: number, frameHeight: number): number {
  // Alignment tengah (5) posisinya SELALU di tengah frame apa pun MarginV-nya (spec
  // ASS) - margin cuma relevan utk atas/bawah.
  if (position === "middle-center") return 0;

  // Landscape vs portrait DIBEDAKAN (2026-08-10, bug nyata dilaporkan Agus - subtitle
  // video YouTube landscape [Animal Story & Co, 1920x1080] kelihatan tidak "di bagian
  // bawah" spt yg diminta). Rasio 760/1920 (~39.6% margin dari tepi bawah) SENGAJA
  // dipertahankan utk PORTRAIT - itu bukan angka sembarang, permintaan eksplisit Agus
  // 2026-08-05 "posisi tengah-tengah video, turunkan sedikit" (Reels/Shorts py area
  // aman platform di dekat tepi bawah [username/caption/tombol like-share IG/TikTok] -
  // margin besar itu SENGAJA menghindarinya). YouTube landscape TIDAK PUNYA overlay UI
  // spt itu - "di bagian bawah" di sana artinya BENERAN dekat tepi bawah (gaya caption
  // dokumenter/film biasa), margin jauh lebih kecil (~5.5% dari tinggi frame).
  const isLandscape = frameWidth > frameHeight;
  if (position === "top-center") {
    return Math.round(frameHeight * (isLandscape ? 40 / 1080 : 120 / 1920));
  }
  return Math.round(frameHeight * (isLandscape ? 60 / 1080 : 760 / 1920));
}

// Grouping kata mentah (flat, 1 per kata dari Whisper) jadi "burst" - kelompok kata yg
// tampil BERSAMAAN di layar (gaya TikTok: beberapa kata sekaligus, bukan 1 kata sendiri
// kosong di tengah layar). Heuristik SEDERHANA (bukan NLP/deteksi frasa) - konsisten
// dgn gaya seluruh codebase ini (count/duration based, bukan model tambahan):
// - target ~5 kata/burst (cukup utk terbaca sbg 1-2 baris, tidak terlalu ramai)
// - burst diputus LEBIH AWAL kalau ada jeda >450ms antar kata (jeda alami ucapan -
//   penanda batas frasa yg wajar dipakai walau bukan analisis linguistik sungguhan)
// - burst diputus kalau durasi terkumpul sudah >3.5dtk (jangan biarkan 1 grup nempel
//   kelamaan di layar walau kata-katanya rapat tanpa jeda)
const TARGET_WORDS_PER_BURST = 5;
const PAUSE_BREAK_SECONDS = 0.45;
const MAX_BURST_DURATION_SECONDS = 3.5;

function groupIntoBursts(words: WordTiming[]): WordTiming[][] {
  const bursts: WordTiming[][] = [];
  let current: WordTiming[] = [];

  for (const w of words) {
    if (current.length > 0) {
      const prev = current[current.length - 1];
      const gap = w.start - prev.end;
      const burstDuration = w.end - current[0].start;
      const shouldBreak =
        current.length >= TARGET_WORDS_PER_BURST ||
        gap > PAUSE_BREAK_SECONDS ||
        burstDuration > MAX_BURST_DURATION_SECONDS;
      if (shouldBreak) {
        bursts.push(current);
        current = [];
      }
    }
    current.push(w);
  }
  if (current.length > 0) bursts.push(current);
  return bursts;
}

// Pecah kata dalam 1 burst ke MAKS `maxLines` baris tampil (word-wrap kasar, bukan
// pengukuran lebar font sungguhan - level engineering yg SAMA dgn heuristik grouping di
// atas, cukup utk burst pendek 3-8 kata yg wajar dipakai gaya caption ini). Kalau
// jumlah kata sedikit (<=4) & maxLines>=2, TETAP 1 baris - jangan paksa wrap kalau
// tidak perlu, cuma bikin baris ke-2 kosong terasa aneh.
function wrapBurstIndices(burst: WordTiming[], maxLines: number): number[] {
  // breakAfterIndices = indeks kata TERAKHIR di tiap baris (kecuali baris terakhir).
  if (maxLines <= 1 || burst.length <= 4) return [];
  const linesNeeded = Math.min(maxLines, Math.ceil(burst.length / 4));
  if (linesNeeded <= 1) return [];
  const perLine = Math.ceil(burst.length / linesNeeded);
  const breaks: number[] = [];
  for (let i = perLine - 1; i < burst.length - 1; i += perLine) breaks.push(i);
  return breaks;
}

// PopIn (2026-08-10) - kata yg SEDANG diucapkan membesar dari 70% -> 100% dlm 120ms
// (bounce singkat khas caption TikTok/CapCut), warna highlight, LALU reset ke gaya
// default (\r) utk kata2 lain di baris yg sama. "None" = highlight warna saja tanpa
// animasi skala (fallback aman kalau suatu saat perlu animasi dimatikan).
function highlightTagFor(design: SubtitleDesign): string {
  const highlight = assTagColor(design.highlightColor);
  if (design.animation === "None") {
    return `{\\c${highlight}}`;
  }
  return `{\\c${highlight}\\fscx70\\fscy70\\t(0,120,\\fscx100\\fscy100)}`;
}

// Bangun 1 file .ass LENGKAP dgn efek "kata per kata" - highlight kata yg SEDANG
// diucapkan (via timing asli tiap kata dari Whisper) + animasi pop opsional. Setiap
// KATA dpt 1 Dialogue event sendiri (rentang waktu kata itu, DIPERPANJANG sampai kata
// berikutnya mulai - lihat displayEnd - supaya teks TETAP terlihat menerus tanpa
// "flicker" kosong selama jeda mikro antar kata), isinya teks SATU BARIS/BURSTNYA UTUH
// dgn HANYA kata itu yg disorot - saat playback maju kata demi kata, kesan visualnya
// adalah highlight "berjalan" mengikuti ucapan.
export function buildWordHighlightAss(
  words: WordTiming[],
  design: SubtitleDesign,
  frameWidth: number,
  frameHeight: number
): string {
  const fontSize = toFrameRatio(design.size, frameWidth);
  const outlineWidth = toFrameRatio(design.outlineWidth, frameWidth);
  const marginV = marginVFor(design.position, frameWidth, frameHeight);
  const alignment = alignmentFor(design.position);
  const shadowDepth = design.shadow ? Math.max(1, Math.round(outlineWidth / 2)) : 0;

  const header =
    `[Script Info]\nPlayResX: ${frameWidth}\nPlayResY: ${frameHeight}\nScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Default,${design.font},${fontSize},${assStyleColor(design.color)},&H000000FF,${assStyleColor(design.outline)},&H00000000,-1,0,0,0,100,100,0,0,1,${outlineWidth},${shadowDepth},${alignment},10,10,${marginV},1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  const bursts = groupIntoBursts(words);
  const highlightTag = highlightTagFor(design);
  const events: string[] = [];

  for (const burst of bursts) {
    const breaks = wrapBurstIndices(burst, design.maxLines);
    for (let i = 0; i < burst.length; i++) {
      const w = burst[i];
      const displayEnd = i < burst.length - 1 ? burst[i + 1].start : w.end;
      if (displayEnd <= w.start) continue; // jaga2 - timestamp Whisper kadang persis nempel/mundur mikro

      const text = burst
        .map((word, j) => {
          const wrapAfter = breaks.includes(j) ? "\\N" : j < burst.length - 1 ? " " : "";
          const cleanWord = word.word.replace(/[{}]/g, ""); // buang karakter yg bentrok dgn ASS override tags
          return j === i ? `${highlightTag}${cleanWord}{\\r}${wrapAfter}` : `${cleanWord}${wrapAfter}`;
        })
        .join("");

      events.push(`Dialogue: 0,${secondsToAss(w.start)},${secondsToAss(displayEnd)},Default,,0,0,0,,${text}`);
    }
  }

  return header + events.join("\n") + "\n";
}

function secondsToAss(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const centiseconds = Math.round((totalSeconds - Math.floor(totalSeconds)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

// Fallback statis (2026-08-10) - dipakai HANYA kalau word-level Whisper tidak tersedia
// (lihat processProject.ts, jalur transkripsi gagal & balik ke estimasi rata SRT lama)
// - subtitle tetap terlihat SESUAI Subtitle Designer (font/warna/outline/posisi), CUMA
// tanpa animasi kata-per-kata (seluruh baris/segmen muncul sekaligus, spt caption
// biasa) - degradasi yg wajar drpd gagal render total.
export function buildStaticAss(
  entries: Array<{ start: string; end: string; text: string }>,
  design: SubtitleDesign,
  frameWidth: number,
  frameHeight: number
): string {
  const fontSize = toFrameRatio(design.size, frameWidth);
  const outlineWidth = toFrameRatio(design.outlineWidth, frameWidth);
  const marginV = marginVFor(design.position, frameWidth, frameHeight);
  const alignment = alignmentFor(design.position);
  const shadowDepth = design.shadow ? Math.max(1, Math.round(outlineWidth / 2)) : 0;

  const header =
    `[Script Info]\nPlayResX: ${frameWidth}\nPlayResY: ${frameHeight}\nScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Default,${design.font},${fontSize},${assStyleColor(design.color)},&H000000FF,${assStyleColor(design.outline)},&H00000000,-1,0,0,0,100,100,0,0,1,${outlineWidth},${shadowDepth},${alignment},10,10,${marginV},1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = entries.map((e) => `Dialogue: 0,${e.start},${e.end},Default,,0,0,0,,${e.text}`).join("\n");
  return header + events + "\n";
}

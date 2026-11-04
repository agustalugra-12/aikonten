// Revisi VideoPlan 2026-11-05: kecocokan subjek footage vs naskah, glossary caption, analisis frame gratis
// (ketajaman + letak subjek) untuk hero & penempatan teks. Tanpa layanan berbayar: ffmpeg + aritmetika.
import { execFile } from "node:child_process";
import type { HfWord } from "@/lib/render/hyperframesComposition";

// ---------- subjek footage ----------
// Metadata subjek footage: footage_bank.description/tags (describeFootage) atau source_query Pexels.
export type FootageSubject = { description?: string; tags?: string[] };
const STOP = new Set(("yang dan di ke dari untuk dengan ini itu atau pada juga ada akan bisa lebih sangat kami kita " +
  "anda kamu dalam tak tidak sudah jadi para the a an of to in on at for with and or is are wajib coba dekat").split(" "));
// Sinonim kecil (ID/EN) supaya "kuliner" cocok dgn "makanan"/"food"; bukan NLP penuh.
const SYN: Record<string, string> = {
  kuliner: "makan", makanan: "makan", food: "makan", meal: "makan", dish: "makan", restoran: "makan", resto: "makan", warung: "makan", nasi: "makan", menu: "makan", sarapan: "makan", breakfast: "makan",
  kamar: "kamar", room: "kamar", bedroom: "kamar", bed: "kamar", tempat: "", ranjang: "kamar",
  cucian: "cuci", laundry: "cuci", baju: "pakaian", clothes: "pakaian", pakaian: "pakaian", setrika: "setrika", ironing: "setrika", washing: "cuci", lipat: "lipat", folding: "lipat",
  burung: "burung", bird: "burung", finch: "burung", seabird: "burung", birds: "burung", darah: "darah", blood: "darah",
  taman: "taman", garden: "taman", kebun: "taman", danau: "danau", lake: "danau", gunung: "gunung", mountain: "gunung",
  jemput: "antar", pickup: "antar", antar: "antar", delivery: "antar", kurir: "antar", motor: "antar",
};
export function subjectTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    const t = raw.replace(/(nya|kan|an)$/, (m) => (raw.length - m.length >= 4 ? "" : m));
    const syn = SYN[raw] ?? SYN[t];
    if (syn === "") continue;
    out.add(syn ?? t);
  }
  return out;
}
// Jumlah token subjek adegan yg ada di metadata footage (0 = tak cocok).
export function subjectScore(subject: string, f: FootageSubject | undefined): number {
  if (!f) return 0;
  const have = subjectTokens(`${f.description ?? ""} ${(f.tags ?? []).join(" ")}`);
  let n = 0;
  for (const t of subjectTokens(subject)) if (have.has(t)) n++;
  return n;
}

// ---------- glossary caption ----------
function dist(a: string, b: string): number { // Damerau-Levenshtein (transposisi) sederhana
  const d = Array.from({ length: a.length + 1 }, (_v, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");
// Toleransi: istilah ≤4 huruf harus persis; 5-9 huruf beda ≤1; ≥10 beda ≤2. Huruf pertama wajib sama
// (mencegah kata umum seperti "pelan"/"belang" berubah jadi nama brand).
function near(word: string, term: string): boolean {
  const a = norm(word), b = norm(term);
  if (!a || a === b) return a === b;
  if (b.length <= 4 || a[0] !== b[0] || Math.abs(a.length - b.length) > 1) return false;
  return dist(a, b) <= (b.length >= 10 ? 2 : 1);
}
// Ganti ejaan salah istilah glossary (nama brand, tempat, produk) pada kata caption; tanda baca dipertahankan.
export function applyGlossary(words: HfWord[], terms: string[]): { words: HfWord[]; fixed: string[] } {
  const parts = [...new Set(terms.flatMap((t) => t.split(/\s+/)).filter((x) => norm(x).length >= 3))];
  const fixed: string[] = [];
  const out = words.map((w) => {
    const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(w.word)!;
    const hit = parts.find((p) => near(m[2], p));
    if (!hit || m[2] === hit) return w;
    fixed.push(`${m[2]}->${hit}`);
    return { ...w, word: `${m[1]}${hit}${m[3]}` };
  });
  return { words: out, fixed };
}
export function fixText(s: string, terms: string[]): string {
  return applyGlossary(s.split(/(\s+)/).map((x) => ({ word: x, start: 0, end: 0 })), terms).words.map((x) => x.word).join("");
}

// ---------- analisis frame (gratis, ffmpeg) ----------
// sharp = varian Laplacian setelah frame diskalakan ke lebar output (= yang dilihat penonton; menangkap
// blur DAN resolusi rendah yg di-upscale). focus = rentang vertikal (0..1) tempat energi tepi/kontras
// terpusat (proxy subjek utama/wajah; BUKAN deteksi wajah sungguhan).
export type FrameStats = { sharp: number; y0: number; y1: number; cy: number };
export type ClipAnalysis = FrameStats & { srcW: number; srcH: number };
export function analyzeGray(px: Uint8Array, w: number, h: number): FrameStats {
  let sum = 0, sum2 = 0, n = 0;
  const rows = new Float64Array(h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const lap = px[i - 1] + px[i + 1] + px[i - w] + px[i + w] - 4 * px[i];
    sum += lap; sum2 += lap * lap; n++;
    const cx = 1 - Math.abs(x / w - 0.5); // bobot tengah horizontal (subjek biasanya di tengah)
    rows[y] += Math.abs(lap) * cx;
  }
  const mean = sum / n, sharp = sum2 / n - mean * mean;
  const tot = rows.reduce((a, b) => a + b, 0) || 1;
  let acc = 0, y0 = 0, y1 = h - 1, cyw = 0;
  for (let y = 0; y < h; y++) {
    const prev = acc; acc += rows[y]; cyw += y * rows[y];
    if (prev < tot * 0.2 && acc >= tot * 0.2) y0 = y;
    if (prev < tot * 0.8 && acc >= tot * 0.8) y1 = y;
  }
  return { sharp: Math.round(sharp * 10) / 10, y0: y0 / h, y1: y1 / h, cy: cyw / tot / h };
}
type Exec = typeof execFile;
function grab(url: string, t: number, outW: number, ffmpeg: string, ex: Exec): Promise<{ px: Uint8Array; w: number; h: number }> {
  const w = outW, h = Math.round((outW * 16) / 9 / 2) * 2;
  return new Promise((res, rej) => ex(ffmpeg, ["-v", "error", "-ss", String(t), "-i", url, "-frames:v", "1", "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=gray`, "-f", "rawvideo", "-"],
    { encoding: "buffer", maxBuffer: 64 << 20, timeout: 60_000 }, (e, out) => (e ? rej(e) : res({ px: new Uint8Array(out as unknown as Buffer), w, h }))));
}
// 3 frame (20/50/80% durasi) diskalakan ke lebar output; ambil median ketajaman & rata-rata letak subjek.
export async function analyzeClip(url: string, durationSeconds: number, opts: { outW?: number; ffmpeg?: string; exec?: Exec; probe?: { w: number; h: number } } = {}): Promise<ClipAnalysis> {
  const ex = opts.exec ?? execFile, ff = opts.ffmpeg ?? "ffmpeg", outW = opts.outW ?? 1080;
  const fr = await Promise.all([0.2, 0.5, 0.8].map((k) => grab(url, Math.max(0, durationSeconds * k), outW, ff, ex).then((g) => analyzeGray(g.px, g.w, g.h))));
  const sharp = fr.map((f) => f.sharp).sort((a, b) => a - b)[1];
  const avg = (k: "y0" | "y1" | "cy") => fr.reduce((a, f) => a + f[k], 0) / fr.length;
  return { sharp, y0: avg("y0"), y1: avg("y1"), cy: avg("cy"), srcW: opts.probe?.w ?? 0, srcH: opts.probe?.h ?? 0 };
}
// Batas ketajaman hero (varian Laplacian @1080 lebar). Dikalibrasi di fixture 2026-11-05: klip laundry
// 474x850 yg di-upscale jauh di bawah klip kamera HP 1080p. Klip di bawah batas: tak boleh hero & tampil terbingkai.
export const MIN_HERO_SHARP = 60;

// ---------- zona teks (portrait) ----------
export type Zone = "top" | "bottom";
// Rentang (0..1) yg ditempati teks per zona: top = 14-40% tinggi, bottom = 56-78%.
export const ZONE_RANGE: Record<Zone, [number, number]> = { top: [0.14, 0.4], bottom: [0.56, 0.78] };
export function zoneOverlap(z: Zone, sub: { y0: number; y1: number } | undefined): number {
  if (!sub) return 0;
  const [a, b] = ZONE_RANGE[z];
  return Math.max(0, Math.min(b, sub.y1) - Math.max(a, sub.y0));
}
// Zona yang paling sedikit menimpa subjek.
export function freeZone(sub: { y0: number; y1: number } | undefined, prefer: Zone = "bottom"): Zone {
  if (!sub) return prefer;
  const ov = (a: number, b: number) => Math.max(0, Math.min(b, sub.y1) - Math.max(a, sub.y0));
  const top = ov(0.14, 0.4), bot = ov(0.56, 0.78);
  if (Math.abs(top - bot) < 0.02) return prefer;
  return top < bot ? "top" : "bottom";
}

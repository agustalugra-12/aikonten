// Revisi VideoPlan 2026-11-05: kecocokan subjek footage vs naskah, glossary caption, analisis frame gratis
// (ketajaman + letak subjek) untuk hero & penempatan teks. Tanpa layanan berbayar: ffmpeg + aritmetika.
import { execFile } from "node:child_process";
import type { HfWord } from "@/lib/render/hyperframesComposition";

// ---------- subjek footage ----------
// Metadata subjek footage: footage_bank.description/tags (describeFootage) atau source_query Pexels.
// source: "vision" = deskripsi isi frame (footage_bank describeFootage, selalu ber-tags); "query" = hanya kata
// pencarian Pexels (isi klip TIDAK dijamin). Tanpa source: ber-tags -> vision, tanpa tags -> query.
export type FootageSubject = { description?: string; tags?: string[]; source?: "vision" | "query" };
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

// Keyakinan footage hook (revisi-3). Hook = frame pertama penonton -> wajib YAKIN cocok, kalau tidak hook desain.
// Yakin bila: (1) metadata berasal dari analisis isi frame (bukan sekadar query Pexels: klip "vampire finch"
// ternyata burung kecil di tangan), dan (2) ≥ HOOK_MIN_COVER token subjek hook ada di metadata (cocok langsung,
// bukan 1 kata umum dari subjek panjang).
export const HOOK_MIN_COVER = 0.5;
export function subjectSource(f: FootageSubject | undefined): "vision" | "query" | null {
  if (!f) return null;
  return f.source ?? (f.tags?.length ? "vision" : "query");
}
export function hookConfidence(subject: string, f: FootageSubject | undefined): { ok: boolean; reason: string } {
  const src = subjectSource(f);
  if (!src) return { ok: false, reason: "tanpa metadata" };
  if (src === "query") return { ok: false, reason: "metadata hanya query pencarian" };
  const need = subjectTokens(subject).size, got = subjectScore(subject, f);
  if (!need || !got) return { ok: false, reason: "subjek tak cocok" };
  return got / need >= HOOK_MIN_COVER ? { ok: true, reason: `cocok ${got}/${need}` } : { ok: false, reason: `cocok lemah ${got}/${need}` };
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
// Gaya huruf kata asli diterapkan ke ejaan istilah: HURUF BESAR semua tetap besar, huruf kecil semua tetap
// kecil, Kapital-awal tetap Kapital-awal. Dipakai utk koreksi ejaan bagian istilah (bukan istilah utuh).
function styleLike(orig: string, part: string): string {
  if (orig.length > 1 && orig === orig.toUpperCase()) return part.toUpperCase();
  if (orig === orig.toLowerCase()) return part.toLowerCase();
  return part[0].toUpperCase() + part.slice(1).toLowerCase();
}
// Ejaan istilah dianggap resmi (boleh mengubah huruf besar/kecil) hanya bila campuran ("Laundry in Bali",
// "Bedugul"); istilah huruf kecil semua (nama DB) atau BESAR semua (mark) hanya mengoreksi ejaan.
const casingOf = (t: string) => t !== t.toLowerCase() && t !== t.toUpperCase();
// Glossary (revisi-3): kapitalisasi HANYA utk istilah UTUH. "nasi tempong" -> "Nasi Tempong", "nasi" saja tetap
// "nasi", "homestay" saja tetap "homestay". Kata yg salah eja dari bagian istilah multi-kata ("pelani") dikoreksi
// ejaannya tapi gaya hurufnya ikut kata asli ("pelangi"). Kata ditulis BESAR semua (gaya) tak diubah kapitalnya.
export function applyGlossary(words: HfWord[], terms: string[]): { words: HfWord[]; fixed: string[] } {
  const seen = new Set<string>();
  const T = terms.map((t) => t.trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .map((t) => ({ parts: t.split(/\s+/), cased: casingOf(t) })).sort((a, b) => b.parts.length - a.parts.length);
  const sp = words.map((w) => /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(w.word)!);
  const out = words.map((w) => ({ ...w }));
  const fixed: string[] = [];
  const put = (i: number, core: string) => {
    if (core === sp[i][2]) return;
    fixed.push(`${sp[i][2]}->${core}`);
    out[i].word = `${sp[i][1]}${core}${sp[i][3]}`;
  };
  for (let i = 0; i < words.length;) {
    // Istilah utuh: semua bagian berurutan cocok (ejaan ≈), tanda baca hanya di kata terakhir.
    const t = T.find(({ parts }) => parts.every((p, j) => i + j < words.length && near(sp[i + j][2], p) && (j === parts.length - 1 || !sp[i + j][3]) && (j === 0 || !sp[i + j][1])));
    if (t) {
      t.parts.forEach((p, j) => {
        const o = sp[i + j][2], allCaps = o.length > 1 && o === o.toUpperCase();
        // Ejaan benar & hanya beda huruf: ubah hanya bila istilah ber-ejaan resmi dan kata tak ditulis BESAR semua.
        put(i + j, norm(o) === norm(p) ? (t.cased && !allCaps ? p : o) : t.cased && !allCaps ? p : styleLike(o, p));
      });
      i += t.parts.length; continue;
    }
    // Bagian istilah: kata SALAH-EJA (near-miss) yg cocok sebuah bagian istilah dikoreksi ejaan DAN mengambil
    // kapitalisasi KANONIK istilah ber-casing ("pelani"->"Pelangi", "homstay"->"Homestay"). Kata ditulis BESAR
    // semua (gaya mark) hanya dikoreksi ejaan. Kata yg ejaannya sudah benar (beda kapital saja) TIDAK masuk sini
    // (norm sama) -> kata umum "nasi"/"homestay" tetap. Istilah 1 kata ditangani cabang istilah utuh di atas.
    const o = sp[i][2], allCaps = o.length > 1 && o === o.toUpperCase();
    const hit = T.filter((x) => x.parts.length > 1).flatMap((x) => x.parts.map((q) => ({ q, cased: x.cased }))).find(({ q }) => norm(o) !== norm(q) && near(o, q));
    if (hit) put(i, hit.cased && !allCaps ? hit.q : styleLike(o, hit.q));
    i++;
  }
  return { words: out, fixed };
}
// Nama resmi brand utk tampilan/glossary: nama di DB yg huruf kecil semua ("laundry in bali") di-title-case;
// kata sambung ≤2 huruf tetap kecil kecuali di awal ("Laundry in Bali"). Nama ber-kapital dipakai apa adanya.
export function officialName(name: string | undefined): string | undefined {
  if (!name || name !== name.toLowerCase()) return name;
  return name.replace(/\S+/g, (x, i: number) => (i > 0 && x.length <= 2 ? x : x[0].toUpperCase() + x.slice(1)));
}
export function fixText(s: string, terms: string[]): string {
  const tok = s.split(/(\s+)/); // [kata, spasi, kata, ...] -> istilah multi-kata dicocokkan antar kata, spasi asli dipertahankan
  const fixedWords = applyGlossary(tok.filter((_x, i) => i % 2 === 0).map((x) => ({ word: x, start: 0, end: 0 })), terms).words;
  return tok.map((x, i) => (i % 2 === 0 ? fixedWords[i / 2].word : x)).join("");
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
// QC footage tampil: area tengah frame render (25-75% lebar, 30-70% tinggi) tak boleh nyaris seragam (latar
// gradasi kosong). std = simpangan baku luma; edge = rerata |Laplacian|. Footage asli >> ambang; gradasi ~0.
export function centerTexture(px: Uint8Array, w: number, h: number): { std: number; edge: number; ok: boolean } {
  let s = 0, s2 = 0, e = 0, n = 0;
  for (let y = Math.round(h * 0.3); y < Math.round(h * 0.7); y++) for (let x = Math.round(w * 0.25); x < Math.round(w * 0.75); x++) {
    const i = y * w + x, v = px[i];
    s += v; s2 += v * v; e += Math.abs(px[i - 1] + px[i + 1] + px[i - w] + px[i + w] - 4 * v); n++;
  }
  const std = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)), edge = e / n;
  return { std: Math.round(std * 10) / 10, edge: Math.round(edge * 100) / 100, ok: std >= 12 && edge >= 1.5 };
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
// Ketajaman (varian Laplacian @1080 lebar). Hero dinilai RELATIF thd footage yg tersedia (nilai absolut beda
// jauh antar sumber: fixture 2026-11-05 hospitality 13-109, laundry 2-16, animal 6-22): klip "buram" bila
// < BLUR_REL x klip tertajam; buram tak boleh hero (boleh jadi pendukung). MIN_FRAME_SHARP (absolut) hanya
// menandai klip yg tampil terbingkai (resolusi rendah/upscale, tanpa Ken Burns).
export const BLUR_REL = 0.5;
export const MIN_FRAME_SHARP = 60;
export function isBlurry(sharp: number | undefined, best: number): boolean {
  return sharp !== undefined && sharp < BLUR_REL * best;
}

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

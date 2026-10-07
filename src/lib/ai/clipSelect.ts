import type { TranscriptSegment } from "./transcribe";

export type ScoredFields = {
  keywordScore: number;
  clarityScore: number;
  durationScore: number;
  combinedScore: number;
};

export type ScoredSegment = TranscriptSegment & ScoredFields;

// Target durasi & rasio footage asli:Pexels (2026-08-05, permintaan Agus - "vidio
// minimal 30-60 detik", "perbandingan footage 7:3 utk footage pelangi dan pexels").
// Dipakai bareng oleh processProject.ts (budget klip asli) & destinationBroll.ts
// (budget klip Pexels) supaya SATU angka target, bukan dihitung terpisah di 2 tempat.
//
// Diparameterisasi (2026-08-05, sesi sama - permintaan Agus "durasi konten video
// misal video 30 detik 60 detik dan 1.30") - SEBELUMNYA konstanta tetap (45s, satu2nya
// pilihan), SEKARANG setting per-brand (brands.videoDurationTarget, 30/60/90) yg
// diteruskan sbg parameter `target` ke fungsi2 di bawah. DEFAULT_VIDEO_DURATION_TARGET
// dipertahankan sbg fallback kalau brand belum di-set (row lama sblm migrasi 0012).
export const DEFAULT_VIDEO_DURATION_TARGET = 45; // detik - titik tengah rentang 30-60 lama
export const REAL_FOOTAGE_RATIO = 0.7;

export type DurationConfig = {
  target: number;
  // Aturan MINIMUM WAJIB (2026-08-06, dilonggarkan - permintaan Agus "buat kelonggaran
  // jika hasil generat vidio tidak sampe 60 detik tidak apa asalkan masih dalam 30-60
  // rangenya masih bisa uploud") - SEBELUMNYA target-5 (target 60 -> min 55, terlalu
  // ketat, sering gagal krn footage bank belum cukup besar - lihat kasus nyata "Foto
  // parkir" gagal 45dtk/perlu 55dtk hari yg sama). Kembali ke rentang ASLI Agus dari
  // awal fitur ini ("vidio minimal 30-60 detik", lihat DEFAULT_VIDEO_DURATION_TARGET) -
  // separuh dari target, bukan target-5 - target 60 -> min 30 PERSIS spt diminta,
  // diskalakan proporsional utk target lain (target 90 -> min 45, dst) drpd hardcode
  // cuma utk 60. processProject.ts tetap nge-top-up klip (asli dulu, baru B-roll)
  // sampai target semaksimal mungkin, cuma AMBANG GAGAL-nya yg lebih longgar sekarang.
  min: number;
  realBudgetSeconds: number;
  stockBudgetSeconds: number;
};

export function getDurationConfig(target: number = DEFAULT_VIDEO_DURATION_TARGET): DurationConfig {
  return {
    target,
    min: Math.max(10, Math.round(target * 0.5)),
    realBudgetSeconds: target * REAL_FOOTAGE_RATIO,
    stockBudgetSeconds: target * (1 - REAL_FOOTAGE_RATIO),
  };
}

// Rasio KHUSUS "konten wisata dekat Pelangi Homestay" (2026-08-05, permintaan Agus -
// "jika konten wisata dekat pelangi homestay pakai footage pexels 60% footage pelangi
// 40%") - KEBALIKAN dari rasio default di atas. Skrip yg MENYEBUT landmark wisata
// (Danau Beratan, Kebun Raya, dst - lihat destinationBroll.ts DESTINATION_QUERIES)
// dianggap "konten wisata": video ini fokusnya destinasi itu sendiri, jadi footage
// stok destinasi wajar LEBIH DOMINAN drpd footage properti - beda dari video promosi
// properti biasa (rasio default 7:3 Pelangi:Pexels tetap berlaku kalau skrip TIDAK
// menyebut landmark spesifik).
export const DESTINATION_STOCK_RATIO = 0.6;

// footageSource "internal" (2026-08-21, permintaan Agus - Harmoni Hills 100% footage
// bank sendiri, NOL Pexels/Pixabay) - stockBudget 0 & realBudget = target penuh.
export function computeFootageBudgets(
  isDestinationContent: boolean,
  target: number = DEFAULT_VIDEO_DURATION_TARGET,
  footageSource: "mixed" | "internal" | "pexels" = "mixed"
): {
  realBudgetSeconds: number;
  stockBudgetSeconds: number;
} {
  // (2026-10-01) pexels-only: 0 footage asli, seluruh durasi dari stok Pexels.
  if (footageSource === "pexels") return { realBudgetSeconds: 0, stockBudgetSeconds: target };
  if (footageSource === "internal") {
    return { realBudgetSeconds: target, stockBudgetSeconds: 0 };
  }
  const stockRatio = isDestinationContent ? DESTINATION_STOCK_RATIO : 1 - REAL_FOOTAGE_RATIO;
  return {
    realBudgetSeconds: target * (1 - stockRatio),
    stockBudgetSeconds: target * stockRatio,
  };
}

const STOPWORDS = new Set([
  "yang", "dan", "di", "ke", "dari", "ini", "itu", "untuk", "dengan", "pada", "adalah",
  "atau", "juga", "akan", "saya", "kita", "kami", "kamu", "dia", "mereka", "ada", "tidak",
  "sudah", "belum", "bisa", "harus", "the", "a", "an", "is", "are", "and", "or", "to",
  "of", "in", "for", "on", "with", "this", "that",
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

// Heuristik deterministik (BUKAN model AI menilai kualitas visual - lihat PRD diskusi:
// "penilaian visual" itu spekulatif/berisiko tinggi, jadi v1 pakai pendekatan yang bisa
// diandalkan: cocokkan transkrip ke skrip + preferensi durasi + kejelasan audio).
// Tetap 100% otomatis (Agus minta zero-touch), cuma metodenya lebih sederhana & bisa
// ditingkatkan nanti kalau hasilnya kurang bagus.
const WEIGHTS = { keyword: 0.5, clarity: 0.2, duration: 0.3 };
// Diperketat 2026-07-31 atas permintaan eksplisit Agus: potongan cepat (3-5 detik per
// footage) drpd durasi lama - sebelumnya [3,15] terlalu longgar utk gaya edit
// cepat/reels. Cap keras 5 detik ditegakkan di selectClips (di bawah), bukan cuma lewat
// scoring - biar TIDAK bergantung skor lain (mis. keyword match tinggi) meloloskan klip
// lama.
const IDEAL_DURATION_RANGE: [number, number] = [3, 5]; // detik per klip
export const MAX_CLIP_DURATION = 5;

function scoreDuration(durationSeconds: number): number {
  const [min, max] = IDEAL_DURATION_RANGE;
  if (durationSeconds >= min && durationSeconds <= max) return 1;
  if (durationSeconds < min) return durationSeconds / min;
  return Math.max(0, 1 - (durationSeconds - max) / max);
}

function scoreClarity(avgLogprob: number): number {
  // avg_logprob biasa di rentang -1 (kurang jelas) s.d. 0 (jelas) - clamp & normalisasi.
  const clamped = Math.max(-1, Math.min(0, avgLogprob));
  return clamped + 1;
}

// Generic <T> (2026-08-05, permintaan Agus - "dominasi footage Pelangi" perlu >1 file
// footage asli digabung dlm 1 video, bukan cuma 1 spt sebelumnya) - segmen dari BANYAK
// file transkrip berbeda perlu ditandai file asalnya (sourceUrl) supaya renderFinalVideo
// tahu tiap klip harus diambil dari file MANA saat splice. scoreSegments/selectClips
// TIDAK PERLU tahu soal sourceUrl secara eksplisit - generic <T extends TranscriptSegment>
// otomatis MEMPERTAHANKAN field tambahan apa pun yg sudah ditempel pemanggil sebelum
// dipanggil (spread ...seg), termasuk sourceUrl kalau ada.
export function scoreSegments<T extends TranscriptSegment>(segments: T[], script: string): (T & ScoredFields)[] {
  const scriptWords = significantWords(script);

  return segments.map((seg) => {
    const segWords = significantWords(seg.text);
    let overlap = 0;
    for (const w of segWords) {
      if (scriptWords.has(w)) overlap += 1;
    }
    const keywordScore = segWords.size > 0 ? overlap / segWords.size : 0;
    const clarityScore = scoreClarity(seg.avgLogprob);
    const durationScore = scoreDuration(seg.end - seg.start);
    const combinedScore =
      WEIGHTS.keyword * keywordScore + WEIGHTS.clarity * clarityScore + WEIGHTS.duration * durationScore;

    return { ...seg, keywordScore, clarityScore, durationScore, combinedScore };
  });
}

// Ambang skor minimum (2026-07-30, bug nyata ditemukan via tes sintetis sebelum dipakai
// live: threshold lama "combinedScore <= 0" nyaris tidak pernah kena krn clarity/duration
// saja sudah selalu kasih skor positif kecil, jadi segmen tidak relevan/tidak jelas ikut
// terpilih HANYA demi mengejar target durasi. Lebih baik video final lebih pendek dari
// target drpd diisi filler yg tidak nyambung - ini krusial krn tidak ada review manual
// sama sekali (full-auto, lihat PRD diskusi), jadi kualitas filter di sini yang jadi
// satu-satunya jaring pengaman sebelum konten keluar ke publik.
const MIN_SCORE_THRESHOLD = 0.35;

// Pilih klip terbaik secara greedy sampai target durasi tercapai ATAU kehabisan segmen
// yang skornya di atas ambang minimum, lalu urutkan ULANG kronologis (bukan urutan skor)
// supaya alur video tetap natural, bukan loncat-loncat acak sesuai skor. `segments` boleh
// gabungan dari BANYAK file footage asli sekaligus (lihat catatan generic <T> di atas) -
// fungsi ini sendiri tidak peduli itu 1 atau banyak file, cuma proses skor+pilih.
export function selectClips<T extends TranscriptSegment>(
  segments: T[],
  script: string,
  targetDurationSeconds: number = getDurationConfig().realBudgetSeconds
): (T & ScoredFields)[] {
  const scored = scoreSegments(segments, script);
  const byScoreDesc = [...scored].sort((a, b) => b.combinedScore - a.combinedScore);

  const selected: (T & ScoredFields)[] = [];
  let totalDuration = 0;
  for (const seg of byScoreDesc) {
    if (totalDuration >= targetDurationSeconds) break;
    if (seg.combinedScore < MIN_SCORE_THRESHOLD) continue;
    // Cap keras 5 detik (lihat MAX_CLIP_DURATION) - potong DURASInya saja (end
    // dimundurkan), teks transkrip tetap utuh krn cuma dipakai sbg konteks caption,
    // bukan ditampilkan literal per-klip lagi (subtitle final sekarang dari caption,
    // lihat buildCaptionSrt).
    const cappedEnd = Math.min(seg.end, seg.start + MAX_CLIP_DURATION);
    const capped = { ...seg, end: cappedEnd };
    selected.push(capped);
    totalDuration += cappedEnd - seg.start;
  }

  // Fallback (2026-08-05, ditemukan lewat tes live - footage asli B-roll TANPA narasi
  // jelas [mis. rekaman jalan setapak diam] selalu skor combinedScore-nya di bawah
  // MIN_SCORE_THRESHOLD, jadi selected KOSONG total & video final jadi 100% Pexels,
  // 0% footage asli - berlawanan dgn permintaan Agus "kebanyakan akan menggunakan
  // footage asli"). Ambang MIN_SCORE_THRESHOLD sengaja dibuat ketat dulu krn WAKTU ITU
  // tidak ada review manual sama sekali sblm publish - sekarang SUDAH ada Draft Review
  // (2026-08-04), jadi klip di bawah ambang tidak lagi otomatis tayang tanpa dicek,
  // aman diberi fallback: kalau TIDAK ADA satu pun klip lolos ambang tapi transkrip
  // punya isi, tetap sertakan klip dgn skor TERTINGGI (walau di bawah ambang) drpd nol
  // footage asli sama sekali.
  if (selected.length === 0 && byScoreDesc.length > 0) {
    const best = byScoreDesc[0];
    const cappedEnd = Math.min(best.end, best.start + MAX_CLIP_DURATION);
    selected.push({ ...best, end: cappedEnd });
  }

  return selected.sort((a, b) => a.start - b.start);
}

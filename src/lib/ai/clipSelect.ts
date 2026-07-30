import type { TranscriptSegment } from "./transcribe";

export type ScoredSegment = TranscriptSegment & {
  keywordScore: number;
  clarityScore: number;
  durationScore: number;
  combinedScore: number;
};

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
const IDEAL_DURATION_RANGE: [number, number] = [3, 15]; // detik per klip

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

export function scoreSegments(segments: TranscriptSegment[], script: string): ScoredSegment[] {
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
// supaya alur video tetap natural, bukan loncat-loncat acak sesuai skor.
export function selectClips(
  segments: TranscriptSegment[],
  script: string,
  targetDurationSeconds = 45
): ScoredSegment[] {
  const scored = scoreSegments(segments, script);
  const byScoreDesc = [...scored].sort((a, b) => b.combinedScore - a.combinedScore);

  const selected: ScoredSegment[] = [];
  let totalDuration = 0;
  for (const seg of byScoreDesc) {
    if (totalDuration >= targetDurationSeconds) break;
    if (seg.combinedScore < MIN_SCORE_THRESHOLD) continue;
    selected.push(seg);
    totalDuration += seg.end - seg.start;
  }

  return selected.sort((a, b) => a.start - b.start);
}

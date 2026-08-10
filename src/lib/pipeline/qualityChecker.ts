import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Quality Checker (2026-08-10, PRD "AI Content Editing Engine" section 32) - jaring
// pengaman TERAKHIR sebelum project ditandai "ready" (tampil di Draft Review, BISA
// auto-publish). Dibangun LANGSUNG setelah insiden nyata hari ini: 3 video Animal
// Story & Co dgn narasi rusak (163 detik SUNYI - bug voiceover baca caption SEO,
// SUDAH diperbaiki di sumbernya tapi 3 video LAMA yg terlanjur rusak sempat ke-publish
// otomatis begitu koneksi native YouTube tersambung, krn TIDAK ADA pemeriksaan
// otomatis yg menahannya). Cek ini murni TEKNIS (durasi/silence/aset ada-tidaknya) -
// BUKAN cek kualitas konten/kreatif (itu ranah review manual Agus di Draft Review).
//
// 2026-08-10 (lanjutan) - PRD section 32 sebenarnya minta 8 pemeriksaan, v1 di atas
// cuma implementasi 2 (durasi+silence). Ditambah di sini: audio kepelanan (mean
// volume), footage kosong/hitam (blackdetect), subtitle kosong, subtitle kepanjangan
// (baris SRT >2x batas wajar burst ASS - lihat subtitleDesign.ts). "Transisi gagal"/
// "logo hilang" dari PRD SENGAJA tidak diimplementasi sbg cek video-analysis terpisah
// (butuh computer vision, bukan proporsional) - keduanya sudah punya jaring pengaman
// lain: logo cuma dilewati kalau brand.logoUrl kosong (lihat ffmpeg.ts, bukan "hilang"
// tak sengaja), transisi dibangun deterministik dari AI Director (tidak ada jalur
// gagal-diam - filter_complex error akan melempar exception render, bukan lolos diam2).
export type QualityCheckResult = {
  passed: boolean;
  issues: string[];
};

// Ambang sunyi (2026-08-10) - >8 detik sunyi BERTURUT-TURUT dianggap cacat (jeda wajar
// antar kalimat narasi TTS biasanya <2dtk, 8dtk jauh di atas itu - insiden asli 163dtk
// jauh melebihi ambang ini, margin aman dari false-positive jeda wajar).
const MAX_SILENCE_SECONDS = 8;

// Ambang audio kepelanan (2026-08-10) - mean_volume dari ffmpeg volumedetect. Video
// normal (narasi TTS + musik latar ter-duck) biasanya mean_volume di kisaran -20dB
// s/d -14dB. -35dB dipilih sbg ambang (BUKAN sama dgn threshold silencedetect di atas
// yg mengukur noise floor per-frame) - jauh di bawah kisaran wajar, menangkap kasus
// audio ke-mute/gain salah TANPA silencedetect ikut trigger (mis. audio pelan TAPI
// terus-menerus, bukan jeda diam).
const MIN_MEAN_VOLUME_DB = -35;

// Ambang footage kosong/hitam (2026-08-10) - blackdetect d=1 (min 1dtk hitam SOLID,
// pic_th=0.98 -> 98% piksel gelap) baru dihitung "black frame". Kumulatif >2dtk
// dianggap cacat (footage gagal dimuat/klip corrupt umumnya menghasilkan hitam PENUH
// beberapa detik, BUKAN cuma adegan gelap sesaat yg wajar ada di footage asli).
const MAX_BLACK_SECONDS = 2;

// Ambang panjang baris subtitle (2026-08-10) - burst ASS di-wrap maks 2 baris
// (DEFAULT_SUBTITLE_DESIGN.maxLines, lihat subtitleDesign.ts), tapi ITU logika
// wrap-per-burst kata, bukan validasi kalimat SRT sumber. Di sini cek kasar di level
// SRT MENTAH (sebelum di-burst): 1 baris SRT >140 karakter mengindikasikan caption
// generator gagal memecah kalimat (akan menghasilkan burst yg sangat padat/terlalu
// cepat dibaca), bukan angka presisi UI - cukup utk menangkap kasus ekstrem.
const MAX_SRT_LINE_CHARS = 140;

async function detectLongestSilence(videoUrl: string): Promise<number> {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    ["-i", videoUrl, "-af", `silencedetect=noise=-35dB:d=${MAX_SILENCE_SECONDS}`, "-f", "null", "-"],
    { maxBuffer: 1024 * 1024 * 16 }
  ).catch((err) => ({ stderr: err.stderr || "", stdout: "" }));

  const durations = [...stderr.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  return durations.length > 0 ? Math.max(...durations) : 0;
}

async function detectMeanVolume(videoUrl: string): Promise<number | null> {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    ["-i", videoUrl, "-af", "volumedetect", "-f", "null", "-"],
    { maxBuffer: 1024 * 1024 * 16 }
  ).catch((err) => ({ stderr: err.stderr || "", stdout: "" }));

  const match = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  return match ? parseFloat(match[1]) : null;
}

async function detectTotalBlackSeconds(videoUrl: string): Promise<number> {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    ["-i", videoUrl, "-vf", "blackdetect=d=1:pic_th=0.98", "-an", "-f", "null", "-"],
    { maxBuffer: 1024 * 1024 * 16 }
  ).catch((err) => ({ stderr: err.stderr || "", stdout: "" }));

  const durations = [...stderr.matchAll(/black_duration:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  return durations.reduce((sum, d) => sum + d, 0);
}

// Cek subtitle di level SRT MENTAH (sebelum jadi .ass) - dipanggil sblm render
// selesai butuh koneksi jaringan, jadi murni sinkron/string parsing, cepat.
function checkSrtContent(srtContent: string): string[] {
  const issues: string[] = [];
  const trimmed = srtContent.trim();
  if (trimmed.length === 0) {
    issues.push("Subtitle kosong (SRT tidak berisi caption sama sekali)");
    return issues;
  }
  const lines = trimmed.split("\n");
  const overlyLong = lines.find((l) => l.length > MAX_SRT_LINE_CHARS);
  if (overlyLong) {
    issues.push(
      `Ada baris subtitle >${MAX_SRT_LINE_CHARS} karakter (kemungkinan gagal dipecah per-kalimat, caption akan terlalu padat)`
    );
  }
  return issues;
}

// Dipanggil SETELAH render final selesai (processProject.ts) - videoUrl SUDAH live di
// R2, minDurationSeconds dari durationConfig.min yg sudah dipakai konsisten di seluruh
// pipeline (bukan angka baru terpisah). srtContent OPSIONAL (caller lama/tanpa
// subtitle presisi tetap bisa panggil tanpa cek subtitle - lihat processProject.ts).
export async function runVideoQualityChecks(
  videoUrl: string,
  actualDurationSeconds: number,
  minDurationSeconds: number,
  srtContent?: string
): Promise<QualityCheckResult> {
  const issues: string[] = [];

  if (actualDurationSeconds < minDurationSeconds) {
    issues.push(`Durasi video ${Math.round(actualDurationSeconds)}dtk di bawah minimum ${minDurationSeconds}dtk`);
  }

  if (srtContent !== undefined) {
    issues.push(...checkSrtContent(srtContent));
  }

  try {
    const longestSilence = await detectLongestSilence(videoUrl);
    if (longestSilence > 0) {
      issues.push(
        `Ada jeda sunyi ${Math.round(longestSilence)} detik di audio (narasi kemungkinan terputus/tidak menutupi seluruh video)`
      );
    }
  } catch (err) {
    // Gagal cek TIDAK BOLEH menggagalkan project (mis. ffmpeg sesaat error) - dicatat
    // sbg issue tapi video tetap lanjut, drpd macet total krn pemeriksaan tambahan.
    issues.push(`Gagal menjalankan cek silence: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const meanVolume = await detectMeanVolume(videoUrl);
    if (meanVolume !== null && meanVolume < MIN_MEAN_VOLUME_DB) {
      issues.push(`Volume audio terlalu pelan (rata-rata ${meanVolume.toFixed(1)}dB, di bawah ambang ${MIN_MEAN_VOLUME_DB}dB)`);
    }
  } catch (err) {
    issues.push(`Gagal menjalankan cek volume: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const totalBlack = await detectTotalBlackSeconds(videoUrl);
    if (totalBlack > MAX_BLACK_SECONDS) {
      issues.push(`Ada ${Math.round(totalBlack)} detik layar hitam total (footage kemungkinan gagal dimuat/corrupt)`);
    }
  } catch (err) {
    issues.push(`Gagal menjalankan cek footage kosong: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { passed: issues.length === 0, issues };
}

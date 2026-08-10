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
export type QualityCheckResult = {
  passed: boolean;
  issues: string[];
};

// Ambang sunyi (2026-08-10) - >8 detik sunyi BERTURUT-TURUT dianggap cacat (jeda wajar
// antar kalimat narasi TTS biasanya <2dtk, 8dtk jauh di atas itu - insiden asli 163dtk
// jauh melebihi ambang ini, margin aman dari false-positive jeda wajar).
const MAX_SILENCE_SECONDS = 8;

async function detectLongestSilence(videoUrl: string): Promise<number> {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    ["-i", videoUrl, "-af", `silencedetect=noise=-35dB:d=${MAX_SILENCE_SECONDS}`, "-f", "null", "-"],
    { maxBuffer: 1024 * 1024 * 16 }
  ).catch((err) => ({ stderr: err.stderr || "", stdout: "" }));

  const durations = [...stderr.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  return durations.length > 0 ? Math.max(...durations) : 0;
}

// Dipanggil SETELAH render final selesai (processProject.ts) - videoUrl SUDAH live di
// R2, minDurationSeconds dari durationConfig.min yg sudah dipakai konsisten di seluruh
// pipeline (bukan angka baru terpisah).
export async function runVideoQualityChecks(
  videoUrl: string,
  actualDurationSeconds: number,
  minDurationSeconds: number
): Promise<QualityCheckResult> {
  const issues: string[] = [];

  if (actualDurationSeconds < minDurationSeconds) {
    issues.push(`Durasi video ${Math.round(actualDurationSeconds)}dtk di bawah minimum ${minDurationSeconds}dtk`);
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

  return { passed: issues.length === 0, issues };
}

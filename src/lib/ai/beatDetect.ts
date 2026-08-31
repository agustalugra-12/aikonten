import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { runFfmpeg } from "@/lib/render/ffmpegExec";

// Music Beat Sync (2026-08-10, PRD "AI Content Editing Engine" Roadmap V3) - deteksi
// beat MURNI lokal (ffmpeg decode + energy-based peak-picking di JS), TIDAK ADA library
// audio-analysis eksternal (librosa/madmom dst - itu Python, stack ini Node) & TIDAK
// ADA panggilan API berbayar (beat detection bukan tugas yg butuh LLM). Algoritma
// "Simple Sound Energy" klasik (instantaneous energy per window dibanding rata2
// berjalan) - BUKAN riset BPM presisi, cukup utk menangkap HANTAMAN kuat (kick/bass)
// dlm musik latar Music Bank, yg itulah yg sebenarnya dibutuhkan (nyelaraskan momen
// visual ke pukulan kuat, bukan hitung BPM sempurna).
export type BeatDetectionResult = {
  beatTimestamps: number[]; // detik, urut kronologis
  firstBeatSeconds: number | null; // null kalau sama sekali tidak ada beat terdeteksi
};

const SAMPLE_RATE = 11025; // rendah SENGAJA - beat/bass ada di frekuensi rendah, resolusi tinggi tidak perlu, decode+proses lebih cepat & file mentah lebih kecil
const WINDOW_SAMPLES = Math.round(SAMPLE_RATE * 0.05); // window energi ~50ms
const MIN_BEAT_INTERVAL_SECONDS = 0.25; // cap ~240 BPM - cegah 1 hantaman kepecah jadi banyak "beat" krn noise di puncaknya
const ENERGY_HISTORY_SECONDS = 1.0; // rata2 berjalan energi dihitung dari 1dtk sebelumnya
const ENERGY_THRESHOLD_MULTIPLIER = 1.3; // energi instan wajib >1.3x rata2 berjalan spy dianggap "beat" (bukan cuma variasi wajar)

// Decode ke PCM mono mentah via ffmpeg (2026-08-10) - jauh lebih murah/cepat drpd decode
// penuh + FFT (tidak butuh presisi frekuensi, cuma amplop energi kasar), file kecil krn
// sample rate SANGAT rendah (11025Hz cukup utk nangkap energi bass/kick, jauh di bawah
// frekuensi tinggi yg tidak relevan utk beat).
async function decodeToRawPcm(audioUrl: string): Promise<Buffer> {
  const workDir = await mkdtemp(path.join(tmpdir(), "kontenpilot_beat_"));
  try {
    const outPath = path.join(workDir, "audio.raw");
    // Fase 3 (2026-08-31): via wrapper ffmpegExec (cgroup+timeout util+semaphore) -
    // dulu execFileAsync telanjang. Argumen decode SAMA PERSIS; kegagalan tetap
    // ditangkap caller (detectBeats) & dianggap "tanpa beat sync" seperti biasa.
    await runFfmpeg([
      "-y", "-i", audioUrl,
      "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-acodec", "pcm_s16le",
      outPath,
    ], "util");
    return await readFile(outPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// Deteksi beat dari URL musik (2026-08-10) - `maxDurationSeconds` opsional, batasi
// analisis ke durasi video (musik Music Bank sering lebih panjang dari video, tidak
// perlu decode+proses seluruh file kalau cuma beberapa detik pertama yg relevan).
export async function detectBeats(audioUrl: string, maxDurationSeconds?: number): Promise<BeatDetectionResult> {
  let pcmBuffer: Buffer;
  try {
    pcmBuffer = await decodeToRawPcm(audioUrl);
  } catch (err) {
    console.error("[beatDetect] gagal decode audio, tanpa beat sync:", err);
    return { beatTimestamps: [], firstBeatSeconds: null };
  }

  const totalSamples = Math.floor(pcmBuffer.length / 2); // 16-bit = 2 byte/sample
  const maxSamples = maxDurationSeconds ? Math.min(totalSamples, Math.round(maxDurationSeconds * SAMPLE_RATE)) : totalSamples;
  const numWindows = Math.floor(maxSamples / WINDOW_SAMPLES);
  if (numWindows < 4) return { beatTimestamps: [], firstBeatSeconds: null }; // audio terlalu pendek utk analisis berarti

  // Energi (sum of squares) per window - proxy volume/amplitudo instan, standar utk
  // deteksi beat energy-based (hantaman kuat = lonjakan energi tiba2).
  const windowEnergies: number[] = new Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    let sum = 0;
    const start = w * WINDOW_SAMPLES;
    for (let i = 0; i < WINDOW_SAMPLES; i++) {
      const sample = pcmBuffer.readInt16LE((start + i) * 2);
      sum += sample * sample;
    }
    windowEnergies[w] = sum / WINDOW_SAMPLES;
  }

  const windowsPerSecond = SAMPLE_RATE / WINDOW_SAMPLES;
  const historyWindows = Math.round(ENERGY_HISTORY_SECONDS * windowsPerSecond);
  const minGapWindows = Math.round(MIN_BEAT_INTERVAL_SECONDS * windowsPerSecond);

  const beatWindowIndices: number[] = [];
  let lastBeatWindow = -Infinity;
  for (let w = 0; w < numWindows; w++) {
    const histStart = Math.max(0, w - historyWindows);
    if (w - histStart < 4) continue; // belum cukup histori di awal file
    let histSum = 0;
    for (let h = histStart; h < w; h++) histSum += windowEnergies[h];
    const localAverage = histSum / (w - histStart);
    if (localAverage <= 0) continue;
    const isPeak = windowEnergies[w] > localAverage * ENERGY_THRESHOLD_MULTIPLIER;
    const gapOk = w - lastBeatWindow >= minGapWindows;
    if (isPeak && gapOk) {
      beatWindowIndices.push(w);
      lastBeatWindow = w;
    }
  }

  const beatTimestamps = beatWindowIndices.map((w) => w / windowsPerSecond);
  return { beatTimestamps, firstBeatSeconds: beatTimestamps.length > 0 ? beatTimestamps[0] : null };
}

// Cari beat TERDEKAT dari waktu target, dlm batas toleransi (2026-08-10) - dipakai utk
// "snap" momen visual (mis. sticker flash) ke beat asli tanpa geser lebih dari
// toleransi (mencegah snap ke beat yg jauh/tidak relevan kalau kebetulan tidak ada
// beat dekat target).
export function nearestBeat(beats: number[], targetSeconds: number, toleranceSeconds: number): number | null {
  let closest: number | null = null;
  let closestDist = Infinity;
  for (const b of beats) {
    const dist = Math.abs(b - targetSeconds);
    if (dist < closestDist) {
      closestDist = dist;
      closest = b;
    }
  }
  return closest !== null && closestDist <= toleranceSeconds ? closest : null;
}

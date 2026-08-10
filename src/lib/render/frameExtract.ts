import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";

const execFileAsync = promisify(execFile);

// Thumbnail dari POTONGAN VIDEO ASLI, TANPA biaya AI (2026-08-10, permintaan Agus -
// "jangan ada biaya thumbnail, gunakan potongan video terbaik saja") - GANTI TOTAL dari
// thumbnail.ts (Nano Banana 2, $0.08/gambar + teks overlay AI) - bukan opsi kedua,
// konsisten dgn pola swap penuh yg sudah dipakai di app ini (Kokoro->GPT TTS,
// gpt-image-1->Nano Banana, dst - satu jalur, bukan 2 paralel).
//
// Frame diambil dari VIDEO FINAL yg SUDAH DIRENDER (motion/transisi/subtitle sudah
// masuk, lebih representatif drpd raw_footage mentah yg dipakai jalur lama) di
// ~15% durasi (bukan detik ke-0/1 - biasanya masih hook/judul teks, frame agak masuk
// ke konten lebih menarik jadi thumbnail drpd frame paling awal). Murni FFmpeg lokal
// (baca langsung dari URL video yg SUDAH ter-upload, sama teknik dgn normalisasi
// klip di ffmpeg.ts) - nol panggilan AI, nol biaya provider gambar.
export async function extractThumbnailFrame(
  videoUrl: string,
  durationSeconds: number,
  brandId: string,
  projectId: string
): Promise<string> {
  const workDir = await mkdtemp(path.join(tmpdir(), `kontenpilot_thumb_${projectId}_`));
  try {
    const atSeconds = Math.max(1, Math.min(durationSeconds * 0.15, durationSeconds - 1));
    const outPath = path.join(workDir, "thumbnail.jpg");
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss", String(atSeconds),
      "-i", videoUrl,
      "-vframes", "1",
      "-q:v", "2",
      outPath,
    ]);
    const buffer = await readFile(outPath);
    const key = buildAssetKey(brandId, projectId, "thumbnail.jpg");
    return uploadBuffer(key, buffer, "image/jpeg");
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

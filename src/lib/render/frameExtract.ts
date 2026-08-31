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

// Thumbnail System upgrade (2026-08-26, PRD §15, Task Plan 7) - ekstraksi TETAP murni
// FFmpeg lokal, NOL biaya AI di langkah ini (persis prinsip cost yg sama dgn
// extractThumbnailFrame di atas - Agus explicitly menolak biaya thumbnail 2026-08-10).
// BEDA dari fungsi tunggal di atas: ambil BEBERAPA frame kandidat (bukan 1 titik tetap)
// tersebar merata di "jendela hook" (20% AWAL durasi - alasan sama dgn 15% single-frame:
// detik 0 biasanya masih title card/logo, tapi caption/naskah HOOK-nya sendiri ada di
// bagian awal video, bukan di 50%/100% durasi) - evaluasi/pemilihan mana yg terbaik dari
// kandidat2 ini yg BARU pakai AI (1 panggilan vision, lihat thumbnailScoring.ts), TIDAK
// digabung di sini supaya ekstraksi (gratis) tetap terpisah bersih dari evaluasi (berbayar).
const HOOK_WINDOW_FRACTION = 0.2;

export async function extractThumbnailCandidates(
  videoUrl: string,
  durationSeconds: number,
  brandId: string,
  projectId: string,
  count = 4
): Promise<string[]> {
  const workDir = await mkdtemp(path.join(tmpdir(), `kontenpilot_thumbcand_${projectId}_`));
  try {
    const windowEnd = Math.max(1, durationSeconds * HOOK_WINDOW_FRACTION);
    const urls: string[] = [];
    for (let i = 0; i < count; i++) {
      // Sebar merata dari 1dtk s.d. windowEnd (hindari frame 0 - lihat catatan di atas).
      const atSeconds = Math.min(
        1 + ((windowEnd - 1) * i) / Math.max(1, count - 1),
        durationSeconds - 1
      );
      const outPath = path.join(workDir, `candidate_${i}.jpg`);
      await execFileAsync("ffmpeg", [
        "-y",
        "-ss", String(Math.max(0, atSeconds)),
        "-i", videoUrl,
        "-vframes", "1",
        "-q:v", "2",
        outPath,
      ]);
      const buffer = await readFile(outPath);
      const key = buildAssetKey(brandId, projectId, `thumbnail_candidate_${i}.jpg`);
      urls.push(await uploadBuffer(key, buffer, "image/jpeg"));
    }
    return urls;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

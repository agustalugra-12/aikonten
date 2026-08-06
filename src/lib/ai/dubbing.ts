import { getOpenAIClient, logNonTokenUsage } from "./openaiClient";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

// TTS-1 (2026-08-06, permintaan Agus - "cek ai konten juga agar transparan") - beda dari
// chat.completions, audio.speech TIDAK balikin JSON/usage sama sekali (respons langsung
// audio binary) - harganya per KARAKTER teks input ($15/1M karakter utk tts-1), dihitung
// dari panjang teks SEBELUM dikirim, bukan dari respons.
const TTS_PRICE_PER_1M_CHARS = 15.0;

// AI Dubbing (lihat memory proyek - Agus konfirmasi: GANTI TOTAL suara asli syuting,
// bukan tambahan/mixing). Pakai "tts-1" (BUKAN "tts-1-hd") - jauh lebih murah per
// karakter, cukup utk narasi caption pendek (permintaan Agus: prioritaskan murah).
// Teks narasinya REUSE caption yg SUDAH di-generate (bukan panggilan GPT baru) - caption
// sudah ditulis sbg prosa natural jadi cocok dibacakan apa adanya, hemat 1 panggilan AI.
export async function generateVoiceover(text: string): Promise<Buffer> {
  const client = getOpenAIClient();
  const response = await client.audio.speech.create({
    model: "tts-1",
    voice: "alloy",
    input: text,
  });
  await logNonTokenUsage("tts-1", (text.length / 1_000_000) * TTS_PRICE_PER_1M_CHARS);
  return Buffer.from(await response.arrayBuffer());
}

// Dipakai utk foto-zoom (lihat cloudinary.ts applyZoomToImage) - durasi video pendek
// itu HARUS ikut durasi asli suara TTS-nya (bukan angka tebakan/hardcode), krn beda dgn
// jalur video asli (yg durasinya sudah ditentukan dari klip footage terpilih), di sini
// TTS-lah yg justru menentukan berapa lama videonya. ffprobe (server sudah terpasang,
// lihat memory proyek) jauh lebih akurat drpd estimasi kata/detik.
export async function getAudioDurationSeconds(buffer: Buffer): Promise<number> {
  const tmpFile = path.join(tmpdir(), `kontenpilot_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
  await writeFile(tmpFile, buffer);
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      tmpFile,
    ]);
    const duration = parseFloat(stdout.trim());
    if (!Number.isFinite(duration)) throw new Error("ffprobe tidak menghasilkan durasi audio yang valid");
    return duration;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

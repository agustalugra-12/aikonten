import { fal } from "@fal-ai/client";
import { subscribeFalWithRetry } from "./falRetry";
import { logNonTokenUsage } from "./openaiClient";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

function ensureFalConfigured(): void {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_KEY belum diisi di .env");
  fal.config({ credentials: apiKey });
}

// Kokoro TTS (2026-08-10, permintaan Agus - "gunakan ini juga untuk pengisi suara di ai
// konten", https://github.com/hexgrad/kokoro) - GANTI dari OpenAI tts-1 (bukan
// ditambahkan sbg opsi kedua, konsisten dgn pola swap penuh yg sudah dipakai di app ini
// - lihat migrasi gpt-image-1 -> Nano Banana 2 di posterDesign.ts/thumbnail.ts, satu
// provider konsisten drpd 2 jalur paralel yg makin lama makin sulit dirawat).
//
// Dijalankan via fal.ai (endpoint fal-ai/kokoro/american-english, DICEK LANGSUNG ke
// dokumentasi resmi fal.ai sebelum dipakai - bukan asumsi), BUKAN inferensi lokal
// (model onnx/kokoro-js) - VPS ini cuma 3.8GB RAM/2 core & SUDAH jalanin PMS/AI Chat
// Bot/AI Blog/KontenPilot sekaligus (lihat memory proyek soal OOM berulang), inferensi
// neural TTS lokal (walau Kokoro tergolong kecil, 82M parameter) beresiko rebutan
// resource dgn ffmpeg render yg jalan bersamaan. fal.ai SUDAH jadi provider tepercaya di
// app ini (Nano Banana 2 poster/thumbnail, lihat falRetry.ts) - reuse infrastruktur yg
// sama (kredensial, retry wrapper), bukan nambah provider ketiga.
//
// Harga: $0.02/1000 karakter ($20/1M) - SEDIKIT LEBIH MAHAL drpd tts-1 lama ($15/1M),
// dicatat jujur di sini supaya tidak dikira ini penghematan biaya - alasan pindah ke
// Kokoro adalah KUALITAS suara (permintaan eksplisit Agus), bukan biaya lebih murah.
const KOKORO_PRICE_PER_1M_CHARS = 20.0;
// "am_michael" - suara pria Amerika, jernih & netral, cocok jadi default lintas brand
// (Pelangi/Harmoni/laundry/Animal Story & Co dst - app ini multi-brand, belum ada
// pengaturan suara per-brand). 19 suara lain tersedia (lihat dokumentasi endpoint) kalau
// nanti Agus mau variasi/pilihan per-brand - PROPORTIONATE utk sekarang cuma 1 default,
// jangan bangun UI pemilihan suara sebelum benar2 diminta.
const KOKORO_VOICE = "am_michael";

// AI Dubbing (lihat memory proyek - Agus konfirmasi: GANTI TOTAL suara asli syuting,
// bukan tambahan/mixing). Teks narasinya REUSE caption yg SUDAH di-generate (bukan
// panggilan GPT baru) - caption sudah ditulis sbg prosa natural jadi cocok dibacakan apa
// adanya, hemat 1 panggilan AI.
export async function generateVoiceover(text: string): Promise<Buffer> {
  ensureFalConfigured();

  const result = await subscribeFalWithRetry("fal-ai/kokoro/american-english", {
    prompt: text,
    voice: KOKORO_VOICE,
    speed: 1,
  });
  const audioUrl = (result.data as { audio?: { url?: string } })?.audio?.url;
  if (!audioUrl) throw new Error("Kokoro TTS (fal.ai) tidak mengembalikan hasil audio");

  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Gagal ambil hasil voiceover dari fal.ai: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  await logNonTokenUsage("kokoro-tts", (text.length / 1_000_000) * KOKORO_PRICE_PER_1M_CHARS);
  return buffer;
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

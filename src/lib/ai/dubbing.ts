import { getOpenAIClient, logNonTokenUsage } from "./openaiClient";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { runFfmpeg } from "@/lib/render/ffmpegExec";
import { resolveVoice } from "./ttsVoices";
import { rencanaDurasiVoiceover, DURASI_EKSTERNAL } from "@/lib/billing/durasiVideo";

const execFileAsync = promisify(execFile);

// OpenAI TTS - gpt-4o-mini-tts (2026-08-10, permintaan Agus - ganti dari Kokoro/fal.ai
// balik ke GPT, konsisten dgn pola swap PENUH yg sudah dipakai di app ini, bukan 2
// jalur paralel). Kokoro sempat dipakai (lihat riwayat git file ini) tapi Agus minta
// balik ke TTS OpenAI. "gpt-4o-mini-tts" (BUKAN tts-1/tts-1-hd lama) - model TTS
// terkini OpenAI, lebih steerable/natural drpd tts-1, dicek langsung ke dokumentasi
// resmi sblm dipakai.
//
// Harga: $0.60/1M token INPUT teks + $12.00/1M token OUTPUT audio (skema TOKEN, BUKAN
// per-karakter spt tts-1 lama) - dicek ke docs resmi, TAPI OpenAI TIDAK publikasikan
// rasio token-audio/detik resminya & endpoint speech ini TIDAK balikin field `usage`
// spt chat.completions (beda dari logOpenAIUsage generic di openaiClient.ts, makanya
// dicatat manual di sini spt kokoro-tts dulu). Estimasi biaya di bawah pakai DURASI
// AUDIO ASLI (ffprobe, akurat) x $0.015/menit (perkiraan komunitas developer yg umum
// dipakai, BUKAN angka resmi OpenAI - kalau nanti ada tagihan asli OpenAI utk
// dibandingkan, sesuaikan konstanta ini, jangan anggap ini pasti presisi).
const GPT_TTS_MODEL = "gpt-4o-mini-tts";
const GPT_TTS_PRICE_PER_MINUTE_AUDIO_ESTIMATE = 0.015;
// Voice per-brand (2026-11-02, T4) - brand pilih suara di Brand Kit (brandKit.voice),
// diteruskan ke generateVoiceover. Default "marin" via DEFAULT_TTS_VOICE (ttsVoices.ts).

// Endpoint speech OpenAI WAJIB <= 4096 karakter per panggilan (dicek langsung ke
// docs resmi) - naskah YouTube Editorial (long-form 5-8 menit) bisa ~6000-7000
// karakter, JAUH melebihi itu. Margin ke 3800 (bukan pas 4096) - buffer aman utk
// variasi encoding/whitespace, bukan pas di batas.
const MAX_CHARS_PER_CALL = 3800;

// Pecah teks jadi potongan <= MAX_CHARS_PER_CALL, SELALU di batas kalimat (titik/tanya/
// seru + spasi) - bukan potong sembarang tengah kalimat yg bikin jeda TTS aneh/kepotong
// pas dibaca. Kalau 1 kalimat sendirian sudah > batas (jarang, tapi jaga2), potong paksa
// di situ drpd infinite loop/gagal total.
function splitIntoTtsChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length <= MAX_CHARS_PER_CALL) {
      current += sentence;
    } else {
      if (current.trim()) chunks.push(current.trim());
      if (sentence.length > MAX_CHARS_PER_CALL) {
        // 1 kalimat sendiri > batas - potong paksa per kata supaya tetap <= batas.
        let piece = "";
        for (const word of sentence.split(" ")) {
          if (piece.length + word.length + 1 > MAX_CHARS_PER_CALL) {
            chunks.push(piece.trim());
            piece = "";
          }
          piece += word + " ";
        }
        current = piece;
      } else {
        current = sentence;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function synthesizeChunk(client: ReturnType<typeof getOpenAIClient>, text: string, voice: string): Promise<Buffer> {
  const response = await client.audio.speech.create({
    model: GPT_TTS_MODEL,
    voice,
    input: text,
  });
  return Buffer.from(await response.arrayBuffer());
}

// Sambung beberapa file MP3 jadi SATU audio utuh via ffmpeg concat demuxer (bukan
// concat byte mentah - MP3 punya header per-frame yg bisa bikin sambungan byte mentah
// terdengar klik/glitch di titik sambung, concat demuxer ffmpeg re-mux dgn benar).
async function concatMp3Buffers(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 1) return buffers[0];
  const workDir = await mkdtemp(path.join(tmpdir(), "kontenpilot_tts_concat_"));
  try {
    const partPaths: string[] = [];
    for (let i = 0; i < buffers.length; i++) {
      const p = path.join(workDir, `part${i}.mp3`);
      await writeFile(p, buffers[i]);
      partPaths.push(p);
    }
    const listPath = path.join(workDir, "list.txt");
    await writeFile(listPath, partPaths.map((p) => `file '${p}'`).join("\n"));
    const outPath = path.join(workDir, "out.mp3");
    // Fase 3 (2026-08-31): via wrapper ffmpegExec (cgroup+timeout util+semaphore) -
    // dulu execFileAsync telanjang. Concat demuxer -c copy SAMA PERSIS (re-mux tanpa
    // re-encode, bukan concat byte mentah - lihat komentar fungsi ini). ffprobe utk
    // durasi audio di bawah TETAP execFileAsync langsung - binary berbeda, baca
    // metadata murni (detik-milidetik, ~0 memori), bukan encode - di luar scope
    // kebijakan resource ffmpeg.
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath], "util");
    const { readFile } = await import("fs/promises");
    return await readFile(outPath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// AI Dubbing (lihat memory proyek - Agus konfirmasi: GANTI TOTAL suara asli syuting,
// bukan tambahan/mixing). Teks narasinya REUSE caption yg SUDAH di-generate (bukan
// panggilan GPT baru) - caption sudah ditulis sbg prosa natural jadi cocok dibacakan apa
// adanya, hemat 1 panggilan AI. Naskah panjang (YouTube Editorial) otomatis dipecah jadi
// beberapa panggilan TTS (lihat MAX_CHARS_PER_CALL) lalu disambung - transparan bagi
// pemanggil, tetap terima 1 teks & balikin 1 buffer audio utuh.
export async function generateVoiceover(text: string, voice?: string | null): Promise<Buffer> {
  const client = getOpenAIClient();
  const chunks = splitIntoTtsChunks(text);
  // Voice per-brand (2026-11-02, T4) - resolveVoice fail-soft ke DEFAULT_TTS_VOICE (marin)
  // kalau null/invalid, jadi brand lama tanpa setting tetap pakai suara default spt sebelumnya.
  const resolvedVoice = resolveVoice(voice);

  const chunkBuffers: Buffer[] = [];
  for (const chunk of chunks) {
    chunkBuffers.push(await synthesizeChunk(client, chunk, resolvedVoice));
  }
  const buffer = await concatMp3Buffers(chunkBuffers);

  try {
    const durationSeconds = await getAudioDurationSeconds(buffer);
    await logNonTokenUsage(
      "gpt-4o-mini-tts",
      (durationSeconds / 60) * GPT_TTS_PRICE_PER_MINUTE_AUDIO_ESTIMATE
    );
  } catch (err) {
    console.error("[dubbing] gagal catat biaya TTS (audio tetap dipakai normal):", err);
  }

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

// Durasi narasi tenant eksternal (2026-11-05, aturan 30-60 dtk - lihat durasiVideo.ts): ukur audio TTS NYATA,
// koreksi murah (ffmpeg atempo <=1.15x / jeda di akhir <=8 dtk) lalu ukur ULANG; di luar batas koreksi -> lempar
// error jelas (pemanggil processProject -> project failed + refund kredit di route/autoContent). Internal: apa adanya.
// deps hanya utk tes (tanpa ffmpeg/ffprobe).
export async function sesuaikanDurasiVoiceover(
  buffer: Buffer,
  unlimited: boolean | null | undefined,
  deps: { durasi?: (b: Buffer) => Promise<number>; ubah?: (b: Buffer, filter: string) => Promise<Buffer> } = {},
): Promise<{ buffer: Buffer; catatan: string | null }> {
  if (unlimited) return { buffer, catatan: null };
  const durasi = deps.durasi ?? getAudioDurationSeconds, ubah = deps.ubah ?? ubahAudio;
  const detik = await durasi(buffer);
  const r = rencanaDurasiVoiceover(detik, unlimited);
  if (r.aksi === "ok") return { buffer, catatan: null };
  if (r.aksi === "gagal") throw new Error(r.pesan);
  const filter = r.aksi === "percepat" ? `atempo=${r.tempo}` : `apad=whole_dur=${(DURASI_EKSTERNAL.min + 0.3).toFixed(1)}`;
  const out = await ubah(buffer, filter);
  const detik2 = await durasi(out);
  const r2 = rencanaDurasiVoiceover(detik2, unlimited);
  if (r2.aksi !== "ok") throw new Error(`Durasi narasi ${detik2.toFixed(1)} detik masih di luar batas ${DURASI_EKSTERNAL.min}-${DURASI_EKSTERNAL.max} detik setelah koreksi. Kredit dikembalikan; coba generate ulang.`);
  return { buffer: out, catatan: `${r.aksi} ${detik.toFixed(1)}s -> ${detik2.toFixed(1)}s (${filter})` };
}
async function ubahAudio(buffer: Buffer, filter: string): Promise<Buffer> {
  const workDir = await mkdtemp(path.join(tmpdir(), "kontenpilot_tts_dur_"));
  try {
    const inP = path.join(workDir, "in.mp3"), outP = path.join(workDir, "out.mp3");
    await writeFile(inP, buffer);
    await runFfmpeg(["-y", "-i", inP, "-af", filter, "-c:a", "libmp3lame", "-b:a", "160k", outP], "util");
    const { readFile } = await import("fs/promises");
    return await readFile(outP);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

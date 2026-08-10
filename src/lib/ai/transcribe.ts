import { getOpenAIClient, logNonTokenUsage } from "./openaiClient";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

// Whisper (2026-08-06, permintaan Agus - "cek ai konten juga agar transparan") - beda
// dari chat.completions, Whisper TIDAK py field `usage.prompt_tokens` - harganya per
// MENIT audio ($0,006/menit, "duration" ada di respons verbose_json). Dicatat sbg
// promptTokens/completionTokens null (bukan token-based) tapi costUsd tetap terisi.
const WHISPER_PRICE_PER_MINUTE = 0.006;

export type TranscriptSegment = {
  start: number; // detik
  end: number; // detik
  text: string;
  avgLogprob: number; // proxy kejelasan audio - makin dekat 0 makin jelas
};

// Word Timing (2026-08-10, fitur Subtitle Designer - permintaan Agus soal caption gaya
// TikTok/YT Shorts modern) - level SEGMEN (di atas, beberapa detik/frasa) TIDAK cukup
// utk efek "kata per kata" (pop-in + highlight kata yg SEDANG diucapkan) - butuh
// timestamp PER KATA. Whisper API dukung ini langsung via timestamp_granularities:
// ["word"] (dicek nyata ke API sebelum dipakai, bukan asumsi dokumentasi) - tidak perlu
// heuristik/estimasi sendiri.
export type WordTiming = { word: string; start: number; end: number };

// Transkripsi footage mentah lewat Whisper - hasilnya dipakai DUA kali: (1) jadi dasar
// pemilihan klip otomatis (clipSelect.ts), (2) jadi dasar subtitle final. fileUrl harus
// URL publik (dari storage.ts) krn OpenAI ambil file itu sendiri lewat network.
// Normalisasi audio via ffmpeg SEBELUM kirim ke Whisper (2026-08-07, permintaan Agus -
// "untuk audio dalam footage di senyapkan saja jika ini mengganggu" - bug nyata
// ditemukan 2026-08-06: footage WhatsApp casual [beda dari footage Pelangi yg lebih
// terkontrol] kadang py audio yg GAGAL didekode Whisper langsung ["The audio file could
// not be decoded or its format is not supported"], SEBELUMNYA file itu cuma dilewati
// sepenuhnya [try/catch skip di processProject.ts, masih dipertahankan sbg jaring
// pengaman terakhir] - artinya file itu KEHILANGAN kesempatan discore lewat narasi
// sama sekali. Re-encode dulu ke WAV mono 16kHz standar (format yg PASTI didukung
// Whisper) - untuk audio yg cuma beda KODEK/KONTAINER (bukan benar2 rusak/sepi), ini
// MEMULIHKAN transkripsi asli drpd cuma menyerah. Kalau ffmpeg SENDIRI gagal (mis. file
// benar2 tidak py stream audio sama sekali) - hasilnya WAV senyap valid (bukan error),
// Whisper transkripsi jadi kosong secara wajar (bukan exception) - PERSIS "disenyapkan"
// sesuai permintaan, bukan menggagalkan apa pun.
async function normalizeAudioForWhisper(sourcePath: string): Promise<string> {
  const wavPath = `${sourcePath}.norm.wav`;
  await execFileAsync("ffmpeg", [
    "-y", "-i", sourcePath,
    "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
    wavPath,
  ]);
  return wavPath;
}

export async function transcribeFootage(fileUrl: string): Promise<TranscriptSegment[]> {
  const client = getOpenAIClient();
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) {
    throw new Error(`Gagal ambil file utk transkripsi: ${fileRes.status} ${fileRes.statusText}`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const rawPath = path.join(tmpdir(), `kontenpilot_footage_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`);
  await writeFile(rawPath, buffer);

  let wavPath: string | null = null;
  try {
    try {
      wavPath = await normalizeAudioForWhisper(rawPath);
    } catch (err) {
      // ffmpeg sendiri gagal proses file ini (benar2 tidak ada stream audio/file corrupt
      // total) - "disenyapkan" sesuai permintaan, bukan lempar error yg gagalkan project.
      console.warn(`[transcribe] gagal normalisasi audio ${fileUrl}, dianggap senyap:`, err);
      return [];
    }

    const wavBuffer = await readFile(wavPath);
    const file = new File([new Uint8Array(wavBuffer)], "footage.wav", { type: "audio/wav" });

    const result = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });

    // response_format verbose_json - SDK type resminya cuma expose `text`, segments ada
    // di response mentah (field tambahan API yg belum sepenuhnya di-type SDK-nya).
    const raw = result as unknown as {
      duration?: number;
      segments?: Array<{ start: number; end: number; text: string; avg_logprob: number }>;
    };
    if (typeof raw.duration === "number") {
      await logNonTokenUsage("whisper-1", (raw.duration / 60) * WHISPER_PRICE_PER_MINUTE);
    }

    return (raw.segments || []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
      avgLogprob: s.avg_logprob,
    }));
  } finally {
    await unlink(rawPath).catch(() => {});
    if (wavPath) await unlink(wavPath).catch(() => {});
  }
}

// Transkripsi audio TTS dubbing (2026-08-06, permintaan Agus - "perbaiki subtitle agar
// presisi dengan dubbing"). SEBELUM ini subtitle dibangun dari buildCaptionSrt() yg
// BUKAN transkripsi sungguhan - cuma bagi caption jadi chunk 8 kata & sebar RATA
// sepanjang totalDuration FOOTAGE (bukan durasi audio TTS asli, apalagi pacing
// ucapan/jeda alami TTS-nya) - dijamin ngaco makin lama videonya (drift makin
// menumpuk), persis laporan Agus "subtitle tidak presisi dgn dubbing, penonton
// bingung". Fix: transkripsi ULANG audio TTS yg SUDAH digenerate (Whisper, sama
// endpoint dgn transcribeFootage di atas) - dapat timestamp ASLI dari audio yg
// BENERAN diputar, bukan estimasi. Terima Buffer langsung (bukan fileUrl) krn audio
// TTS ini murni in-memory, belum (&tidak perlu) diupload ke storage publik dulu.
// mimeType default "audio/mpeg" (2026-08-10, dubbing.ts balik ke OpenAI gpt-4o-mini-tts
// yg balikin MP3, sempat "audio/wav" singkat pas pakai Kokoro - lihat catatan sama di
// ffmpeg.ts/cloudinary.ts). Whisper PERCAYA ekstensi filename yg diturunkan dari mimeType
// ini utk parse format audio - salah label bisa gagal/salah transkrip diam-diam. Satu-
// satunya pemanggil (processProject.ts) tidak pernah kirim mimeType eksplisit, jadi
// default ini WAJIB benar.
export async function transcribeAudioBuffer(
  buffer: Buffer,
  mimeType: string = "audio/mpeg"
): Promise<{ segments: TranscriptSegment[]; words: WordTiming[] }> {
  const client = getOpenAIClient();
  const ext = mimeType.split("/")[1]?.split(";")[0] || "wav";
  const file = new File([new Uint8Array(buffer)], `voiceover.${ext}`, { type: mimeType });

  // timestamp_granularities: ["word", "segment"] (2026-08-10, fitur Subtitle Designer) -
  // SEBELUMNYA cuma "segment" (dites live: minta keduanya sekaligus TIDAK nambah biaya,
  // 1 panggilan API yg sama, harga tetap per-menit audio bukan per-granularity).
  const result = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  });

  const raw = result as unknown as {
    duration?: number;
    segments?: Array<{ start: number; end: number; text: string; avg_logprob: number }>;
    words?: Array<{ word: string; start: number; end: number }>;
  };
  if (typeof raw.duration === "number") {
    await logNonTokenUsage("whisper-1", (raw.duration / 60) * WHISPER_PRICE_PER_MINUTE);
  }

  return {
    segments: (raw.segments || []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
      avgLogprob: s.avg_logprob,
    })),
    words: (raw.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
  };
}

import OpenAI from "openai";
import { db } from "@/db";
import { llmUsageLog } from "@/db/schema";
import { newId } from "@/lib/ids";

// Client OpenAI TERPUSAT (2026-08-06, permintaan Agus - "cek ai blok dan ai konten juga
// agar transparan") - SEBELUM ini tiap file (generateContent.ts, researchTopics.ts,
// describeFootage.ts, dst - 9 file) definisikan getClient() SENDIRI-SENDIRI, tidak ada
// satu titik bersama utk mencatat usage/biaya spt yg sudah dibangun di ai-chat-bot &
// AI Blog hari yg sama. Daripada tambal tiap file satu-satu (9x, rawan ada yg
// terlewat), pusatkan di SINI - override `fetch` bawaan client (didukung resmi SDK
// openai v4+) utk INTERSEP respons SETIAP panggilan API tanpa mengubah kode pemanggil
// sama sekali (murni observability, bukan bagian alur kontrol - kegagalan logging
// dibungkus try/catch, TIDAK PERNAH menggagalkan panggilan API asli).
//
// Cuma nangkep chat.completions (field `usage.prompt_tokens`/`completion_tokens` SELALU
// ada di respons endpoint itu, gampang dideteksi generic tanpa parse request body) -
// mencakup MAYORITAS panggilan KontenPilot (ide, caption, poster copy, deskripsi
// vision foto/video - semua lewat chat.completions.create). Whisper (transcribe.ts) &
// TTS (dubbing.ts) dicatat LANGSUNG di file masing-masing (cuma 3 fungsi total, harga
// beda skema - per-menit/per-karakter bukan token - lebih jelas diinstrumentasi
// langsung drpd dipaksa generic di sini).

// Harga per 1M token (2026-08-06, USD - sama tabel dgn AI Blog, disesuaikan model yg
// KontenPilot pakai). Update manual kalau harga OpenAI berubah - tidak ada endpoint
// publik resmi utk pricing realtime.
const MODEL_PRICING_PER_1M: Record<string, [number, number]> = {
  "gpt-4.1-mini": [0.40, 1.60],
  "gpt-4.1": [2.00, 8.00],
  "gpt-4o-mini": [0.15, 0.60],
};

// OpenAI balikin nama model TERVERSI penuh di respons (mis. "gpt-4.1-mini-2025-04-14"),
// BUKAN nama pendek yg dipakai di request ("gpt-4.1-mini") - cocokkan by PREFIX (urutan
// terpanjang dulu supaya "gpt-4.1-mini" tidak salah kecocok ke entry "gpt-4.1" duluan)
// drpd exact match yg pasti gagal & selalu balik [0,0].
function lookupPricing(model: string): [number, number] {
  const sorted = Object.entries(MODEL_PRICING_PER_1M).sort((a, b) => b[0].length - a[0].length);
  const match = sorted.find(([prefix]) => model.startsWith(prefix));
  return match ? match[1] : [0, 0];
}

export async function logOpenAIUsage(
  model: string,
  promptTokens: number,
  completionTokens: number
): Promise<void> {
  try {
    const [priceIn, priceOut] = lookupPricing(model);
    const costUsd = (promptTokens / 1_000_000) * priceIn + (completionTokens / 1_000_000) * priceOut;
    await db.insert(llmUsageLog).values({
      id: newId("usage"),
      ts: new Date(),
      provider: "openai",
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
    });
  } catch (err) {
    console.error("[openaiClient] gagal catat usage:", err);
  }
}

// Dipakai Whisper (per-menit) & TTS (per-karakter) di transcribe.ts/dubbing.ts - beda
// skema harga dari chat.completions (bukan token-based), biaya sudah dihitung pemanggil
// sendiri (masing2 tahu harga per-unit-nya), fungsi ini cuma tulis ke DB yg sama.
export async function logNonTokenUsage(model: string, costUsd: number): Promise<void> {
  try {
    await db.insert(llmUsageLog).values({
      id: newId("usage"),
      ts: new Date(),
      provider: "openai",
      model,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      costUsd,
    });
  } catch (err) {
    console.error("[openaiClient] gagal catat usage (non-token):", err);
  }
}

let cachedClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");

  const loggingFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    // Clone SEBELUM baca body - response asli WAJIB tetap utuh utk SDK, .json() di sini
    // cuma utk INTIP usage, bukan konsumsi response yg sesungguhnya dipakai caller.
    try {
      const clone = res.clone();
      const data = await clone.json();
      const usage = data?.usage;
      if (usage && typeof usage.prompt_tokens === "number") {
        const model = data?.model || "unknown";
        await logOpenAIUsage(model, usage.prompt_tokens, usage.completion_tokens || 0);
      }
    } catch {
      // Bukan semua respons JSON (mis. audio binary) atau bukan semua py field usage -
      // diam-diam dilewati, ini murni observability tambahan.
    }
    return res;
  };

  cachedClient = new OpenAI({ apiKey, fetch: loggingFetch });
  return cachedClient;
}

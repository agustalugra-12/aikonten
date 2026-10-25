import { GoogleGenAI, FinishReason } from "@google/genai";
import OpenAI, { toFile } from "openai";
import { logNonTokenUsage } from "./openaiClient";

// Migrasi dari fal.ai (fal-ai/nano-banana-2) ke Gemini API LANGSUNG (2026-09-06,
// permintaan Agus) - model SAMA PERSIS (fal.ai cuma proxy ke gemini-3.1-flash-image,
// lihat catatan lama di posterDesign.ts/thumbnail.ts), tapi lebih murah tanpa markup
// fal.ai: $0.067/gambar @ 1K (harga resmi ai.google.dev/gemini-api/docs/pricing,
// dicek 2026-09-06) vs $0.08/gambar sebelumnya. API key SAMA yang sudah dipakai
// ai-chat-bot (litellm/Gemini) - satu akun Google, dua project.
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
const GEMINI_IMAGE_PRICE_1K = 0.067;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

// Finish reason yang berarti model MENOLAK konten berdasarkan ISI input (sama filosofi
// dgn isContentPolicyViolation di falRetry.ts) - retry ulang dgn input SAMA PERSIS
// dijamin ditolak lagi, cuma buang waktu/kuota. Beda dari kegagalan transien (network/
// server) yang memang layak di-retry.
const NON_RETRYABLE_FINISH_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.IMAGE_SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
]);

export function isNonRetryableFinishReason(finishReason: string | undefined): boolean {
  return !!finishReason && NON_RETRYABLE_FINISH_REASONS.has(finishReason);
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY belum diisi di .env");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function urlToInlineImage(url: string): Promise<{ mimeType: string; data: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal ambil gambar input dari ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { mimeType: res.headers.get("content-type") || "image/png", data: buffer.toString("base64") };
}

class NonRetryableGeminiImageError extends Error {}

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
}

async function generateOnce(opts: {
  prompt: string;
  inputImages: Array<{ mimeType: string; data: string }>;
  aspectRatio: string;
}): Promise<GeneratedImage> {
  const res = await getClient().models.generateContent({
    model: GEMINI_IMAGE_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          ...opts.inputImages.map((img) => ({ inlineData: img })),
          { text: opts.prompt },
        ],
      },
    ],
    config: {
      imageConfig: { aspectRatio: opts.aspectRatio, imageSize: "1K" },
    },
  });

  const candidate = res.candidates?.[0];
  const imgPart = candidate?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!imgPart?.data) {
    const finishReason = candidate?.finishReason;
    const msg = `Gemini (${GEMINI_IMAGE_MODEL}) tidak mengembalikan gambar (finishReason: ${finishReason ?? "unknown"})`;
    if (isNonRetryableFinishReason(finishReason)) {
      throw new NonRetryableGeminiImageError(msg);
    }
    throw new Error(msg);
  }
  // mimeType ASLI dari respons (2026-09-06 - Gemini kadang balas image/jpeg walau
  // diminta 1K PNG-style, JANGAN asumsikan png - caller pakai ini utk contentType
  // upload yg benar, bukan hardcode).
  return { buffer: Buffer.from(imgPart.data, "base64"), mimeType: imgPart.mimeType || "image/png" };
}

// Retry wrapper - pola SAMA PERSIS dgn subscribeFalWithRetry (bekas falRetry.ts,
// sudah dihapus krn tidak dipakai lagi - dubbing.ts sudah pindah ke OpenAI TTS lebih
// dulu) supaya perilaku operasional (log biaya attempt-failed, jeda antar percobaan,
// nyerah cepat utk penolakan konten) konsisten.
export async function generateImageWithGemini(opts: {
  prompt: string;
  imageUrls?: string[];
  aspectRatio: string;
  usageLabel: string;
}): Promise<GeneratedImage> {
  if ((process.env.IMAGE_BACKEND || "").toLowerCase() === "openai") return generateImageWithGptMini(opts);
  const inputImages = opts.imageUrls ? await Promise.all(opts.imageUrls.map(urlToInlineImage)) : [];

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const image = await generateOnce({ prompt: opts.prompt, inputImages, aspectRatio: opts.aspectRatio });
      await logNonTokenUsage(opts.usageLabel, GEMINI_IMAGE_PRICE_1K, "gemini");
      return image;
    } catch (err) {
      lastError = err;
      console.error(`[gemini-image] percobaan ${attempt}/${MAX_ATTEMPTS} gagal (${opts.usageLabel}): ${describeError(err)}`);
      await logNonTokenUsage(`${opts.usageLabel}-attempt-failed`, 0, "gemini");
      if (err instanceof NonRetryableGeminiImageError) {
        console.error(`[gemini-image] penolakan konten - input tidak akan berubah di percobaan berikutnya, nyerah sekarang (tidak retry).`);
        throw err;
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastError;
}


// Backend alternatif (2026-10-25, uji biaya): gpt-image-1-mini via flag IMAGE_BACKEND=openai
// + IMAGE_QUALITY (low|medium|high). Jalur foto-asli pakai images.edit (pertahankan foto),
// full-AI pakai images.generate. Tipe balikan sama (GeneratedImage). Gemini tetap default.
async function generateImageWithGptMini(opts: { prompt: string; imageUrls?: string[]; aspectRatio: string; usageLabel: string }): Promise<GeneratedImage> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const quality = ((process.env.IMAGE_QUALITY || "medium").toLowerCase()) as "low" | "medium" | "high";
  const ar = opts.aspectRatio;
  const size = (ar === "4:5" || ar === "3:4" || ar === "9:16") ? "1024x1536" : (ar === "16:9" || ar === "3:2") ? "1536x1024" : "1024x1024";
  let r: any;
  if (opts.imageUrls && opts.imageUrls.length) {
    const files = await Promise.all(opts.imageUrls.map(async (u, i) => {
      const resp = await fetch(u); const ab = await resp.arrayBuffer();
      return await toFile(Buffer.from(ab), `in${i}.png`, { type: "image/png" });
    }));
    r = await openai.images.edit({ model: "gpt-image-1-mini", image: files as any, prompt: opts.prompt, size: size as any, quality: quality as any });
  } else {
    r = await openai.images.generate({ model: "gpt-image-1-mini", prompt: opts.prompt, size: size as any, quality: quality as any });
  }
  const u = r.usage || {};
  const cost = ((u.output_tokens ?? 0) * 8 + (u.input_tokens ?? 0) * 2) / 1e6;
  console.log(`[gpt-image-mini] ${opts.usageLabel} q=${quality} size=${size} out_tok=${u.output_tokens ?? 0} biaya=$${cost.toFixed(5)}`);
  return { buffer: Buffer.from(r.data[0].b64_json as string, "base64"), mimeType: "image/png" };
}

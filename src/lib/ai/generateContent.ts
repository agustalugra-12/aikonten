import OpenAI from "openai";
import type { ScoredSegment } from "./clipSelect";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

export type GeneratedContent = {
  caption: string;
  hashtags: string[];
};

export type GeneratedImageContent = GeneratedContent & {
  // Teks harga/promo singkat kalau skrip menyebutkannya (mis. "Rp175.000", "Promo 20%"),
  // null kalau tidak ada - dipakai utk overlay GPT Image (lihat promoOverlay.ts). Deteksi
  // ini SENGAJA jadi bagian sama panggilan GPT ini (bukan panggilan terpisah) biar
  // hemat & konsisten dgn konteks yg sama persis dgn caption.
  promoText: string | null;
};

export async function generateCaptionAndHashtags(
  brandName: string,
  script: string,
  selectedClipsText: string
): Promise<GeneratedContent> {
  const client = getClient();
  const system =
    "Kamu content strategist media sosial. Buat caption yang menarik & natural (bukan " +
    "generik/template) plus daftar hashtag relevan berdasarkan skrip & isi klip yang " +
    "benar-benar terpilih. JANGAN mengarang klaim yang tidak ada di skrip/klip.";
  const user = `Brand: ${brandName}\n\nSkrip/brief asli:\n${script}\n\nIsi klip yang terpilih (transkrip):\n${selectedClipsText}\n\nBalas HARUS JSON valid (tanpa markdown code fence): {"caption": "...", "hashtags": ["...", "..."]}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);
  return {
    caption: parsed.caption || "",
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
  };
}

// Konten foto/carousel (type "carousel") TIDAK ada transkrip audio utk dijadikan
// konteks - jadi caption-nya dibuat berdasar foto asli via vision model (bukan cuma
// nebak dari skrip doang), supaya tetap akurat & tidak mengarang klaim yg tdk ada di
// foto (sama prinsipnya dgn video, lihat generateCaptionAndHashtags).
export async function generateCaptionForImage(
  brandName: string,
  script: string,
  imageUrl: string
): Promise<GeneratedImageContent> {
  const client = getClient();
  const system =
    "Kamu content strategist media sosial. Lihat foto yang diberikan, lalu buat caption " +
    "menarik & natural (bukan generik/template) plus daftar hashtag relevan berdasarkan " +
    "ISI FOTO ASLI dan skrip/brief. JANGAN mengarang detail yang tidak terlihat di foto. " +
    "Kalau skrip menyebutkan harga/promo/diskon, tulis juga versi SINGKAT teks itu " +
    "(mis. \"Rp175.000\" atau \"Promo 20%\") di field promoText - ini akan ditempel " +
    "sbg badge di foto, jadi HARUS singkat (maks ~4 kata). Kalau skrip TIDAK menyebut " +
    "harga/promo sama sekali, promoText HARUS null.";
  const user = `Brand: ${brandName}\n\nSkrip/brief asli:\n${script}\n\nBalas HARUS JSON valid (tanpa markdown code fence): {"caption": "...", "hashtags": ["...", "..."], "promoText": "..." atau null}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: user },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);
  return {
    caption: parsed.caption || "",
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    promoText: parsed.promoText || null,
  };
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// Bangun subtitle SRT dari klip TERPILIH SAJA, di-retime relatif ke timeline video final
// (mulai dari 0) - bukan timestamp asli di footage mentah, krn video final adalah hasil
// sambungan klip-klip terpilih, bukan footage mentah utuh.
export function buildSrtSubtitles(selectedClips: ScoredSegment[]): string {
  let cursor = 0;
  const blocks = selectedClips.map((clip, i) => {
    const duration = clip.end - clip.start;
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${clip.text}\n`;
  });
  return blocks.join("\n");
}

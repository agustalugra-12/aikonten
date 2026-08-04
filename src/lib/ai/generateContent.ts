import OpenAI from "openai";
import type { ScoredSegment } from "./clipSelect";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

// Normalisasi hashtag (2026-08-05, bug nyata dilaporkan Agus - hashtag tampil "##").
// Prompt di bawah tidak menegaskan ADA/TIDAKnya "#" di tiap item array, jadi GPT kadang
// balas sudah pakai "#" sendiri (mis. "#PelangiHomestay") - kode pemakai (orchestrate.ts
// publish, DraftReview.tsx preview) SELALU nambahin "#" lagi krn asumsinya array isi kata
// polos, jadi jadi "##PelangiHomestay". Buang "#" di depan di sini (SATU tempat, dipakai
// kedua fungsi di bawah) - array yang di-return ke pemakai lain SELALU kata polos tanpa
// "#", apa pun yang dibalas GPT.
function stripHashPrefix(tags: string[]): string[] {
  return tags.map((t) => t.replace(/^#+/, ""));
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

export type GeneratedVideoContent = GeneratedContent & {
  // Keyword Inggris singkat utk cari B-roll di Pexels (mis. "tropical bedroom
  // interior") - null kalau topiknya tidak cocok disandingkan stok footage generik.
  // Bahasa Inggris krn metadata Pexels mayoritas Inggris, hasil jauh lebih relevan drpd
  // query Bahasa Indonesia.
  brollKeywords: string | null;
  // Teks hook singkat (2-5 kata) utk thumbnail YouTube (lihat thumbnail.ts) - cuma
  // dipakai kalau brand ini punya akun YouTube tersambung (lihat process/route.ts),
  // tapi tetap di-generate di sini skalian biar hemat 1 panggilan GPT terpisah.
  thumbnailText: string | null;
};

export async function generateCaptionAndHashtags(
  brandName: string,
  script: string,
  selectedClipsText: string
): Promise<GeneratedVideoContent> {
  const client = getClient();
  const system =
    "Kamu content strategist media sosial. Buat caption yang menarik & natural (bukan " +
    "generik/template) plus daftar hashtag relevan berdasarkan skrip & isi klip yang " +
    "benar-benar terpilih. JANGAN mengarang klaim yang tidak ada di skrip/klip. Sertakan " +
    "juga brollKeywords: 2-4 kata kunci Bahasa INGGRIS singkat utk cari video stok " +
    "(B-roll) pendamping yg relevan dgn suasana/topik ini (mis. \"tropical homestay " +
    "garden\"), atau null kalau topiknya tidak cocok disandingkan stok footage generik. " +
    "Sertakan juga thumbnailText: teks hook SANGAT singkat (2-5 kata, Bahasa Indonesia, " +
    "huruf besar boleh) yg cocok ditempel besar-besar di thumbnail YouTube (mis. " +
    "\"MULAI 175K!\"), atau null kalau tidak ada hook yg pas.";
  const user = `Brand: ${brandName}\n\nSkrip/brief asli:\n${script}\n\nIsi klip yang terpilih (transkrip):\n${selectedClipsText}\n\nBalas HARUS JSON valid (tanpa markdown code fence): {"caption": "...", "hashtags": ["...", "..."], "brollKeywords": "..." atau null, "thumbnailText": "..." atau null}`;

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
    hashtags: stripHashPrefix(Array.isArray(parsed.hashtags) ? parsed.hashtags : []),
    brollKeywords: parsed.brollKeywords || null,
    thumbnailText: parsed.thumbnailText || null,
  };
}

// Konten foto/carousel (type "carousel") TIDAK ada transkrip audio utk dijadikan
// konteks - jadi caption-nya dibuat berdasar foto asli via vision model (bukan cuma
// nebak dari skrip doang), supaya tetap akurat & tidak mengarang klaim yg tdk ada di
// foto (sama prinsipnya dgn video, lihat generateCaptionAndHashtags). Terima BANYAK
// foto sekaligus (carousel 1-5 foto, lihat NewProjectDialog.tsx) - satu caption yg
// merangkum semua foto, bukan per-foto.
export async function generateCaptionForImages(
  brandName: string,
  script: string,
  imageUrls: string[]
): Promise<GeneratedImageContent> {
  const client = getClient();
  const system =
    "Kamu content strategist media sosial. Lihat SEMUA foto yang diberikan (bisa lebih " +
    "dari satu, urutan sesuai carousel), lalu buat SATU caption yang merangkum & " +
    "menarik & natural (bukan generik/template) plus daftar hashtag relevan berdasarkan " +
    "ISI FOTO ASLI dan skrip/brief. JANGAN mengarang detail yang tidak terlihat di foto. " +
    "Kalau skrip menyebutkan harga/promo/diskon, tulis juga versi SINGKAT teks itu " +
    "(mis. \"Rp175.000\" atau \"Promo 20%\") di field promoText - ini akan ditempel " +
    "sbg badge di foto PERTAMA saja, jadi HARUS singkat (maks ~4 kata). Kalau skrip " +
    "TIDAK menyebut harga/promo sama sekali, promoText HARUS null.";
  const user = `Brand: ${brandName}\n\nSkrip/brief asli:\n${script}\n\nJumlah foto: ${imageUrls.length}\n\nBalas HARUS JSON valid (tanpa markdown code fence): {"caption": "...", "hashtags": ["...", "..."], "promoText": "..." atau null}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: user },
          ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
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
    hashtags: stripHashPrefix(Array.isArray(parsed.hashtags) ? parsed.hashtags : []),
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

// PENTING: dipakai KHUSUS kalau AI Dubbing aktif (lihat memory proyek - dubbing GANTI
// TOTAL audio asli dgn TTS membaca caption). Kalau subtitle tetap dari transkrip ASLI
// (buildSrtSubtitles di atas), subtitle & audio baru akan BEDA teks - membingungkan.
// Jadi subtitle-nya juga HARUS dari caption yg sama persis dgn naskah TTS, dipecah jadi
// blok2 kecil (~8 kata) & disebar rata sepanjang durasi video final.
export function buildCaptionSrt(captionText: string, totalDurationSeconds: number): string {
  const words = captionText.split(/\s+/).filter(Boolean);
  const wordsPerBlock = 8;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerBlock) {
    chunks.push(words.slice(i, i + wordsPerBlock).join(" "));
  }
  if (chunks.length === 0) return "";

  const perBlock = totalDurationSeconds / chunks.length;
  return chunks
    .map((text, i) => {
      const start = i * perBlock;
      const end = (i + 1) * perBlock;
      return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`;
    })
    .join("\n");
}

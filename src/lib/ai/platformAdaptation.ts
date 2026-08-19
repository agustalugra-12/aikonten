import { getOpenAIClient } from "./openaiClient";

// Platform Adaptation (PRD §43) - adapt caption ke gaya platform berbeda.
// Dipanggil saat publish, BUKAN saat generate awal (supaya 1 ide bisa multi-platform).

export type Platform = "tiktok" | "instagram" | "facebook" | "youtube";

const PLATFORM_INSTRUCTIONS: Record<Platform, string> = {
  tiktok: `Adapt caption untuk TikTok:
- Fokus: hook kuat di baris pertama, retention, fast pacing, trend, native style
- Caption harus pendek, langsung ke point, bahasa gaul/casual
- Gunakan 3-5 hashtag relevan (jangan terlalu banyak)
- Style: seperti creator TikTok, bukan brand`
,
  instagram: `Adapt caption untuk Instagram:
- Fokus: visual appeal, saves, shares, carousel-friendly
- Caption boleh lebih panjang, storytelling ringan
- Gunakan 5-10 hashtag (campuran branded + niche)
- Style: aesthetically pleasing, ada CTA untuk save/share
- Reels: hook dalam 3 detik pertama`
,
  facebook: `Adapt caption untuk Facebook:
- Fokus: community, shareability, storytelling, accessible language
- Caption medium length, ramah dibaca semua usia
- Gunakan 1-3 hashtag saja
- Style: seperti postingan di grup komunitas, ajak diskusi`
,
  youtube: `Adapt caption untuk YouTube:
- Fokus: retention, curiosity, replayability
- Title harus catchy tapi tidak clickbait
- Description: keyword-rich untuk SEO
- Gunakan 3-5 hashtag, tambahkan #Shorts kalau Shorts
- Style: informatif tapi engaging`
};

export async function adaptCaptionForPlatform(
  originalCaption: string,
  platform: Platform,
  brandName: string
): Promise<string> {
  // YouTube: tambahkan #Shorts jika konten shorts (simple rule, tidak perlu AI)
  if (platform === "youtube") {
    return originalCaption.includes("#Shorts")
      ? originalCaption
      : `${originalCaption}\n\n#Shorts`;
  }

  // Platform lain: pakai AI untuk adaptasi
  const client = getOpenAIClient();
  const system = `Kamu adalah content creator expert. Adapt caption berikut untuk ${platform.toUpperCase()}.

${PLATFORM_INSTRUCTIONS[platform]}

Aturan ketat:
- PERTAHankan pesan utama dan CTA dari caption asli
- JANGAN ubah fakta/informasi
- JANGAN tambahkan janji yang tidak ada di caption asli
- Output HANYA caption yang sudah diadaptasi, tanpa penjelasan tambahan`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      max_tokens: 1000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Brand: ${brandName}\n\nCaption asli:\n${originalCaption}` },
      ],
    });

    const result = completion.choices?.[0]?.message?.content?.trim();
    // Fallback: kalau AI gagal, return original
    return result || originalCaption;
  } catch (err) {
    console.error(`[adaptCaptionForPlatform] AI failed for ${platform}, using original:`, err);
    return originalCaption;
  }
}

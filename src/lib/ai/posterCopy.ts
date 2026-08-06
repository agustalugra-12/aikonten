import { getOpenAIClient } from "./openaiClient";

export type PosterCopy = {
  headline: string;
  subheadline: string | null;
  harga: string | null;
  cta: string;
  benefits: string[];
  isiTulisan: string | null;
};

// Teks yang DITEMPEL DI POSTER (headline/CTA/badge harga) - BEDA dari caption sosmed
// (generateContent.ts, itu teks di luar gambar, tempat postingnya). Dipanggil khusus utk
// jalur poster foto tunggal (2026-08-05, master prompt "Pelangi Homestay Poster Design
// System v1" dari Agus) - lihat posterDesign.ts utk cara teks ini ditempel ke gambar.
export async function generatePosterCopy(brandName: string, script: string): Promise<PosterCopy> {
  const client = getOpenAIClient();
  const system =
    "Kamu copywriter marketing hospitality. Dari skrip/ide konten, buat teks-teks singkat utk " +
    "ditempel di POSTER PROMOSI (bukan caption sosmed, ini teks YANG MUNCUL DI DALAM gambar): " +
    "headline (3-6 kata, catchy, Bahasa Indonesia), subheadline (opsional, 1 kalimat pendek, null " +
    "kalau tidak perlu), harga (versi SANGAT singkat spt 'Rp100.000' atau 'Mulai 100K', null KALAU " +
    "skrip tidak menyebut harga/promo sama sekali - JANGAN mengarang harga), cta (2-4 kata, huruf " +
    "besar, mis. 'BOOK NOW'/'RESERVASI SEKARANG'/'PESAN HARI INI'), benefits (array 2-4 fasilitas/" +
    "keunggulan SANGAT singkat yg relevan dari skrip, mis. ['Wifi Gratis','Sarapan','Kolam Renang'], " +
    "array kosong kalau tidak ada yg relevan disebut), isiTulisan (1 kalimat pendek tambahan kalau " +
    "perlu, null kalau headline+harga+cta sudah cukup jelas).";
  const user =
    `Brand: ${brandName}\n\nSkrip/ide:\n${script}\n\nBalas HARUS JSON valid (tanpa markdown code ` +
    `fence): {"headline":"...","subheadline":"..." atau null,"harga":"..." atau null,"cta":"...",` +
    `"benefits":["..."],"isiTulisan":"..." atau null}`;

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
    headline: parsed.headline || brandName,
    subheadline: parsed.subheadline || null,
    harga: parsed.harga || null,
    cta: parsed.cta || "BOOK NOW",
    benefits: Array.isArray(parsed.benefits) ? parsed.benefits : [],
    isiTulisan: parsed.isiTulisan || null,
  };
}

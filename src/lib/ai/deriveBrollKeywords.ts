import { getOpenAIClient } from "./openaiClient";

// Terjemahkan ide/skrip jadi kata kunci Bahasa Inggris utk cari video stok Pexels/
// Pixabay (2026-08-04, permintaan Agus - fallback "tidak ada footage asli utk ide
// UMUM" di auto-content/route.ts). BEDA dari brollKeywords di generateContent.ts (yg
// jalan SETELAH ada transkrip footage asli, sbg B-roll PENDAMPING) - fungsi ini dipanggil
// SEBELUM ada footage apa pun sama sekali, keyword digali langsung dari ide/skrip mentah.
//
// Prompt & fallback digeneralisasi (2026-08-10, bug nyata - versi lama asumsi input
// SELALU Bahasa Indonesia & fallback default HARDCODE "travel lifestyle", ikut jadi
// salah satu sumber bias hospitality yg bocor ke SEMUA brand termasuk yg bukan travel/
// penginapan - reused fungsi ini dipakai brand APA PUN, termasuk skrip dokumenter
// Bahasa Inggris YouTube Editorial Engine) - sekarang terima skrip BAHASA APA PUN,
// fallback netral "nature scenery" (B-roll ambient generik, tidak menganggap kontennya
// soal travel/penginapan). Panjang query DIBATASI di broll.ts (titik pusat, melindungi
// SEMUA sumber query B-roll sekaligus) - bukan di sini.
export async function deriveBrollKeywordsFromScript(script: string): Promise<string> {
  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "Convert this content idea/script (any language) into 2-4 short English keywords " +
          "to search for generic stock video footage matching its mood/subject (e.g. " +
          "'tropical mountain landscape', 'bird flying sky', 'cozy modern interior'). " +
          "Reply with ONLY the keywords (max 8 words total), no quotes/explanation.",
      },
      { role: "user", content: script },
    ],
    temperature: 0.3,
  });
  return completion.choices[0]?.message?.content?.trim() || "nature scenery";
}

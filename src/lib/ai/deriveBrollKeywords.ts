import { getOpenAIClient } from "./openaiClient";

// Terjemahkan ide/skrip Bahasa Indonesia jadi kata kunci Bahasa Inggris utk cari video
// stok Pexels/Pixabay (2026-08-04, permintaan Agus - fallback "tidak ada footage asli utk
// ide UMUM" di auto-content/route.ts). BEDA dari brollKeywords di generateContent.ts (yg
// jalan SETELAH ada transkrip footage asli, sbg B-roll PENDAMPING) - fungsi ini dipanggil
// SEBELUM ada footage apa pun sama sekali, keyword digali langsung dari ide/skrip mentah.
export async function deriveBrollKeywordsFromScript(script: string): Promise<string> {
  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "Ubah ide/skrip konten media sosial Bahasa Indonesia jadi 2-4 kata kunci Bahasa " +
          "INGGRIS singkat utk cari video stok generik yg suasananya cocok (mis. 'tropical " +
          "mountain landscape', 'travel lifestyle morning'). Balas HANYA kata kuncinya, " +
          "tanpa tanda kutip/penjelasan.",
      },
      { role: "user", content: script },
    ],
    temperature: 0.3,
  });
  return completion.choices[0]?.message?.content?.trim() || "travel lifestyle";
}

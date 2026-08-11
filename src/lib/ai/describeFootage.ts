import { getOpenAIClient } from "./openaiClient";

// "Footage Bank" auto-tagging (lihat memory proyek) - AI lihat foto/frame footage &
// bikin deskripsi+tag SENDIRI, Agus TIDAK perlu ketik apa pun pas upload ke bank.
// Dipakai lagi nanti oleh matchFootageBank.ts utk cocokkan bank ke skrip baru.
//
// Prompt digeneralisasi (2026-08-12, Fase 0 PRD Animal Story & Co - "homestay-bleed"
// bug class yg sama SUDAH ditemukan+diperbaiki 2026-08-10 di 5 tempat lain
// [generateContent.ts/researchTopics.ts/seasonalContext.ts/autoContent.ts/
// deriveBrollKeywords.ts, lihat komentar masing2] - fungsi ini LATEN belum kena krn
// footage_bank Animal Story & Co masih kosong [0 baris, 100% Pexels API live] saat bug
// class itu diaudit, tapi tetap bug yg sama begitu ada footage MILIK SENDIRI diupload
// utk brand non-hospitality mana pun. Fix SAMA POLA dgn deriveBrollKeywords.ts: prompt
// digeneralisasi total (bukan diparameterisasi per-brand) - fungsi ini murni deskripsi
// visual OBJEKTIF ("apa yang terlihat di foto ini"), tidak butuh konteks niche brand
// sama sekali utk bekerja benar.
export async function describeFootage(imageUrl: string): Promise<{ description: string; tags: string[] }> {
  const client = getOpenAIClient();
  const system =
    "Kamu asisten katalogisasi footage utk konten media sosial (brand APAPUN, jangan " +
    "asumsikan niche tertentu). Lihat foto/frame yang diberikan, buat deskripsi singkat " +
    "(1 kalimat, Bahasa Indonesia) & 3-6 tag singkat (kata benda/kondisi konkret, mis. " +
    "\"anjing\", \"hutan\", \"siang hari\", \"close-up\") yang menggambarkan ISI ASLI " +
    "foto ini SAJA - JANGAN mengarang detail yang tidak terlihat, JANGAN asumsikan " +
    "konteks bisnis/niche apa pun di luar yang benar-benar tampak di gambar.";
  const user =
    'Balas HARUS JSON valid (tanpa markdown code fence): {"description": "...", "tags": ["...", "..."]}';

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
    temperature: 0.5,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);
  return {
    description: parsed.description || "",
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}

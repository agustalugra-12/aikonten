import { getOpenAIClient } from "./openaiClient";

// "Footage Bank" auto-tagging (lihat memory proyek) - AI lihat foto/frame footage &
// bikin deskripsi+tag SENDIRI, Agus TIDAK perlu ketik apa pun pas upload ke bank.
// Dipakai lagi nanti oleh matchFootageBank.ts utk cocokkan bank ke skrip baru.
export async function describeFootage(imageUrl: string): Promise<{ description: string; tags: string[] }> {
  const client = getOpenAIClient();
  const system =
    "Kamu asisten katalogisasi footage utk bisnis homestay/hospitality. Lihat foto/" +
    "frame yang diberikan, buat deskripsi singkat (1 kalimat, Bahasa Indonesia) & 3-6 " +
    "tag singkat (kata benda/kondisi konkret, mis. \"kamar\", \"pemandangan\", " +
    "\"siang hari\", \"kolam renang\") yang menggambarkan ISI ASLI foto ini SAJA - " +
    "JANGAN mengarang detail yang tidak terlihat.";
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

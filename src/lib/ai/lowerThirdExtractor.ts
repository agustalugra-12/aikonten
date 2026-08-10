import { getOpenAIClient } from "./openaiClient";

// Lower Third (2026-08-10, "Overlay System PRD" Category A - "Animal Name", "Lower
// Third") - grafik intro klasik dokumenter: nama subjek + tagline pendek, muncul
// SEBENTAR di awal video. SAMA prinsip anti-halusinasi dgn statExtractor.ts - GPT
// cuma MERINGKAS apa yg SUDAH ada di narasi (nama hewan yg dibahas, sifat yg
// dideskripsikan), TIDAK PERNAH menambah fakta baru.
export type LowerThird = {
  name: string; // mis. "Octopus", "Blue Whale"
  tagline: string; // mis. "Master of Disguise" - deskriptif, bukan klaim fakta baru
};

export async function extractLowerThird(script: string): Promise<LowerThird | null> {
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Identify the main animal/subject of this narration for a documentary-style intro title card " +
            "(a \"lower third\"). Give: name (the animal's common name, 1-3 words, e.g. \"Octopus\", \"Blue Whale\") " +
            "and tagline (a short punchy descriptive phrase, max 6 words, based STRICTLY on what the narration " +
            "actually describes about it - e.g. \"Master of Disguise\", \"Ocean Giant\" - do not invent facts not " +
            "in the text). If the narration is not clearly about one identifiable animal/subject, return null for " +
            "both fields. IMPORTANT: name and tagline must NOT contain apostrophes or contractions. " +
            'Reply ONLY with JSON: {"name": string|null, "tagline": string|null}.',
        },
        { role: "user", content: script },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    if (typeof parsed.name !== "string" || !parsed.name || typeof parsed.tagline !== "string" || !parsed.tagline) {
      return null;
    }
    return {
      name: parsed.name.replace(/'/g, ""),
      tagline: parsed.tagline.replace(/'/g, ""),
    };
  } catch (err) {
    console.error("[lowerThirdExtractor] gagal ekstrak lower third, lanjut tanpa itu:", err);
    return null;
  }
}

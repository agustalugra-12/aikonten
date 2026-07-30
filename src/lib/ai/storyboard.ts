import OpenAI from "openai";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

export type StoryboardScene = {
  sceneNumber: number;
  durationSeconds: number;
  visualDescription: string;
  cameraNotes: string;
  narrationLine: string;
};

// "Storyboard Engine" - shot list PRA-produksi (lihat memory proyek: dibaca Agus
// SEBELUM syuting, bukan bagian dari pipeline upload->process yg sudah ada). AI pecah
// skrip jadi 3-6 adegan konkret (hook->isi->CTA) yg BENAR-BENAR bisa difilmkan di
// lokasi asli - SENGAJA diminta jangan mengarang lokasi/properti yg belum tentu ada.
export async function generateStoryboard(script: string, brandName: string): Promise<StoryboardScene[]> {
  const client = getClient();
  const system =
    "Kamu sutradara konten video pendek utk bisnis lokal Indonesia. Pecah skrip/brief " +
    "jadi 3-6 adegan (scene) konkret yg mengikuti struktur hook->isi->CTA. Tiap adegan " +
    "HARUS instruksi visual yg BISA LANGSUNG DIFILMKAN di lokasi asli bisnis ini - " +
    "JANGAN mengarang properti/lokasi/dekorasi yg belum tentu ada. narrationLine boleh " +
    "kosong string kalau adegan itu murni visual tanpa narasi/voice-over.";
  const user =
    `Brand: ${brandName}\n\nSkrip/brief:\n${script}\n\n` +
    `Balas HARUS JSON valid (tanpa markdown code fence): {"scenes": [` +
    `{"sceneNumber": 1, "durationSeconds": 5, "visualDescription": "...", "cameraNotes": "...", "narrationLine": "..."}` +
    `, ...]}`;

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
  return Array.isArray(parsed.scenes) ? parsed.scenes : [];
}

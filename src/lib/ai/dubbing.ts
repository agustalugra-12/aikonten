import OpenAI from "openai";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

// AI Dubbing (lihat memory proyek - Agus konfirmasi: GANTI TOTAL suara asli syuting,
// bukan tambahan/mixing). Pakai "tts-1" (BUKAN "tts-1-hd") - jauh lebih murah per
// karakter, cukup utk narasi caption pendek (permintaan Agus: prioritaskan murah).
// Teks narasinya REUSE caption yg SUDAH di-generate (bukan panggilan GPT baru) - caption
// sudah ditulis sbg prosa natural jadi cocok dibacakan apa adanya, hemat 1 panggilan AI.
export async function generateVoiceover(text: string): Promise<Buffer> {
  const client = getClient();
  const response = await client.audio.speech.create({
    model: "tts-1",
    voice: "alloy",
    input: text,
  });
  return Buffer.from(await response.arrayBuffer());
}

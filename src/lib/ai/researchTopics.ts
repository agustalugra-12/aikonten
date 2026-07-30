import OpenAI from "openai";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

// "Research Engine" versi ringan (keputusan Agus: pakai pengetahuan GPT saja, BUKAN
// integrasi API tren berbayar - lihat memory proyek) - AI usul ide konten berdasarkan
// niche brand + tanggal skrg (relevansi musiman) + histori skrip brand ini sendiri
// (biar tidak ngulang ide yg sama). BUKAN data tren real-time asli, cuma usulan
// masuk akal dari pengetahuan umum model.
export async function suggestContentIdeas(
  brandName: string,
  brandDescription: string | null,
  recentScripts: string[]
): Promise<string[]> {
  const client = getClient();
  const today = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

  const system =
    "Kamu content strategist media sosial utk bisnis lokal Indonesia. Usulkan 3-5 ide " +
    "brief konten singkat (1-2 kalimat tiap ide, Bahasa Indonesia) yang RELEVAN dgn " +
    "niche brand & musim/tanggal sekarang. Ide harus konkret & bisa langsung difilmkan " +
    "dgn footage asli (bukan konsep abstrak) - fokus ke hal yg BENAR-BENAR ada di " +
    "tempat/bisnis semacam ini, JANGAN mengarang fasilitas/promo yg belum tentu ada. " +
    "JANGAN ulangi ide yg mirip dgn skrip yg sudah pernah dipakai brand ini.";
  const user =
    `Brand: ${brandName}\nDeskripsi/niche: ${brandDescription || "(tidak ada deskripsi)"}\n` +
    `Tanggal hari ini: ${today}\n\n` +
    `Skrip yg sudah pernah dipakai (JANGAN diulang):\n${recentScripts.length ? recentScripts.map((s) => `- ${s}`).join("\n") : "(belum ada)"}\n\n` +
    `Balas HARUS JSON valid (tanpa markdown code fence): {"ideas": ["...", "...", "..."]}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.8,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);
  return Array.isArray(parsed.ideas) ? parsed.ideas : [];
}

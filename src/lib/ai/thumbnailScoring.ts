import { getOpenAIClient } from "./openaiClient";

// Thumbnail System upgrade (PRD §15, Task Plan 7) - SATU panggilan vision (gpt-4.1-mini,
// bukan image-generation - konfirmasi eksplisit ke Agus sebelum dibangun, lihat catatan
// lengkap di frameExtract.ts soal kenapa dia sebelumnya menolak biaya thumbnail: ini biaya
// vision-teks yg jauh lebih kecil dari $0.08/gambar Nano Banana yg pernah dipakai, bukan
// generate gambar baru). Menilai SEMUA kandidat SEKALIGUS dlm 1 call (bukan per-frame) -
// hemat, & biar model bisa BANDINGKAN antar kandidat langsung drpd skor absolut terpisah.
export type ThumbnailCandidateScore = {
  index: number;
  url: string;
  score: number; // 0-100
  reasoning: string;
};

export async function scoreThumbnailCandidates(
  imageUrls: string[],
  captionOrTitle: string,
  brandName: string
): Promise<ThumbnailCandidateScore[]> {
  if (imageUrls.length === 0) return [];
  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          `Kamu thumbnail director utk brand "${brandName}". Kamu diberi ${imageUrls.length} ` +
          "kandidat frame (diberi urutan index 0 dst sesuai urutan gambar) dari BAGIAN HOOK " +
          "sebuah video. Nilai TIAP kandidat 0-100 sbg calon thumbnail YouTube, pertimbangkan: " +
          "ekspresi emosi (kalau ada orang/wajah), kejelasan visual (tidak blur/gelap), " +
          "keunggulan subjek utama (menonjol, tidak tenggelam background), curiosity (bikin " +
          "penasaran klik), komposisi, brightness, & relevansi ke judul/caption yg diberikan. " +
          "Balas HARUS JSON valid (tanpa markdown code fence): {\"candidates\": " +
          "[{\"index\": 0, \"score\": 0-100, \"reasoning\": \"maks 15 kata\"}, ...]} - urutkan " +
          "berdasarkan index ASLI (0 s.d. N-1), JANGAN skip index manapun.",
      },
      {
        role: "user",
        content: [
          { type: "text" as const, text: `Judul/caption video: ${captionOrTitle.slice(0, 200)}` },
          ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ],
      },
    ],
    temperature: 0.3,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  const cleaned = raw.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    const scored: ThumbnailCandidateScore[] = candidates
      .filter((c: Record<string, unknown>) => typeof c?.index === "number" && c.index >= 0 && c.index < imageUrls.length)
      .map((c: Record<string, unknown>) => ({
        index: c.index as number,
        url: imageUrls[c.index as number],
        score: typeof c.score === "number" ? Math.max(0, Math.min(100, Math.round(c.score))) : 50,
        reasoning: typeof c.reasoning === "string" ? c.reasoning : "",
      }));
    // Jaring pengaman KODE (sama disiplin dgn file lain di app ini) - kalau model gagal
    // balas SEMUA index (mis. skip beberapa), lengkapi sisanya skor netral drpd hilang.
    const coveredIndices = new Set(scored.map((c) => c.index));
    for (let i = 0; i < imageUrls.length; i++) {
      if (!coveredIndices.has(i)) scored.push({ index: i, url: imageUrls[i], score: 50, reasoning: "" });
    }
    return scored.sort((a, b) => b.score - a.score);
  } catch {
    // Gagal parse total - fallback skor netral SEMUA kandidat (urutan asli tetap
    // dipertahankan sbg tie-break), JANGAN gagalkan seluruh render cuma krn scoring gagal.
    return imageUrls.map((url, index) => ({ index, url, score: 50, reasoning: "" }));
  }
}

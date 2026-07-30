import { searchPexelsVideo } from "./pexels";
import { searchPixabayVideo } from "./pixabay";

export type BrollResult = {
  videoUrl: string;
  durationSeconds: number;
  source: "pexels" | "pixabay";
};

// Pexels diutamakan (video umumnya kualitas lebih konsisten), Pixabay jadi cadangan
// kalau Pexels tidak ketemu hasil - lebih kaya pilihan footage (permintaan Agus).
// Kedua sumber OPSIONAL: kalau API key salah satu belum diisi, tahap itu dilewati
// (bukan dianggap error) - B-roll tetap "pendamping", bukan bagian wajib pipeline.
export async function searchBrollVideo(query: string): Promise<BrollResult | null> {
  if (process.env.PEXELS_API_KEY) {
    try {
      const pexels = await searchPexelsVideo(query);
      if (pexels) return { ...pexels, source: "pexels" };
    } catch (err) {
      console.error("[broll] Pexels gagal, coba Pixabay:", err);
    }
  }

  if (process.env.PIXABAY_API_KEY) {
    try {
      const pixabay = await searchPixabayVideo(query);
      if (pixabay) return { ...pixabay, source: "pixabay" };
    } catch (err) {
      console.error("[broll] Pixabay juga gagal:", err);
    }
  }

  return null;
}

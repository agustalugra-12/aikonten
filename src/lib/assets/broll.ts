import { searchPexelsVideo } from "./pexels";
import { searchPixabayVideo } from "./pixabay";

export type BrollResult = {
  videoUrl: string;
  durationSeconds: number;
  source: "pexels" | "pixabay";
  // Metadata lisensi (2026-08-08, PRD "YouTube Content & Monetization Safety System"
  // Section 16) - diteruskan apa adanya dari pexels.ts/pixabay.ts, dipakai pemanggil
  // (processProject.ts) utk isi media_assets.source_creator/source_url saat mencatat
  // broll_used. Query pencarian yang menghasilkannya (source_query) SENGAJA tidak ada
  // di sini - pemanggil sudah py variable `query`-nya sendiri, tidak perlu bolak-balik.
  creator: string;
  sourceUrl: string;
};

// Pexels diutamakan (video umumnya kualitas lebih konsisten), Pixabay jadi cadangan
// kalau Pexels tidak ketemu hasil - lebih kaya pilihan footage (permintaan Agus).
// Kedua sumber OPSIONAL: kalau API key salah satu belum diisi, tahap itu dilewati
// (bukan dianggap error) - B-roll tetap "pendamping", bukan bagian wajib pipeline.
//
// excludeUrls (2026-08-05, anti-monoton - lihat footageVariety.ts) diteruskan ke kedua
// sumber, supaya klip yg BARU dipakai brand ini tidak terpilih lagi persis sama.
export async function searchBrollVideo(query: string, excludeUrls: Set<string> = new Set()): Promise<BrollResult | null> {
  if (process.env.PEXELS_API_KEY) {
    try {
      const pexels = await searchPexelsVideo(query, excludeUrls);
      if (pexels) return { videoUrl: pexels.videoUrl, durationSeconds: pexels.durationSeconds, source: "pexels", creator: pexels.photographer, sourceUrl: pexels.pageUrl };
    } catch (err) {
      console.error("[broll] Pexels gagal, coba Pixabay:", err);
    }
  }

  if (process.env.PIXABAY_API_KEY) {
    try {
      const pixabay = await searchPixabayVideo(query, excludeUrls);
      if (pixabay) return { videoUrl: pixabay.videoUrl, durationSeconds: pixabay.durationSeconds, source: "pixabay", creator: pixabay.photographer, sourceUrl: pixabay.pageUrl };
    } catch (err) {
      console.error("[broll] Pixabay juga gagal:", err);
    }
  }

  return null;
}

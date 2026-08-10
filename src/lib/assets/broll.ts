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
//
// KEPUTUSAN (2026-08-08, PRD "YouTube Content & Monetization Safety System" Section
// 13-14 minta Mixkit sbg fallback ke-3): Mixkit TIDAK punya API publik (dicek langsung
// via WebSearch + halaman resmi mixkit.co/llm-info, bukan asumsi) - satu-satunya cara
// otomatis adalah scraping, fragile & beresiko ToS, jadi SENGAJA TIDAK dibangun.
// Pexels+Pixabay TETAP jadi 2 sumber permanen (bukan sementara nunggu Mixkit) - kalau
// keduanya gagal, `searchBrollVideo` return null & pemanggil (processProject.ts) sudah
// menangani dgn error jelas "Footage/B-roll tidak cukup" (video GAGAL generate drpd
// dipaksa terbit dgn footage kurang) - ini SUDAH memenuhi maksud "NEEDS_REVIEW, DO NOT
// AUTO-PUBLISH" dari PRD, cuma beda mekanisme (exception vs status field eksplisit).
// Kalau nanti mau sumber ke-3 sungguhan, cari yang py API resmi (mis. Videezy) - jangan
// scraping.
// Query MAKSIMAL ~90 karakter (2026-08-10, bug nyata - batch produksi Animal Story &
// Co: 2 dari 6 video GAGAL total krn query >100 karakter, Pixabay tolak eksplisit
// ("Search query 'q' may not exceed 100 characters"), Pexels JUGA ikut gagal (400
// Invalid query) - instruksi prompt "keyword singkat" di deriveBrollKeywords.ts/
// generateContent.ts TIDAK SELALU dipatuhi model utk skrip panjang. Dipangkas di SATU
// titik pusat sini (bukan di tiap pemanggil) - melindungi SEMUA sumber query (skrip
// dokumenter YouTube, brollKeywords caption Pelangi, dst) sekaligus.
const MAX_BROLL_QUERY_CHARS = 90;

function capQueryLength(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length <= MAX_BROLL_QUERY_CHARS) return trimmed;
  const cut = trimmed.slice(0, MAX_BROLL_QUERY_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
}

export async function searchBrollVideo(query: string, excludeUrls: Set<string> = new Set()): Promise<BrollResult | null> {
  const cappedQuery = capQueryLength(query);
  if (process.env.PEXELS_API_KEY) {
    try {
      const pexels = await searchPexelsVideo(cappedQuery, excludeUrls);
      if (pexels) return { videoUrl: pexels.videoUrl, durationSeconds: pexels.durationSeconds, source: "pexels", creator: pexels.photographer, sourceUrl: pexels.pageUrl };
    } catch (err) {
      console.error("[broll] Pexels gagal, coba Pixabay:", err);
    }
  }

  if (process.env.PIXABAY_API_KEY) {
    try {
      const pixabay = await searchPixabayVideo(cappedQuery, excludeUrls);
      if (pixabay) return { videoUrl: pixabay.videoUrl, durationSeconds: pixabay.durationSeconds, source: "pixabay", creator: pixabay.photographer, sourceUrl: pixabay.pageUrl };
    } catch (err) {
      console.error("[broll] Pixabay juga gagal:", err);
    }
  }

  return null;
}

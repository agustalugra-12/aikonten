const PIXABAY_VIDEO_SEARCH_URL = "https://pixabay.com/api/videos/";

export type PixabayVideoResult = {
  videoUrl: string;
  durationSeconds: number;
  photographer: string;
  // Sama alasannya dgn PexelsVideoResult.pageUrl (lihat pexels.ts) - Section 16 PRD
  // "Footage License Tracking".
  pageUrl: string;
};

// Sumber KEDUA utk B-roll (lihat pexels.ts) - dipakai sbg fallback kalau Pexels tidak
// ketemu hasil relevan, biar pilihan footage lebih kaya (permintaan Agus).
//
// Anti-monoton (2026-08-05, sama alasannya dgn pexels.ts) - dulu per_page=3, SELALU
// ambil hasil PERTAMA. Sekarang pilih ACAK di antara kandidat, excludeUrls (riwayat
// klip yg baru dipakai brand ini) disingkirkan dulu kalau memungkinkan.
//
// Paginasi (2026-08-06, sama alasannya dgn pexels.ts - opsi durasi panjang 3/5/8 menit
// utk YT butuh lebih banyak klip B-roll unik drpd yg bisa disediakan 1 page/8 kandidat).
const MAX_PAGES_TRIED = 5;

export async function searchPixabayVideo(
  query: string,
  excludeUrls: Set<string> = new Set()
): Promise<PixabayVideoResult | null> {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) throw new Error("PIXABAY_API_KEY belum diisi di .env");

  type PixabayHit = { videos?: { small?: { url: string }; medium?: { url: string }; tiny?: { url: string } }; duration: number; user?: string; pageURL?: string };

  let allSeenCandidates: PixabayVideoResult[] = [];

  for (let page = 1; page <= MAX_PAGES_TRIED; page++) {
    const url = `${PIXABAY_VIDEO_SEARCH_URL}?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=8&page=${page}&safesearch=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Pixabay API error: ${res.status} ${await res.text()}`);

    const data = await res.json();
    const hits = data.hits || [];
    if (hits.length === 0) break; // halaman ini kosong - hasil Pixabay sudah habis, tidak ada gunanya coba page berikutnya

    const candidates = (hits as PixabayHit[])
      .map((hit) => {
        // "small" (1920x1080) - kualitas cukup utk sosmed, tidak sebesar "large"/"medium" yg
        // bikin proses lebih lama.
        const file = hit.videos?.small || hit.videos?.medium || hit.videos?.tiny;
        if (!file) return null;
        return {
          videoUrl: file.url,
          durationSeconds: Math.round(hit.duration),
          photographer: hit.user || "Pixabay",
          pageUrl: hit.pageURL || "",
        };
      })
      .filter((c): c is PixabayVideoResult => c !== null);

    allSeenCandidates = allSeenCandidates.concat(candidates);
    const fresh = candidates.filter((c) => !excludeUrls.has(c.videoUrl));
    if (fresh.length > 0) {
      return fresh[Math.floor(Math.random() * fresh.length)];
    }
  }

  if (allSeenCandidates.length === 0) return null;
  return allSeenCandidates[Math.floor(Math.random() * allSeenCandidates.length)];
}

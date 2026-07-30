const PIXABAY_VIDEO_SEARCH_URL = "https://pixabay.com/api/videos/";

export type PixabayVideoResult = {
  videoUrl: string;
  durationSeconds: number;
  photographer: string;
};

// Sumber KEDUA utk B-roll (lihat pexels.ts) - dipakai sbg fallback kalau Pexels tidak
// ketemu hasil relevan, biar pilihan footage lebih kaya (permintaan Agus).
export async function searchPixabayVideo(query: string): Promise<PixabayVideoResult | null> {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) throw new Error("PIXABAY_API_KEY belum diisi di .env");

  const url = `${PIXABAY_VIDEO_SEARCH_URL}?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=3&safesearch=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const hit = data.hits?.[0];
  if (!hit) return null;

  // "small" (1920x1080) - kualitas cukup utk sosmed, tidak sebesar "large"/"medium" yg
  // bikin upload+transcode Cloudinary lebih lama.
  const file = hit.videos?.small || hit.videos?.medium || hit.videos?.tiny;
  if (!file) return null;

  return {
    videoUrl: file.url,
    durationSeconds: Math.round(hit.duration),
    photographer: hit.user || "Pixabay",
  };
}

const PEXELS_VIDEO_SEARCH_URL = "https://api.pexels.com/videos/search";

export type PexelsVideoResult = {
  videoUrl: string;
  durationSeconds: number;
  photographer: string;
};

// B-roll "pendamping" (lihat PRD diskusi - Agus TIDAK mau full AI-generated content,
// cuma tambahan stok footage relevan di samping footage asli sendiri). Pexels dipilih
// krn gratis & video-nya berlisensi bebas pakai (termasuk komersial) tanpa atribusi wajib.
export async function searchPexelsVideo(query: string): Promise<PexelsVideoResult | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY belum diisi di .env");

  const url = `${PEXELS_VIDEO_SEARCH_URL}?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(`Pexels API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const video = data.videos?.[0];
  if (!video) return null;

  type PexelsVideoFile = { link: string; quality: string; width: number; height: number };
  const files: PexelsVideoFile[] = video.video_files || [];
  // Prioritas kualitas "hd" (720p-1080p, cukup utk konten sosmed, tidak sebesar 4K yg
  // bikin upload+transcode Cloudinary lebih lama) - kalau tidak ada, pakai apa saja yg ada.
  const file = files.find((f) => f.quality === "hd") || files[0];
  if (!file) return null;

  return {
    videoUrl: file.link,
    durationSeconds: Math.round(video.duration),
    photographer: video.user?.name || "Pexels",
  };
}

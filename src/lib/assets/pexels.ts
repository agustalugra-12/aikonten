const PEXELS_VIDEO_SEARCH_URL = "https://api.pexels.com/videos/search";

export type PexelsVideoResult = {
  videoUrl: string;
  durationSeconds: number;
  photographer: string;
};

// B-roll "pendamping" (lihat PRD diskusi - Agus TIDAK mau full AI-generated content,
// cuma tambahan stok footage relevan di samping footage asli sendiri). Pexels dipilih
// krn gratis & video-nya berlisensi bebas pakai (termasuk komersial) tanpa atribusi wajib.
//
// PENTING (2026-08-05, permintaan Agus - "footage pexels jangan monoton, TikTok
// anggap konten berulang, ini penting sekali"): dulu per_page=1, SELALU ambil hasil
// PERTAMA - jadi query yg sama (mis. landmark "danau beratan") SELALU balikin klip
// Pexels yg PERSIS SAMA tiap kali video digenerate ulang (bukti nyata sesi ini: video
// 1 & video 2 pakai klip identik). Sekarang ambil beberapa kandidat (per_page=8) &
// pilih ACAK di antaranya (bukan selalu #1) - excludeUrls (dari footageVariety.ts,
// riwayat klip yg baru dipakai brand ini) disingkirkan dulu kalau memungkinkan, jadi
// bukan cuma acak tapi jg aktif menghindari pengulangan nyata.
export async function searchPexelsVideo(
  query: string,
  excludeUrls: Set<string> = new Set()
): Promise<PexelsVideoResult | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY belum diisi di .env");

  const url = `${PEXELS_VIDEO_SEARCH_URL}?query=${encodeURIComponent(query)}&per_page=8&orientation=portrait`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(`Pexels API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const videos = data.videos || [];
  if (videos.length === 0) return null;

  type PexelsVideoFile = { link: string; quality: string; width: number; height: number };
  type PexelsVideo = { video_files?: PexelsVideoFile[]; duration: number; user?: { name: string } };

  const candidates = (videos as PexelsVideo[])
    .map((video) => {
      const files = video.video_files || [];
      // Prioritas kualitas "hd" (720p-1080p, cukup utk konten sosmed, tidak sebesar 4K yg
      // bikin proses lebih lama) - kalau tidak ada, pakai apa saja yg ada.
      const file = files.find((f) => f.quality === "hd") || files[0];
      if (!file) return null;
      return { videoUrl: file.link, durationSeconds: Math.round(video.duration), photographer: video.user?.name || "Pexels" };
    })
    .filter((c): c is PexelsVideoResult => c !== null);

  if (candidates.length === 0) return null;

  const fresh = candidates.filter((c) => !excludeUrls.has(c.videoUrl));
  const pool = fresh.length > 0 ? fresh : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

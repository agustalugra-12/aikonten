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
// Paginasi (2026-08-06, permintaan Agus - opsi durasi panjang 3/5/8 menit utk YT) -
// SEBELUM ini SELALU page 1 (8 kandidat tetap) - video PENDEK (target lama 30-90dtk)
// jarang butuh >8 klip B-roll unik jadi tidak ketahuan, TAPI video PANJANG bisa butuh
// puluhan klip B-roll (real footage Pelangi sendiri cuma ~3,5 menit total, jauh di
// bawah target 8 menit) - begitu ke-8 kandidat page 1 habis ke-exclude, kode LAMA
// fallback diam2 ke `candidates` (page 1 lagi) & pilih ACAK - artinya klip yg SAMA bisa
// terpilih BERULANG dalam 1 video, PERSIS kelas masalah "monoton" yg sudah pernah
// dikeluhkan Agus sebelumnya. Sekarang coba beberapa page berturut sampai ketemu
// kandidat yg BENERAN belum dipakai, baru fallback ke pengulangan kalau SELURUH page
// yg dicoba tetap habis (drpd tidak return apa2 sama sekali).
const MAX_PAGES_TRIED = 5;

export async function searchPexelsVideo(
  query: string,
  excludeUrls: Set<string> = new Set()
): Promise<PexelsVideoResult | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY belum diisi di .env");

  type PexelsVideoFile = { link: string; quality: string; width: number; height: number };
  type PexelsVideo = { video_files?: PexelsVideoFile[]; duration: number; user?: { name: string } };

  let allSeenCandidates: PexelsVideoResult[] = [];

  for (let page = 1; page <= MAX_PAGES_TRIED; page++) {
    const url = `${PEXELS_VIDEO_SEARCH_URL}?query=${encodeURIComponent(query)}&per_page=8&page=${page}&orientation=portrait`;
    const res = await fetch(url, { headers: { Authorization: apiKey } });
    if (!res.ok) throw new Error(`Pexels API error: ${res.status} ${await res.text()}`);

    const data = await res.json();
    const videos = data.videos || [];
    if (videos.length === 0) break; // halaman ini kosong - situs Pexels sudah habis hasilnya, tidak ada gunanya coba page berikutnya

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

    allSeenCandidates = allSeenCandidates.concat(candidates);
    const fresh = candidates.filter((c) => !excludeUrls.has(c.videoUrl));
    if (fresh.length > 0) {
      return fresh[Math.floor(Math.random() * fresh.length)];
    }
  }

  // Semua page yg dicoba TERNYATA habis - drpd return null sama sekali (bikin video
  // gagal generate cuma krn kehabisan variasi), fallback ke PENGULANGAN (lebih baik
  // klip berulang drpd video gagal total) - sama perilaku toleran spt kode lama, TAPI
  // sekarang baru terjadi setelah benar2 habis sampai 5 page (40 kandidat), bukan cuma
  // page 1 (8 kandidat).
  if (allSeenCandidates.length === 0) return null;
  return allSeenCandidates[Math.floor(Math.random() * allSeenCandidates.length)];
}

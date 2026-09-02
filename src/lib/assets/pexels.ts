const PEXELS_VIDEO_SEARCH_URL = "https://api.pexels.com/videos/search";

export type PexelsVideoResult = {
  videoUrl: string;
  durationSeconds: number;
  photographer: string;
  // Link halaman ASLI video ini di pexels.com (2026-08-08, PRD "YouTube Content &
  // Monetization Safety System" Section 16 "Footage License Tracking") - dipakai
  // sbg jejak audit sumber/lisensi, disimpan ke media_assets.source_url (lihat
  // broll.ts & processProject.ts). BEDA dari `videoUrl` (link file CDN mp4 langsung,
  // bisa expired/berubah) - link halaman ini stabil utk ditelusuri manusia nanti.
  pageUrl: string;
  // ID unik video di Pexels (dari API response `video.id`). Dipakai sbg kunci
  // anti-duplicate PERSIS — URL file CDN bisa beda resolusi/berubah, tapi ID
  // video Pexels tetap sama. Dipakai utk dedup PERSIS di 1 video & cross-project
  // (PRD "Update AI Konten — Script & Footage" v1.1 §3, 2026-08-22).
  pexelsVideoId: string;
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
  excludeUrls: Set<string> = new Set(),
  excludeVideoIds: Set<string> = new Set(),
  // Content Clarity/Relevance (2026-09-02, PRD Agustap Studio "Contextual Footage") -
  // filter kandidat yang pageUrl-nya mengandung kata terlarang (mis. trading/crypto utk
  // konten UMKM). Default array kosong = TIDAK ADA filter, perilaku 100% sama utk semua
  // caller existing (brand lain) - opsional & backward compatible, bukan behavior baru
  // yang dipaksakan global.
  blockTitleKeywords: string[] = []
): Promise<PexelsVideoResult | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY belum diisi di .env");

  type PexelsVideoFile = { link: string; quality: string; width: number; height: number };
  type PexelsVideo = { 
    id: string;
    video_files?: PexelsVideoFile[]; 
    duration: number; 
    user?: { name: string }; 
    url?: string 
  };

  for (let page = 1; page <= MAX_PAGES_TRIED; page++) {
    const url = `${PEXELS_VIDEO_SEARCH_URL}?query=${encodeURIComponent(query)}&per_page=8&page=${page}&orientation=portrait`;
    const res = await fetch(url, { headers: { Authorization: apiKey } });
    if (!res.ok) throw new Error(`Pexels API error: ${res.status} ${await res.text()}`);

    const data = await res.json();
    const videos = data.videos || [];
    if (videos.length === 0) break;

    const candidates = (videos as PexelsVideo[])
      .map((video) => {
        const files = video.video_files || [];
        const file = files.find((f) => f.quality === "hd") || files[0];
        if (!file) return null;
        return {
          videoUrl: file.link,
          durationSeconds: Math.round(video.duration),
          photographer: video.user?.name || "Pexels",
          pageUrl: video.url || "",
          pexelsVideoId: String(video.id), // ID unik video Pexels (utk dedup PERSIS)
        };
      })
      .filter((c): c is PexelsVideoResult => c !== null);

    // Dedup PERSIS: exclude by BOTH videoUrl AND pexelsVideoId
    // (URL file CDN bisa beda resolusi, tapi pexelsVideoId tetap sama → blokir)
    const fresh = candidates.filter(
      (c) =>
        !excludeUrls.has(c.videoUrl) &&
        !excludeVideoIds.has(c.pexelsVideoId) &&
        !blockTitleKeywords.some((kw) => c.pageUrl.toLowerCase().includes(kw.toLowerCase()))
    );
    if (fresh.length > 0) {
      return fresh[Math.floor(Math.random() * fresh.length)];
    }
  }

  // Semua page yg dicoba TERNYATA habis - drpd return null sama sekali (bikin video
  // gagal generate cuma krn kehabisan variasi), fallback ke pengulangan (lebih baik
  // klip berulang drpd video gagal total) - sama perilaku toleran spt kode lama, TAPI
  // sekarang baru terjadi setelah benar2 habis sampai 5 page (40 kandidat), bukan cuma
  // page 1 (8 kandidat).
  return null;
}

import type { Publisher, PublishInput, PublishResult } from "./types";

// YouTube Data API v3 - BEDA dari IG/FB (yang cukup kasih URL video), YouTube Data API
// mewajibkan upload BYTES video langsung (resumable upload), tidak bisa cuma kasih URL.
// Jadi di sini kita ambil dulu file dari storage kita, baru upload streamnya ke YouTube.
// Mode OAuth "testing" (lihat PRD diskusi) cukup utk akun brand milik sendiri sbg test
// user, tanpa perlu verifikasi Google penuh. BELUM pernah dites ke akun nyata.
//
// SENGAJA pakai fetch mentah ke REST API, BUKAN package `googleapis` - package itu
// generate TYPE utk SEMUA API Google (bukan cuma YouTube), dan ditemukan nyata bikin
// TypeScript kehabisan memori saat build di server ini (2026-07-30, OOM "JavaScript
// heap out of memory" saat type-check, di VPS dgn RAM terbatas - lihat PRD diskusi soal
// kondisi server). Resumable upload protocol-nya didokumentasikan publik & cukup simpel
// utk diimplementasikan langsung tanpa SDK segede itu.
const YOUTUBE_UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3/videos";
const YOUTUBE_THUMBNAIL_BASE = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";

// Thumbnail custom (Thumbnail Engine, lihat lib/ai/thumbnail.ts) - OPSIONAL, kalau
// gagal JANGAN gagalkan publish videonya (video sendiri sudah berhasil) - cuma log,
// video tetap terpublish dgn thumbnail otomatis YouTube (frame dari videonya sendiri).
async function setThumbnail(videoId: string, thumbnailUrl: string, accessToken: string): Promise<void> {
  const imgRes = await fetch(thumbnailUrl);
  if (!imgRes.ok) throw new Error(`Gagal ambil file thumbnail: ${imgRes.status}`);
  const contentType = imgRes.headers.get("content-type") || "image/png";

  const res = await fetch(`${YOUTUBE_THUMBNAIL_BASE}?videoId=${videoId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType },
    body: imgRes.body,
    duplex: "half",
  } as RequestInit);
  if (!res.ok) throw new Error(`Gagal set thumbnail: ${res.status} ${await res.text()}`);
}

export const publishToYoutube: Publisher = async (input: PublishInput): Promise<PublishResult> => {
  const { videoUrl, caption, accessToken, thumbnailUrl } = input;
  if (!videoUrl) {
    return { success: false, error: "YouTube cuma menerima video, tidak ada videoUrl" };
  }
  if (!accessToken) {
    return { success: false, error: "Access token belum dikonfigurasi" };
  }

  try {
    const fileRes = await fetch(videoUrl);
    if (!fileRes.ok || !fileRes.body) {
      throw new Error(`Gagal ambil file video dari storage: ${fileRes.status}`);
    }
    const contentLength = fileRes.headers.get("content-length");
    const contentType = fileRes.headers.get("content-type") || "video/mp4";

    const [title, ...descParts] = caption.split("\n");
    const metadata = {
      snippet: {
        title: title.slice(0, 100) || "Video",
        description: descParts.join("\n") || caption,
      },
      status: { privacyStatus: "public" },
    };

    // Langkah 1: mulai sesi resumable upload, dapatkan URL upload dari header Location.
    const initRes = await fetch(`${YOUTUBE_UPLOAD_BASE}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        ...(contentLength ? { "X-Upload-Content-Length": contentLength } : {}),
        "X-Upload-Content-Type": contentType,
      },
      body: JSON.stringify(metadata),
    });
    if (!initRes.ok) {
      throw new Error(`Gagal mulai upload session: ${initRes.status} ${await initRes.text()}`);
    }
    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) throw new Error("YouTube tidak mengembalikan upload URL (header Location)");

    // Langkah 2: PUT bytes video ke upload URL.
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: fileRes.body,
      duplex: "half",
    } as RequestInit);
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(JSON.stringify(uploadData));

    if (thumbnailUrl && uploadData.id) {
      try {
        await setThumbnail(uploadData.id, thumbnailUrl, accessToken);
      } catch (err) {
        console.error("[youtube] Video terpublish tapi gagal set thumbnail:", err);
      }
    }

    return {
      success: true,
      platformPostId: uploadData.id,
      postUrl: uploadData.id ? `https://youtube.com/watch?v=${uploadData.id}` : undefined,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const YOUTUBE_VIDEOS_LIST_URL = "https://www.googleapis.com/youtube/v3/videos";

export type YoutubeVideoMetric = { name: string; value: number; unit: string; type: string };

// Analytics Learning Loop - jalur NATIVE (2026-08-08, PRD "YouTube Content &
// Monetization Safety System" Section 41) - performanceLearning.ts SEBELUM ini SELALU
// panggil getPostMetrics (bufferAuth.ts, GraphQL Buffer) utk SEMUA platform tanpa
// pandang publishVia - itu BENAR utk platform Buffer-mediated (TikTok, IG kadang), TAPI
// YouTube publish di app ini lewat native OAuth (lihat komentar publishVia di
// db/schema.ts) - post YouTube TIDAK PERNAH melalui Buffer sama sekali, jadi
// platformPostId-nya (video ID YouTube asli) tidak dikenal Buffer API sama sekali,
// query metrik akan gagal diam-diam. Fungsi ini pengganti utk cabang native: `videos.list`
// (endpoint publik stabil YouTube Data API v3, sudah lama tidak berubah kontraknya) ambil
// viewCount/likeCount/commentCount asli, engagementRate DIHITUNG sendiri (YouTube API
// tidak kasih field ini langsung) = (like+comment)/view*100, dibungkus jadi bentuk yg
// SAMA persis dgn BufferMetric (name/value/unit/type) supaya performanceLearning.ts bisa
// pakai SATU logika baca metrics utk kedua sumber tanpa percabangan lagi di situ.
//
// BELUM PERNAH DITES ke video YouTube nyata (2026-08-08) - SAMA seperti publishToYoutube
// di atas ("BELUM pernah dites ke akun nyata"), krn belum ada channel YouTube yang
// benar-benar connect ke sistem ini sampai catatan ini ditulis. Endpoint & field yang
// dipakai (`part=statistics`, `viewCount`/`likeCount`/`commentCount`) adalah kontrak
// publik YouTube Data API v3 yang stabil & terdokumentasi resmi, TAPI tetap WAJIB
// diverifikasi ke akun nyata begitu channel pertama connect - jangan asumsikan ini
// otomatis benar hanya krn cocok dokumentasi.
export async function getYoutubeVideoMetrics(videoId: string, accessToken: string): Promise<YoutubeVideoMetric[] | null> {
  const url = `${YOUTUBE_VIDEOS_LIST_URL}?part=statistics&id=${encodeURIComponent(videoId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;

  const data = await res.json();
  const stats = data.items?.[0]?.statistics;
  if (!stats) return null;

  const views = parseInt(stats.viewCount, 10) || 0;
  const likes = parseInt(stats.likeCount, 10) || 0;
  const comments = parseInt(stats.commentCount, 10) || 0;
  const engagementRate = views > 0 ? ((likes + comments) / views) * 100 : 0;

  return [
    { name: "views", value: views, unit: "count", type: "views" },
    { name: "engagementRate", value: engagementRate, unit: "percent", type: "engagementRate" },
  ];
}

import type { Publisher, PublishInput, PublishResult } from "./types";
import { resizeImageForTiktok } from "@/lib/render/cloudinary";
import { checkAndHandleDuplicate } from "./bufferAuth";

// Publish generik lewat Buffer - awalnya cuma dipakai utk TikTok (API TikTok langsung
// perlu audit resmi, lihat PRD diskusi), tapi Agus juga mau pakai Buffer utk Instagram
// selagi uji coba (dapat kuota gratis 10 post) sblm alur OAuth Meta langsung beres -
// jadi fungsi ini digeneralisasi utk platform APA SAJA yg tersambung via Buffer, bukan
// TikTok doang. Dispatcher (index.ts) yg nentuin kapan pakai ini vs native API.
//
// PENTING: Buffer REST API (v1, api.bufferapp.com) SUDAH PENSIUN per 2026-07-30 (sunset
// resmi 1 Feb 2027, token jenis ini eksplisit ditolak API-nya - "Public API tokens are
// not accepted for REST API access"). Diganti total ke GraphQL API resmi
// (https://api.buffer.com) - mutation createPost, bentuk field diverifikasi lewat
// INTROSPEKSI GraphQL ke API asli (bukan tebak dari dokumentasi publik yg ternyata
// beda), termasuk tes nyata mode saveToDraft:true (hasil status "draft", TIDAK
// terpublish ke akun asli) lalu dihapus lagi via deletePost.
const BUFFER_API_URL = "https://api.buffer.com";

const CREATE_POST_MUTATION = `
  mutation($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status } }
      ... on InvalidInputError { message }
      ... on UnauthorizedError { message }
      ... on UnexpectedError { message }
      ... on RestProxyError { message }
      ... on LimitReachedError { message }
      ... on NotFoundError { message }
    }
  }
`;

export const publishViaBuffer: Publisher = async (input: PublishInput): Promise<PublishResult> => {
  const { videoUrl, imageUrls, caption, bufferChannelId, platform, brandName } = input;
  // Token PER-AKUN (2026-08-06, permintaan Agus - brand "laundry in bali" punya akun
  // Buffer sendiri, terpisah dari akun Buffer Pelangi) - accessToken di sini datang dari
  // socialAccounts.accessToken (diisi saat channel disambungkan, lihat social-accounts/
  // route.ts), fallback ke env var global kalau akun ini belum punya token sendiri
  // (akun lama/Pelangi, tidak perlu migrasi data).
  const bufferToken = input.accessToken || process.env.BUFFER_ACCESS_TOKEN;

  if (!bufferToken) {
    return { success: false, error: "Token Buffer belum diisi (baik per-akun maupun BUFFER_ACCESS_TOKEN di .env)" };
  }
  if (!bufferChannelId) {
    return { success: false, error: "Akun ini belum ada bufferChannelId" };
  }

  try {
    // TikTok punya batas keras 2.073.600 piksel utk foto (ditemukan lewat error nyata,
    // lihat cloudinary.ts) - resize dulu kalau tujuannya TikTok & isinya foto.
    const effectiveImageUrls =
      platform === "tiktok" && imageUrls && imageUrls.length > 0
        ? await Promise.all(imageUrls.map((url) => resizeImageForTiktok(url)))
        : imageUrls;

    const assets = videoUrl
      ? [{ video: { url: videoUrl } }]
      : effectiveImageUrls && effectiveImageUrls.length > 0
        ? effectiveImageUrls.map((url) => ({ image: { url } }))
        : null;

    if (!assets) {
      return { success: false, error: "Tidak ada video/gambar utk dipublikasikan" };
    }

    // Instagram WAJIB field metadata.instagram.type (post/reel/story) - ditemukan lewat
    // error nyata "Instagram posts require a type", bukan dugaan dari dokumentasi.
    // Foto -> "post" (feed biasa), video -> "reel".
    const metadata =
      platform === "instagram"
        ? { instagram: { type: videoUrl ? "reel" : "post", shouldShareToFeed: true } }
        : undefined;

    const res = await fetch(BUFFER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bufferToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: CREATE_POST_MUTATION,
        variables: {
          input: {
            channelId: bufferChannelId,
            text: caption,
            assets,
            metadata,
            mode: "shareNow",
            schedulingType: "automatic",
            needsApproval: false,
            saveToDraft: false,
          },
        },
      }),
    });
    const data = await res.json();
    if (!res.ok || data.errors) throw new Error(JSON.stringify(data.errors || data));

    const result = data.data.createPost;
    if (result.__typename !== "PostActionSuccess") {
      throw new Error(result.message || result.__typename);
    }

    // Cek duplikat di BELAKANG LAYAR (tidak di-await, poll ~3.5 menit) - lihat
    // bufferAuth.ts: Buffer kadang memproses satu request createPost jadi 2 post nyata
    // (bug di sisi mereka, bukan kode kita). Tidak di-await supaya publishProject()
    // tidak nunggu bermenit-menit per akun - proses Node tetap hidup (systemd, bukan
    // serverless) jadi background task ini tetap selesai setelah response balik.
    checkAndHandleDuplicate({
      channelId: bufferChannelId,
      keepPostId: result.post.id,
      text: caption,
      brandName: brandName || "Brand",
      platformLabel: platform || "Buffer",
      token: bufferToken,
    }).catch((err) => {
      console.error("[buffer] Gagal cek duplikat:", err);
    });

    return { success: true, platformPostId: result.post.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

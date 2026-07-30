import type { Publisher, PublishInput, PublishResult } from "./types";

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
  const { videoUrl, imageUrls, caption, bufferChannelId } = input;
  const bufferToken = process.env.BUFFER_ACCESS_TOKEN;

  if (!bufferToken) {
    return { success: false, error: "BUFFER_ACCESS_TOKEN belum diisi di .env" };
  }
  if (!bufferChannelId) {
    return { success: false, error: "Akun ini belum ada bufferChannelId" };
  }

  // Video (Reels/TikTok) diutamakan kalau ada, kalau tidak pakai gambar (carousel/feed).
  const assets = videoUrl
    ? [{ video: { url: videoUrl } }]
    : imageUrls && imageUrls.length > 0
      ? imageUrls.map((url) => ({ image: { url } }))
      : null;

  if (!assets) {
    return { success: false, error: "Tidak ada video/gambar utk dipublikasikan" };
  }

  try {
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

    return { success: true, platformPostId: result.post.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

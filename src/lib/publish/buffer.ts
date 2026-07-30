import type { Publisher, PublishInput, PublishResult } from "./types";

// TikTok via Buffer (BUKAN TikTok Content Posting API langsung) - lihat PRD diskusi:
// TikTok API tanpa audit cuma bisa post SELF_ONLY (privat), percuma utk marketing.
// Buffer sudah jadi partner ter-audit, jadi kita publish lewat API Buffer.
//
// PENTING: Buffer REST API (v1, api.bufferapp.com) SUDAH PENSIUN per 2026-07-30 (sunset
// resmi 1 Feb 2027, token jenis ini eksplisit ditolak API-nya - "Public API tokens are
// not accepted for REST API access"). Diganti total ke GraphQL API resmi
// (https://api.buffer.com) - mutation createPost, bentuk field diverifikasi lewat
// INTROSPEKSI GraphQL ke API asli (bukan tebak dari dokumentasi publik yg ternyata
// beda), termasuk tes nyata mode saveToDraft:true (hasil status "draft", TIDAK
// terpublish ke TikTok) lalu dihapus lagi via deletePost.
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

export const publishToTiktokViaBuffer: Publisher = async (input: PublishInput): Promise<PublishResult> => {
  const { videoUrl, caption, bufferChannelId } = input;
  const bufferToken = process.env.BUFFER_ACCESS_TOKEN;

  if (!bufferToken) {
    return { success: false, error: "BUFFER_ACCESS_TOKEN belum diisi di .env" };
  }
  if (!bufferChannelId) {
    return { success: false, error: "Akun TikTok ini belum ada bufferChannelId" };
  }
  if (!videoUrl) {
    return { success: false, error: "TikTok butuh video, tidak ada videoUrl" };
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
            assets: [{ video: { url: videoUrl } }],
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

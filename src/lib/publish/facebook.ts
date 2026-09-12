import type { Publisher, PublishInput, PublishResult } from "./types";

// Facebook Page publish via Graph API - sama seperti instagram.ts, mode developer/
// tester akun sendiri (lihat PRD diskusi), BELUM pernah dites ke akun nyata. Cek versi
// API terbaru sebelum pemakaian pertama.
const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export const publishToFacebook: Publisher = async (input: PublishInput): Promise<PublishResult> => {
  const { videoUrl, imageUrls, caption, accessToken, platformAccountId: pageId } = input;
  if (!accessToken || !pageId) {
    return { success: false, error: "Access token / Page ID belum dikonfigurasi" };
  }

  try {
    if (videoUrl) {
      const res = await fetch(`${GRAPH_BASE}/${pageId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_url: videoUrl,
          description: caption,
          access_token: accessToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return { success: true, platformPostId: data.id };
    }

    if (imageUrls && imageUrls.length > 0) {
      const res = await fetch(`${GRAPH_BASE}/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: imageUrls[0],
          caption,
          access_token: accessToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return { success: true, platformPostId: data.id };
    }

    // Post teks-saja (2026-09-12, Caption Only) - tanpa video/gambar -> feed text post.
    // Hanya jalur ini yg baru; video/photo di atas tidak berubah.
    const res = await fetch(`${GRAPH_BASE}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: caption, access_token: accessToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return { success: true, platformPostId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

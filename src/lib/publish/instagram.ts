import type { Publisher, PublishInput, PublishResult } from "./types";

// Instagram Content Publishing via Meta Graph API - lihat PRD diskusi: akun brand
// ditambahkan sbg developer/tester di App milik Agus sendiri, jadi TIDAK perlu App
// Review formal (lihat memory project_kontenpilot_ai.md utk detail kenapa).
//
// CATATAN: implementasi ini mengikuti alur resmi Graph API (create container -> poll
// status -> publish) per dokumentasi publik, TAPI belum pernah dites ke akun nyata krn
// Fase 0 (app Meta + akun tester) belum disiapkan Agus. Cek ulang versi Graph API
// terbaru (mis. v21.0 dst) di developers.facebook.com sebelum pemakaian pertama kali -
// Meta cukup sering ubah versi/field wajib.
const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

async function pollContainerStatus(containerId: string, accessToken: string): Promise<void> {
  const maxAttempts = 20;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(
      `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    const data = await res.json();
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") {
      throw new Error(`Container gagal diproses Instagram: ${JSON.stringify(data)}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Timeout menunggu Instagram memproses container video");
}

export const publishToInstagram: Publisher = async (input: PublishInput): Promise<PublishResult> => {
  const { videoUrl, imageUrls, caption, accessToken, platformAccountId: igUserId } = input;
  if (!accessToken || !igUserId) {
    return { success: false, error: "Access token / IG User ID belum dikonfigurasi" };
  }

  try {
    const caption_full = caption;
    let containerId: string;

    if (videoUrl) {
      const createRes = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "REELS",
          video_url: videoUrl,
          caption: caption_full,
          access_token: accessToken,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(JSON.stringify(createData));
      containerId = createData.id;
      await pollContainerStatus(containerId, accessToken);
    } else if (imageUrls && imageUrls.length > 0) {
      const createRes = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrls[0],
          caption: caption_full,
          access_token: accessToken,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(JSON.stringify(createData));
      containerId = createData.id;
    } else {
      return { success: false, error: "Tidak ada video/gambar utk dipublikasikan" };
    }

    const publishRes = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok) throw new Error(JSON.stringify(publishData));

    return { success: true, platformPostId: publishData.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

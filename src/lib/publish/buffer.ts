import type { Publisher, PublishInput, PublishResult } from "./types";

// TikTok via Buffer (BUKAN TikTok Content Posting API langsung) - lihat PRD diskusi:
// TikTok API tanpa audit cuma bisa post SELF_ONLY (privat), percuma utk marketing.
// Buffer sudah jadi partner ter-audit, jadi kita publish lewat API Buffer, per akun
// TikTok = 1 channel Buffer berbayar (~$5-10/bulan/akun).
//
// CATATAN: Buffer API developer masih BETA per riset 2026-07-30 - bentuk endpoint di
// bawah ini mengikuti konvensi REST yang didokumentasikan publik saat itu, TAPI belum
// pernah dites ke akun nyata krn akun Buffer Agus belum dibuat. WAJIB cek ulang ke
// https://buffer.com/developers/api sebelum pemakaian pertama - API beta cenderung
// berubah.
const BUFFER_API_BASE = "https://api.bufferapp.com/2";

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
    const res = await fetch(`${BUFFER_API_BASE}/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bufferToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel_id: bufferChannelId,
        text: caption,
        media: { video: { url: videoUrl } },
        now: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));

    return { success: true, platformPostId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

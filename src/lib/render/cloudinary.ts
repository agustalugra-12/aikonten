import { v2 as cloudinary } from "cloudinary";
import { createHash } from "crypto";
import type { ScoredSegment } from "@/lib/ai/clipSelect";

function configureCloudinary() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud_name || !api_key || !api_secret) {
    throw new Error("Kredensial Cloudinary belum lengkap di .env");
  }
  cloudinary.config({ cloud_name, api_key, api_secret });
}

// PENTING (ditemukan via tes langsung ke API asli, bukan cuma baca dokumentasi):
// public_id yang dipakai sbg overlay (video ATAU subtitles) TIDAK BOLEH mengandung "/"
// (folder) - Node SDK gagal meng-escape slash dgn benar utk overlay video, error yg
// muncul cuma "Invalid transformation component - raw" yg sama sekali tidak
// menyebutkan folder/slash. Karena itu public_id di sini SENGAJA rata (flat), pakai "_"
// sbg pemisah, bukan folder path.
function publicIdFor(projectId: string, suffix: string): string {
  return `kontenpilot_${projectId}_${suffix}`;
}

// Bangun transformation array utk splice (sambung) segmen-segmen terpilih dari SATU
// video sumber yg sama jadi satu video utuh berurutan, lalu bakar subtitle di akhir -
// pola ini persis mengikuti contoh resmi Cloudinary (segmen pertama = trim langsung di
// base, segmen berikutnya = overlay video sumber yg sama dgn flags:"splice" lalu
// ditutup fl_layer_apply) - diverifikasi lewat tes nyata (lihat komentar di atas),
// bukan cuma disalin dari dokumentasi.
function buildSpliceTransformation(
  sourcePublicId: string,
  segments: ScoredSegment[],
  srtPublicId: string
): Record<string, unknown>[] {
  if (segments.length === 0) {
    throw new Error("Tidak ada klip terpilih utk dirender - clipSelection kosong");
  }

  const transformation: Record<string, unknown>[] = [];
  const [first, ...rest] = segments;
  transformation.push({ start_offset: first.start, duration: first.end - first.start });

  for (const seg of rest) {
    transformation.push({
      overlay: { resource_type: "video", public_id: sourcePublicId },
      start_offset: seg.start,
      duration: seg.end - seg.start,
      flags: "splice",
    });
    transformation.push({ flags: "layer_apply" });
  }

  // Overlay subtitle di atas hasil splice penuh - gravity default utk tipe "subtitles"
  // sudah "south" (bawah video), sesuai konvensi caption umum, jadi tidak perlu diatur.
  transformation.push({ overlay: { resource_type: "subtitles", public_id: srtPublicId } });
  transformation.push({ flags: "layer_apply" });

  return transformation;
}

export type RenderResult = {
  videoUrl: string;
  durationSeconds: number;
};

// Render video final: tarik footage mentah dari storage kita (R2, lihat storage.ts) ke
// Cloudinary via upload-dari-URL-remote (server kita TIDAK perlu download file besar
// itu sendiri), splice klip-klip terpilih jadi satu video berurutan, bakar subtitle SRT,
// lalu balikkan URL video jadi (mp4) yg siap dipublikasikan.
//
// eager (SINKRON, bukan eager_async+webhook) krn total durasi klip target cuma ~45
// detik - transcode sesingkat itu wajar ditunggu dlm satu request. Kalau nanti target
// durasi dinaikkan jauh & transcode jadi lambat, pertimbangkan eager_async +
// notification_url drpd blocking di sini.
export async function renderFinalVideo(opts: {
  projectId: string;
  rawFootageUrl: string;
  segments: ScoredSegment[];
  srtContent: string;
}): Promise<RenderResult> {
  configureCloudinary();

  const rawPublicId = publicIdFor(opts.projectId, "raw");
  const srtPublicId = publicIdFor(opts.projectId, "subtitles.srt");

  const uploaded = await cloudinary.uploader.upload(opts.rawFootageUrl, {
    resource_type: "video",
    public_id: rawPublicId,
    overwrite: true,
  });

  await cloudinary.uploader.upload(
    `data:text/plain;base64,${Buffer.from(opts.srtContent).toString("base64")}`,
    { resource_type: "raw", public_id: srtPublicId, overwrite: true }
  );

  const transformation = buildSpliceTransformation(uploaded.public_id, opts.segments, srtPublicId);

  const rendered = await cloudinary.uploader.explicit(uploaded.public_id, {
    resource_type: "video",
    type: "upload",
    eager: [{ transformation, format: "mp4" }],
  });

  const eagerResult = rendered.eager?.[0];
  if (!eagerResult?.secure_url) {
    throw new Error("Cloudinary tidak menghasilkan video final (eager transformation kosong)");
  }

  const durationSeconds = Math.round(
    opts.segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
  );

  return { videoUrl: eagerResult.secure_url, durationSeconds };
}

// TikTok punya batas resolusi foto keras: 2.073.600 piksel (setara 1920x1080) -
// ditemukan lewat error NYATA dari Buffer/TikTok saat tes publish foto asli ("Image
// pixel count (12,192,768) exceeds the 2,073,600 maximum for TikTok"), bukan dugaan.
// Foto dari HP modern jauh melebihi ini, jadi WAJIB di-resize dulu sblm dikirim ke
// TikTok - platform lain (Instagram/Facebook) tidak kena batas ini.
export async function resizeImageForTiktok(imageUrl: string): Promise<string> {
  configureCloudinary();

  // Hash URL sbg public_id - idempotent (kalau foto yg sama diresize lagi, pakai aset
  // yg sama, bukan upload duplikat tiap kali).
  const hash = createHash("sha1").update(imageUrl).digest("hex").slice(0, 16);
  const publicId = `kontenpilot_tiktok_resize_${hash}`;

  const uploaded = await cloudinary.uploader.upload(imageUrl, {
    resource_type: "image",
    public_id: publicId,
    overwrite: true,
  });

  return cloudinary.url(uploaded.public_id, {
    resource_type: "image",
    format: "jpg",
    transformation: [{ width: 1920, height: 1080, crop: "limit" }],
  });
}

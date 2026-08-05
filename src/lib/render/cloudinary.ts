import { v2 as cloudinary } from "cloudinary";
import { createHash } from "crypto";
import { generateVoiceover, getAudioDurationSeconds } from "@/lib/ai/dubbing";
import { buildCaptionSrt } from "@/lib/ai/generateContent";

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

// Efek zoom in/out (lihat memory proyek) - ditemukan lewat tes nyata: Cloudinary
// menolak zoompan pada VIDEO yg sudah direkam ("Invalid image file", zoompan cuma utk
// gambar diam), jadi HANYA berlaku utk foto (single-photo post) - ubah foto diam jadi
// video pendek dgn zoom halus. TIDAK dipakai utk carousel multi-foto (lihat
// processProject.ts) krn menyambung banyak klip zoom = kompleksitas splice penuh spt
// video, di luar scope ini.
//
// Dubbing+subtitle (OPSIONAL via captionText, ditambah 2026-07-31 atas permintaan Agus)
// - beda dgn renderFinalVideo: di sini TTS-lah yg MENENTUKAN durasi video (bukan
// sebaliknya), krn sumbernya cuma 1 foto diam, tidak ada durasi "asli" spt klip footage.
// Jadi kalau captionText diisi, fallbackDurationSeconds DIABAIKAN - durasi asli video
// dihitung dari panjang audio TTS yg sungguhan (via ffprobe, lihat dubbing.ts), supaya
// narasi tidak terpotong/terlalu cepat selesai drpd videonya.
//
// Pakai explicit()+eager (SINKRON) sama persis pola renderFinalVideo, BUKAN lagi
// cloudinary.url() lazy spt sebelumnya - supaya overlay subtitle+audio (yg butuh asset
// lain sudah ter-upload) bisa digabung dlm SATU transformation array yg sama terbukti
// jalan (lihat renderFinalVideo), bukan pola baru yg belum pernah dites gabungannya.
export async function applyZoomToImage(opts: {
  projectId: string;
  imageUrl: string;
  fallbackDurationSeconds: number;
  captionText?: string;
}): Promise<{ videoUrl: string; durationSeconds: number }> {
  configureCloudinary();

  const hash = createHash("sha1").update(opts.imageUrl).digest("hex").slice(0, 16);
  const publicId = `kontenpilot_zoom_${hash}`;

  const uploaded = await cloudinary.uploader.upload(opts.imageUrl, {
    resource_type: "image",
    public_id: publicId,
    overwrite: true,
  });

  let durationSeconds = opts.fallbackDurationSeconds;
  let voiceoverPublicId: string | undefined;
  let srtPublicId: string | undefined;

  if (opts.captionText) {
    const voiceoverBuffer = await generateVoiceover(opts.captionText);
    durationSeconds = Math.max(4, Math.round(await getAudioDurationSeconds(voiceoverBuffer)));

    voiceoverPublicId = publicIdFor(opts.projectId, "zoom_voiceover");
    await cloudinary.uploader.upload(`data:audio/mp3;base64,${voiceoverBuffer.toString("base64")}`, {
      resource_type: "video",
      public_id: voiceoverPublicId,
      overwrite: true,
    });

    const srt = buildCaptionSrt(opts.captionText, durationSeconds);
    srtPublicId = publicIdFor(opts.projectId, "zoom_subtitles.srt");
    await cloudinary.uploader.upload(
      `data:text/plain;base64,${Buffer.from(srt).toString("base64")}`,
      { resource_type: "raw", public_id: srtPublicId, overwrite: true }
    );
  }

  const transformation: Record<string, unknown>[] = [
    // Batasi resolusi dulu (foto HP modern bisa jauh lebih besar drpd wajar utk
    // video sosmed) - sama alasannya dgn resizeImageForTiktok, cegah video hasil
    // zoom jadi kegedean/lambat diproses.
    { width: 1920, height: 1080, crop: "limit" },
    { effect: `zoompan:du_${durationSeconds};from_(x_0.5;y_0.5;zoom_1.0);to_(x_0.5;y_0.5;zoom_1.25)` },
  ];

  if (srtPublicId) {
    transformation.push({ overlay: { resource_type: "subtitles", public_id: srtPublicId } });
    transformation.push({ flags: "layer_apply" });
  }
  if (voiceoverPublicId) {
    transformation.push({ overlay: { resource_type: "video", public_id: voiceoverPublicId }, flags: "layer_apply" });
  }

  const rendered = await cloudinary.uploader.explicit(publicId, {
    resource_type: "image",
    type: "upload",
    eager: [{ transformation, format: "mp4" }],
  });

  const eagerResult = rendered.eager?.[0];
  if (!eagerResult?.secure_url) {
    throw new Error("Cloudinary tidak menghasilkan video zoom (eager transformation kosong)");
  }

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

// GPT Image (edit endpoint) mewajibkan gambar & mask berformat SAMA, ukuran SAMA,
// kedua sisi kelipatan 16px, rasio panjang:pendek maks 3:1 - foto asli dari HP/frame
// video jarang otomatis memenuhi ini. Crop ke ukuran PASTI via Cloudinary (smart-crop
// `gravity: auto` spy tidak asal potong bagian penting foto) + convert PNG. Dipakai utk
// overlay promo (1024x1024 persegi, lihat prepareSquarePng) MAUPUN thumbnail YouTube
// (1280x720, 16:9 - lihat thumbnail.ts) - beda rasio, mekanisme sama.
export async function prepareFixedSizePng(imageUrl: string, width: number, height: number): Promise<Buffer> {
  configureCloudinary();

  const hash = createHash("sha1").update(`${imageUrl}_${width}x${height}`).digest("hex").slice(0, 16);
  const publicId = `kontenpilot_fixedsize_${hash}`;

  const uploaded = await cloudinary.uploader.upload(imageUrl, {
    resource_type: "image",
    public_id: publicId,
    overwrite: true,
  });

  const url = cloudinary.url(uploaded.public_id, {
    resource_type: "image",
    format: "png",
    transformation: [{ width, height, crop: "fill", gravity: "auto" }],
  });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal ambil foto yg sudah di-crop ${width}x${height}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function prepareSquarePng(imageUrl: string, size: number): Promise<Buffer> {
  return prepareFixedSizePng(imageUrl, size, size);
}

// Ambil 1 frame dari video mentah sbg dasar thumbnail YouTube (lihat thumbnail.ts) -
// pola lazy-URL yg sama dgn resizeImageForTiktok, bukan mekanisme baru. `atSeconds`
// dijaga TIDAK melebihi durasi video pendek (footage bisa cuma beberapa detik).
export async function extractVideoFrame(videoUrl: string, atSeconds: number): Promise<string> {
  configureCloudinary();

  const hash = createHash("sha1").update(videoUrl).digest("hex").slice(0, 16);
  const publicId = `kontenpilot_frame_${hash}`;

  const uploaded = await cloudinary.uploader.upload(videoUrl, {
    resource_type: "video",
    public_id: publicId,
    overwrite: true,
  });

  const safeOffset = Math.min(atSeconds, Math.max(0, (uploaded.duration || atSeconds) - 0.5));

  return cloudinary.url(uploaded.public_id, {
    resource_type: "video",
    format: "jpg",
    transformation: [{ start_offset: safeOffset }],
  });
}

import { v2 as cloudinary } from "cloudinary";
import { createHash } from "crypto";
import type { ScoredSegment } from "@/lib/ai/clipSelect";
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

type SpliceSegment = { sourcePublicId: string; start: number; end: number };

// Bangun transformation array utk splice (sambung) beberapa segmen jadi satu video
// utuh berurutan, lalu bakar subtitle di akhir - pola ini persis mengikuti contoh resmi
// Cloudinary (segmen PERTAMA = trim langsung di base, segmen berikutnya = overlay video
// dgn flags:"splice" lalu ditutup fl_layer_apply) - diverifikasi lewat tes nyata (lihat
// komentar di publicIdFor), bukan cuma disalin dari dokumentasi.
//
// Segmen PERTAMA WAJIB dari source yg SAMA dgn `explicit()` dipanggil (base asset Cloudinary
// tidak bisa "pinjam" dari asset lain) - makanya di renderFinalVideo, klip pertama SELALU
// dari footage asli Agus, B-roll Pexels (source BEDA) cuma bisa masuk sbg overlay
// tambahan (rest), tidak bisa jadi klip pertama. Ini kenapa B-roll "pendamping" (lihat
// PRD diskusi) ditempel di AKHIR urutan, bukan di depan.
//
// PENTING (ditemukan via tes nyata): Cloudinary MENOLAK splice kalau dimensi antar klip
// beda ("Concatenated videos sizes don't match") - footage asli Agus & video Pexels
// hampir pasti beda resolusi/orientasi. Setiap segmen overlay WAJIB di-resize dulu ke
// dimensi base (targetWidth/targetHeight) SEBELUM fl_layer_apply, persis pola resmi
// Cloudinary utk concat lintas-sumber (resize step di antara overlay & layer_apply).
function buildSpliceTransformation(
  segments: SpliceSegment[],
  srtPublicId: string,
  targetWidth: number,
  targetHeight: number
): Record<string, unknown>[] {
  if (segments.length === 0) {
    throw new Error("Tidak ada klip terpilih utk dirender - clipSelection kosong");
  }

  const transformation: Record<string, unknown>[] = [];
  const [first, ...rest] = segments;
  transformation.push({ start_offset: first.start, duration: first.end - first.start });

  for (const seg of rest) {
    transformation.push({
      overlay: { resource_type: "video", public_id: seg.sourcePublicId },
      start_offset: seg.start,
      duration: seg.end - seg.start,
      flags: "splice",
    });
    transformation.push({ width: targetWidth, height: targetHeight, crop: "fill" });
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
  // Footage asli - BISA dari >1 file sekaligus (2026-08-05, permintaan Agus - "video
  // didominasi footage Pelangi", 1 file asli sering terlalu pendek/kepanjangan sendirian
  // utk isi 70% dari target 30-60 detik, lihat clipSelect.ts REAL_FOOTAGE_BUDGET_SECONDS).
  // Tiap segmen bawa sourceUrl sendiri - source UNIK diupload SEKALI (dicache per URL),
  // bukan 1 file asumsi tunggal spt sebelumnya.
  segments: (ScoredSegment & { sourceUrl: string })[];
  srtContent: string;
  // B-roll Pexels OPSIONAL - "pendamping" (lihat PRD diskusi), ditempel di AKHIR
  // urutan, bukan menggantikan footage asli Agus. Array (2026-08-05, permintaan Agus -
  // kombinasi footage asli + Pexels PER LANDMARK wisata yg disebut skrip, lihat
  // destinationBroll.ts) - dulu cuma 1 klip pendamping generik, sekarang bisa >1 klip
  // beda sumber, tiap klip diupload & disambung sbg overlay+splice terpisah
  // (buildSpliceTransformation SUDAH mendukung banyak source_public_id berbeda di
  // segmen "rest", jadi ini generalisasi murni, bukan mekanisme baru).
  brollClips?: Array<{ videoUrl: string; durationSeconds: number }>;
  // AI Dubbing OPSIONAL (lihat memory proyek - Agus konfirmasi GANTI TOTAL suara asli,
  // bukan campur) - teks narasi (biasanya caption yg sudah di-generate), di-generate
  // jadi audio (dubbing.ts) & MENGGANTIKAN audio asli video, bukan ditambahkan.
  voiceoverText?: string;
}): Promise<RenderResult> {
  configureCloudinary();

  if (opts.segments.length === 0) {
    throw new Error("Tidak ada klip footage asli terpilih utk dirender");
  }

  const srtPublicId = publicIdFor(opts.projectId, "subtitles.srt");

  // Upload tiap file sumber UNIK sekali saja (dicache per URL) - beberapa segmen bisa
  // datang dari file yg SAMA (mis. 3 klip dari 1 video panjang), jangan upload berulang.
  const uploadedBySource = new Map<string, { public_id: string; width: number; height: number }>();
  let nextSrcIdx = 0;
  async function ensureUploaded(url: string) {
    const cached = uploadedBySource.get(url);
    if (cached) return cached;
    const uploaded = await cloudinary.uploader.upload(url, {
      resource_type: "video",
      public_id: publicIdFor(opts.projectId, `src_${nextSrcIdx++}`),
      overwrite: true,
    });
    const info = { public_id: uploaded.public_id, width: uploaded.width, height: uploaded.height };
    uploadedBySource.set(url, info);
    return info;
  }

  await cloudinary.uploader.upload(
    `data:text/plain;base64,${Buffer.from(opts.srtContent).toString("base64")}`,
    { resource_type: "raw", public_id: srtPublicId, overwrite: true }
  );

  const spliceSegments: SpliceSegment[] = [];
  for (const seg of opts.segments) {
    const info = await ensureUploaded(seg.sourceUrl);
    spliceSegments.push({ sourcePublicId: info.public_id, start: seg.start, end: seg.end });
  }
  // Dimensi BASE (utk resize klip lain saat splice, lihat buildSpliceTransformation)
  // WAJIB dari source segmen PERTAMA - itu jg yg dipakai sbg base explicit() di bawah.
  const baseInfo = uploadedBySource.get(opts.segments[0].sourceUrl)!;

  let brollDuration = 0;
  for (const [i, clip] of (opts.brollClips || []).entries()) {
    const brollUploaded = await cloudinary.uploader.upload(clip.videoUrl, {
      resource_type: "video",
      public_id: publicIdFor(opts.projectId, `broll_${i}`),
      overwrite: true,
    });
    brollDuration += clip.durationSeconds;
    spliceSegments.push({ sourcePublicId: brollUploaded.public_id, start: 0, end: clip.durationSeconds });
  }

  const transformation = buildSpliceTransformation(
    spliceSegments,
    srtPublicId,
    baseInfo.width,
    baseInfo.height
  );

  // AI Dubbing - ac_none MEMATIKAN SELURUH audio hasil splice (bukan cuma footage
  // asli - audio B-roll ikut kebawa saat splice, jadi harus dimatikan total dulu),
  // baru overlay audio TTS di atasnya. Diverifikasi lewat tes nyata (lihat memory
  // proyek): hasil akhir audio-nya PERSIS properti file TTS (24kHz mono), bukan
  // campuran - jadi ini benar2 GANTI, bukan mixing, sesuai konfirmasi Agus.
  if (opts.voiceoverText) {
    const voiceoverBuffer = await generateVoiceover(opts.voiceoverText);
    const audioPublicId = publicIdFor(opts.projectId, "voiceover");
    await cloudinary.uploader.upload(`data:audio/mp3;base64,${voiceoverBuffer.toString("base64")}`, {
      resource_type: "video",
      public_id: audioPublicId,
      overwrite: true,
    });
    transformation.push({ audio_codec: "none" });
    transformation.push({ overlay: { resource_type: "video", public_id: audioPublicId }, flags: "layer_apply" });
  }

  const rendered = await cloudinary.uploader.explicit(baseInfo.public_id, {
    resource_type: "video",
    type: "upload",
    eager: [{ transformation, format: "mp4" }],
  });

  const eagerResult = rendered.eager?.[0];
  if (!eagerResult?.secure_url) {
    throw new Error("Cloudinary tidak menghasilkan video final (eager transformation kosong)");
  }

  const durationSeconds = Math.round(
    opts.segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0) + brollDuration
  );

  return { videoUrl: eagerResult.secure_url, durationSeconds };
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

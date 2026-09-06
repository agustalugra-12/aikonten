import { generateImageWithGemini } from "./geminiImage";
import sharp from "sharp";
import { extractVideoFrame } from "@/lib/render/cloudinary";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";

const FINAL_WIDTH = 1280;
const FINAL_HEIGHT = 720;

// Ambil 1 frame dari footage asli (bukan generate gambar dari nol - konsisten dgn
// filosofi app ini: berbasis footage asli, lihat memory proyek), lalu Gemini API
// (gemini-3.1-flash-image, migrasi dari fal.ai 2026-09-06 - lihat geminiImage.ts)
// nempelkan teks hook thumbnail yg BOLD & gampang kebaca di bagian bawah foto.
//
// Model ini TIDAK PUNYA fitur mask biner sama sekali (dicek langsung ke skema resmi
// endpoint-nya, tidak ada field mask) - jaminan "sisa foto tidak berubah" PENUH
// bergantung pada instruksi prompt yang tegas, bukan dikunci teknis.
export async function generateThumbnail(opts: {
  brandId: string;
  projectId: string;
  rawFootageUrl: string;
  thumbnailText: string;
}): Promise<string> {
  const frameUrl = await extractVideoFrame(opts.rawFootageUrl, 1);

  const { buffer: raw } = await generateImageWithGemini({
    prompt:
      `Add bold, large, high-contrast YouTube-thumbnail-style text reading exactly ` +
      `"${opts.thumbnailText}" near the bottom of the photo - thick readable font, strong ` +
      "outline or drop shadow so it pops against the background. Do not add, remove, or " +
      "change anything else in the photo - the rest of the image must stay exactly the same " +
      "as the original, only the text is new. Do NOT draw any logo, brand badge, verified/" +
      "certified seal, or watermark anywhere - the real brand logo (if any) is composited " +
      "separately after this step, outside your control.",
    imageUrls: [frameUrl],
    aspectRatio: "16:9",
    usageLabel: "gemini-3.1-flash-image-thumbnail",
  });

  // Crop akhir ke ukuran PASTI YouTube (1280x720) - position "bottom" spy teks di
  // bagian bawah TIDAK ikut kepotong (kelebihan tinggi dibuang dari ATAS, bukan bawah).
  const cropped = await sharp(raw)
    .resize(FINAL_WIDTH, FINAL_HEIGHT, { fit: "cover", position: "bottom" })
    .png()
    .toBuffer();

  const key = buildAssetKey(opts.brandId, opts.projectId, "thumbnail.png");
  return uploadBuffer(key, cropped, "image/png");
}

import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { prepareFixedSizePng, extractVideoFrame } from "@/lib/render/cloudinary";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

// gpt-image-1 CUMA terima size preset tertentu (ditemukan via tes nyata ke API asli:
// "Invalid size '1280x720'. Supported sizes are 1024x1024, 1024x1536, 1536x1024, and
// auto.") - TIDAK bisa langsung minta 1280x720 (rasio asli thumbnail YouTube). Jadi
// generate di preset landscape terdekat (1536x1024), baru crop lokal (sharp, position
// "bottom" spy area teks di bawah TIDAK ikut kepotong) ke ukuran asli YouTube.
const GENERATE_WIDTH = 1536;
const GENERATE_HEIGHT = 1024;
const FINAL_WIDTH = 1280;
const FINAL_HEIGHT = 720;

// Mask: transparan (BISA diedit) di PITA BAWAH selebar penuh (bukan pojok kecil spt
// promoOverlay.ts - teks thumbnail harus kebaca sekilas), opaque (dilindungi) di
// sisanya. Ada margin bawah (TIDAK sampai piksel paling bawah) spy teksnya tidak ikut
// terpotong saat crop akhir ke 1280x720 dgn position:"bottom".
async function buildThumbnailMask(width: number, height: number): Promise<Buffer> {
  const bandTop = Math.round(height * 0.62);
  const bandHeight = Math.round(height * 0.28);

  const transparentBand = await sharp({
    create: { width, height: bandHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();

  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } },
  })
    .composite([{ input: transparentBand, left: 0, top: bandTop }])
    .png()
    .toBuffer();
}

// Ambil 1 frame dari footage asli (bukan generate gambar dari nol - konsisten dgn
// filosofi app ini: berbasis footage asli, lihat memory proyek), lalu GPT Image
// nempelkan teks hook thumbnail yg BOLD & gampang kebaca di pita bawah SAJA (mask-
// constrained, sama prinsipnya dgn promoOverlay.ts) - sisa foto TIDAK berubah.
export async function generateThumbnail(opts: {
  brandId: string;
  projectId: string;
  rawFootageUrl: string;
  thumbnailText: string;
}): Promise<string> {
  const client = getClient();

  const frameUrl = await extractVideoFrame(opts.rawFootageUrl, 1);
  const baseImage = await prepareFixedSizePng(frameUrl, GENERATE_WIDTH, GENERATE_HEIGHT);
  const mask = await buildThumbnailMask(GENERATE_WIDTH, GENERATE_HEIGHT);

  const response = await client.images.edit({
    model: "gpt-image-1",
    image: await toFile(baseImage, "frame.png", { type: "image/png" }),
    mask: await toFile(mask, "mask.png", { type: "image/png" }),
    prompt:
      `Add bold, large, high-contrast YouTube-thumbnail-style text reading exactly ` +
      `"${opts.thumbnailText}" inside the highlighted (transparent) band only - thick ` +
      "readable font, strong outline or drop shadow so it pops against the background. " +
      "Do not add, remove, or change anything outside the highlighted area - the rest " +
      "of the photo must stay exactly the same.",
    size: "1536x1024",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("GPT Image tidak mengembalikan hasil thumbnail");

  // Crop ke rasio asli YouTube (16:9) - position "bottom" spy pita teks di bawah TIDAK
  // ikut kepotong (kelebihan tinggi dibuang dari ATAS, bukan bawah).
  const cropped = await sharp(Buffer.from(b64, "base64"))
    .resize(FINAL_WIDTH, FINAL_HEIGHT, { fit: "cover", position: "bottom" })
    .png()
    .toBuffer();

  const key = buildAssetKey(opts.brandId, opts.projectId, "thumbnail.png");
  return uploadBuffer(key, cropped, "image/png");
}

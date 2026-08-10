import { fal } from "@fal-ai/client";
import { subscribeFalWithRetry } from "./falRetry";
import sharp from "sharp";
import { extractVideoFrame } from "@/lib/render/cloudinary";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import { logNonTokenUsage } from "./openaiClient";

function ensureFalConfigured(): void {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_KEY belum diisi di .env");
  fal.config({ credentials: apiKey });
}

// Pencatatan biaya (2026-08-10) - $0.08/gambar @ 1K, lihat catatan lengkap di
// posterDesign.ts (harga sama, model+resolusi sama).
const NANO_BANANA_PRICE_PER_IMAGE_1K = 0.08;

const FINAL_WIDTH = 1280;
const FINAL_HEIGHT = 720;

// Ambil 1 frame dari footage asli (bukan generate gambar dari nol - konsisten dgn
// filosofi app ini: berbasis footage asli, lihat memory proyek), lalu Nano Banana 2
// (fal.ai) nempelkan teks hook thumbnail yg BOLD & gampang kebaca di bagian bawah foto.
//
// Pindah dari gpt-image-1 ke Nano Banana 2 (2026-08-05, sama alasan dgn posterDesign.ts
// - permintaan Agus, satu model konsisten utk semua generator gambar) - TRADE-OFF YANG
// SENGAJA DITERIMA Agus: model ini TIDAK PUNYA fitur mask biner sama sekali (dicek
// langsung ke skema resmi endpoint-nya, tidak ada field mask), beda dari gpt-image-1
// yang dipakai sebelumnya di sini (mask keras di pita bawah, area lain TERKUNCI di
// level piksel). Sekarang jaminan "sisa foto tidak berubah" PENUH bergantung pada
// instruksi prompt yang tegas, bukan dikunci teknis lagi - kalau ke depan hasil sering
// mengubah bagian foto di luar teks, itu pertanda perlu balik ke provider yg punya
// mask (mis. fal-ai/qwen-image-edit/inpaint, sudah dicek support mask_url asli), bukan
// sekadar menulis ulang prompt berkali-kali.
export async function generateThumbnail(opts: {
  brandId: string;
  projectId: string;
  rawFootageUrl: string;
  thumbnailText: string;
}): Promise<string> {
  ensureFalConfigured();

  const frameUrl = await extractVideoFrame(opts.rawFootageUrl, 1);

  const result = await subscribeFalWithRetry("fal-ai/nano-banana-2/edit", {
    prompt:
      `Add bold, large, high-contrast YouTube-thumbnail-style text reading exactly ` +
      `"${opts.thumbnailText}" near the bottom of the photo - thick readable font, strong ` +
      "outline or drop shadow so it pops against the background. Do not add, remove, or " +
      "change anything else in the photo - the rest of the image must stay exactly the same " +
      "as the original, only the text is new. Do NOT draw any logo, brand badge, verified/" +
      "certified seal, or watermark anywhere - the real brand logo (if any) is composited " +
      "separately after this step, outside your control.",
    image_urls: [frameUrl],
    aspect_ratio: "16:9",
    resolution: "1K",
  });

  const imageUrl = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url;
  if (!imageUrl) throw new Error("Nano Banana 2 (fal.ai) tidak mengembalikan hasil thumbnail");
  await logNonTokenUsage("nano-banana-2-thumbnail", NANO_BANANA_PRICE_PER_IMAGE_1K);

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Gagal ambil hasil thumbnail dari fal.ai: ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());

  // Crop akhir ke ukuran PASTI YouTube (1280x720) - position "bottom" spy teks di
  // bagian bawah TIDAK ikut kepotong (kelebihan tinggi dibuang dari ATAS, bukan bawah).
  const cropped = await sharp(raw)
    .resize(FINAL_WIDTH, FINAL_HEIGHT, { fit: "cover", position: "bottom" })
    .png()
    .toBuffer();

  const key = buildAssetKey(opts.brandId, opts.projectId, "thumbnail.png");
  return uploadBuffer(key, cropped, "image/png");
}

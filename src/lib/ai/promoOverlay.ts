import { fal } from "@fal-ai/client";
import { subscribeFalWithRetry } from "./falRetry";
import sharp from "sharp";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";

function ensureFalConfigured(): void {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_KEY belum diisi di .env");
  fal.config({ credentials: apiKey });
}

const EDIT_SIZE = 1024;

// Tempel badge harga/promo ke foto ASLI via Nano Banana 2 (fal.ai), BUKAN generate
// ulang foto dari nol.
//
// Pindah dari gpt-image-1 ke Nano Banana 2 (2026-08-05, sama alasan dgn posterDesign.ts
// & thumbnail.ts - permintaan Agus, satu model konsisten utk semua generator gambar) -
// TRADE-OFF YANG SENGAJA DITERIMA Agus: SEBELUM ini foto tetap sama persis di luar area
// badge krn DIJAMIN mask keras (pixel-level, tidak bisa dilanggar model) - permintaan
// eksplisit Agus dulu: "tidak merubah/edit foto berlebihan". Nano Banana 2 TIDAK PUNYA
// fitur mask sama sekali (dicek langsung ke skema resmi endpoint-nya) - jaminan itu
// sekarang PENUH bergantung pada instruksi prompt yang tegas di bawah, bukan dikunci
// teknis lagi. Kalau ke depan hasil sering mengedit foto berlebihan di luar area badge,
// itu pertanda perlu balik ke provider yg punya mask asli (mis.
// fal-ai/qwen-image-edit/inpaint, sudah dicek support mask_url), bukan sekadar menulis
// ulang prompt berkali-kali.
export async function applyPromoOverlay(opts: {
  brandId: string;
  projectId: string;
  imageUrl: string;
  promoText: string;
}): Promise<string> {
  ensureFalConfigured();

  const result = await subscribeFalWithRetry("fal-ai/nano-banana-2/edit", {
    prompt:
      `Add a bold, eye-catching promotional price badge/sticker showing exactly "${opts.promoText}" ` +
      "in the bottom-right corner of the photo ONLY, styled like a real hospitality/travel marketing " +
      "discount sticker (solid accent color background, bold readable text, subtle shadow) - the " +
      "badge should take up roughly the bottom-right 40% width x 28% height corner of the image, " +
      "not the whole photo. Do not add, remove, or change ANYTHING else in the photo outside that " +
      "badge corner - the rest of the image must stay exactly the same as the original.",
    image_urls: [opts.imageUrl],
    aspect_ratio: "1:1",
    resolution: "1K",
  });

  const imageUrl = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url;
  if (!imageUrl) throw new Error("Nano Banana 2 (fal.ai) tidak mengembalikan hasil overlay promo");

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Gagal ambil hasil overlay promo dari fal.ai: ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());

  // Crop akhir ke ukuran persegi PASTI - jaga konsisten dgn konsumen lain (grid IG,
  // dst) yg berharap 1:1 persis, bukan cuma "kurang lebih" dari aspect_ratio model.
  const cropped = await sharp(raw).resize(EDIT_SIZE, EDIT_SIZE, { fit: "cover" }).png().toBuffer();

  const key = buildAssetKey(opts.brandId, opts.projectId, "promo-overlay.png");
  return uploadBuffer(key, cropped, "image/png");
}

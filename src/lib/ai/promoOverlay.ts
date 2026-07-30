import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { prepareSquarePng } from "@/lib/render/cloudinary";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

// 1024 - persegi (rasio 1:1, jauh di bawah batas 3:1) & kelipatan 16px, selalu valid
// utk constraint gpt-image-1 (lihat prepareSquarePng di cloudinary.ts).
const EDIT_SIZE = 1024;

// Mask: transparan (BISA diedit GPT) cuma di kotak kanan-bawah tempat badge promo
// ditempel, opaque (DILINDUNGI, tidak boleh disentuh) di seluruh sisanya. Ini yg
// memaksa GPT Image cuma nambah badge di area itu & TIDAK mengedit sisi lain foto -
// sesuai permintaan eksplisit Agus: "tidak merubah/edit foto berlebihan".
async function buildBadgeMask(size: number): Promise<Buffer> {
  const badgeW = Math.round(size * 0.42);
  const badgeH = Math.round(size * 0.28);
  const margin = Math.round(size * 0.04);
  const left = size - badgeW - margin;
  const top = size - badgeH - margin;

  const transparentCutout = await sharp({
    create: { width: badgeW, height: badgeH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } },
  })
    .composite([{ input: transparentCutout, left, top }])
    .png()
    .toBuffer();
}

// Tempel badge harga/promo ke foto ASLI via GPT Image (mode edit + mask), BUKAN
// generate ulang foto dari nol - foto tetap sama persis di luar area badge (dijamin
// oleh mask, bukan cuma diminta lewat prompt). Hasil di-upload ke storage kita sendiri
// (R2), bukan disimpan di Cloudinary/OpenAI, konsisten dgn aset lain di app ini.
export async function applyPromoOverlay(opts: {
  brandId: string;
  projectId: string;
  imageUrl: string;
  promoText: string;
}): Promise<string> {
  const client = getClient();

  const baseImage = await prepareSquarePng(opts.imageUrl, EDIT_SIZE);
  const mask = await buildBadgeMask(EDIT_SIZE);

  const response = await client.images.edit({
    model: "gpt-image-1",
    image: await toFile(baseImage, "photo.png", { type: "image/png" }),
    mask: await toFile(mask, "mask.png", { type: "image/png" }),
    prompt:
      `Add a bold, eye-catching promotional price badge/sticker showing exactly "${opts.promoText}" ` +
      "inside the highlighted (transparent) area only, styled like a real hospitality/travel " +
      "marketing discount sticker (solid accent color background, bold readable text, subtle shadow). " +
      "Do not add, remove, or change anything outside the highlighted area - the rest of the photo " +
      "must stay exactly the same.",
    size: "1024x1024",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("GPT Image tidak mengembalikan hasil edit");

  const buffer = Buffer.from(b64, "base64");
  const key = buildAssetKey(opts.brandId, opts.projectId, "promo-overlay.png");
  return uploadBuffer(key, buffer, "image/png");
}

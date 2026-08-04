import OpenAI, { toFile } from "openai";
import { prepareSquarePng } from "@/lib/render/cloudinary";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import type { PosterCopy } from "./posterCopy";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diisi di .env");
  return new OpenAI({ apiKey });
}

// 1024 persegi (1:1) - salah satu dari 2 rasio yg diizinkan spec ("Poster 4:5 atau 1:1"),
// dipilih krn ukuran resmi yg didukung gpt-image-1 (4:5 pas tidak ada di preset resminya).
const EDIT_SIZE = 1024;

// "Pelangi Homestay Poster Design System v1" (2026-08-05, master prompt LENGKAP dari
// Agus, dipakai APA ADANYA - ini brief art-direction penuh, bukan sesuatu yg boleh
// disederhanakan sepihak) - CUMA berlaku jalur foto TUNGGAL (lihat processProject.ts),
// beda dari applyPromoOverlay (badge kecil 1 pojok, dipakai carousel multi-foto).
const MASTER_STYLE_PROMPT = `
Kamu adalah seorang Senior Graphic Designer spesialis hospitality, hotel, dan travel advertisement.
Seluruh desain HARUS mengikuti identitas visual Pelangi Homestay. Yang berubah cuma: judul, promo, CTA, foto, harga, isi tulisan - gaya desain HARUS tetap konsisten.

STYLE: Modern Tropical Resort, Clean Minimalist, luxury namun tetap ramah, Instagram Advertisement Quality, Travel Campaign Style, Soft Commercial Poster, High Conversion Marketing Poster. Jangan membuat poster seperti brosur jadul.

WARNA - Primary: Deep Emerald Green, Teal Green, Dark Green, Turquoise. Secondary: Orange, Warm Yellow, Soft Gold, White. Background: White, Cream, Light Beige, Soft Shadow Grey. Warna utama pasti: Emerald Green (#0F6A63), Teal, Putih, Orange Accent. Hindari warna merah mencolok, ungu, dan biru terang.

KOMPOSISI: layout rapi, banyak ruang kosong (white space), visual utama (foto) mendominasi 60-70%, elemen teks 30-40%. Posisi headline/CTA/badge harga/benefit/gallery/icon boleh fleksibel tiap poster selama tetap terlihat premium & seimbang.

FOTO: WAJIB pakai FOTO ASLI yang diberikan sbg visual utama, seluruh foto HARUS berasal dari foto ini - JANGAN menghasilkan hotel baru, JANGAN mengganti taman/interior/bangunan/kamar/pintu/view, JANGAN membuat foto AI atau memakai gambar stok. AI HANYA boleh melakukan: perspective correction, lighting enhancement, HDR enhancement, contrast improvement, color grading, highlight recovery, shadow recovery, sharpness enhancement, premium hotel look. TIDAK BOLEH: mengubah bentuk kamar, mengubah taman, menambah furniture, mengubah arsitektur, menambah kolam, menambah gunung, mengubah view. Foto harus tetap identik dengan footage asli (subjek/komposisinya), cuma kualitas visualnya yang di-enhance.

COLOR GRADING FOTO: Luxury Resort, Morning Natural Light, Soft Warm White, Rich Green, Natural Skin Tone, Bright but Soft, Premium Airbnb Style. Sedikit HDR. Highlight tetap natural. Shadow lembut. Tidak over saturated.

TYPOGRAPHY: kombinasi maksimal 2 font. Headline: Bold/Extra Bold Sans Serif Modern (karakter spt Montserrat, Poppins, League Spartan, Satoshi, General Sans). Subheadline (kalau ada): Elegant Script/Handwritten Luxury Brush (karakter spt Allura, Brittany, Great Vibes) atau script modern elegan. Body: Clean Sans Serif, mudah dibaca.

HIERARKI visual (urutan kepentingan): 1) Headline, 2) Foto utama, 3) Harga, 4) CTA, 5) Benefit, 6) Informasi tambahan.

ICON: outline modern, minimalis, tipis, seragam (contoh: wifi, parking, hot water, garden, coffee, breakfast, family, location, jam operasional). Jangan pakai icon kartun.

CARD: card putih, rounded corner, soft shadow, floating card. Glass effect tipis boleh dipakai.

BADGE HARGA: kalau ada harga/promo, bentuknya lingkaran/rounded badge/price tag/sticker, warna orange atau kuning, jadi salah satu fokus utama poster. Kalau TIDAK ada harga yg disebutkan di bawah, JANGAN menampilkan badge harga sama sekali - jangan mengarang angka.

EFEK: soft shadow, soft glow, gradient overlay, light blur, depth, floating element, glassmorphism ringan. Jangan berlebihan/norak.

CTA: harus sangat mencolok, warna orange.

SUASANA yang harus terasa: nyaman, tenang, asri, bersih, premium, homey, natural, refreshing, family friendly.

OUTPUT: resolusi tinggi, social media ready (1:1), margin rapi, semua tulisan harus mudah dibaca dgn jelas, tidak ada elemen yang saling bertabrakan/tumpang tindih secara berantakan.

VARIASI LAYOUT: boleh beda-beda tiap poster (kiri-kanan, hero image full, split layout, diagonal, magazine, floating card, editorial hospitality) selama warna/font/ikon/bayangan/nuansa visual tetap konsisten sbg satu brand yg sama.

BATASAN KERAS - JANGAN PERNAH: mengubah logo/identitas visual, pakai warna acak di luar palet di atas, bikin layout terlalu penuh/sesak, menambahkan elemen hotel yang tidak ada di foto asli, menghasilkan foto AI atau gambar stok, mengubah properti/bangunan/taman/kamar/pintu/view asli.
`.trim();

function buildPosterPrompt(copy: PosterCopy): string {
  const baris = [
    `Headline: "${copy.headline}"`,
    copy.subheadline ? `Subheadline: "${copy.subheadline}"` : null,
    copy.harga ? `Harga/Badge Promo: "${copy.harga}"` : "Tidak ada harga/promo - JANGAN tampilkan badge harga sama sekali.",
    `CTA: "${copy.cta}"`,
    copy.benefits.length > 0 ? `Benefit/fasilitas yang ditonjolkan: ${copy.benefits.join(", ")}` : null,
    copy.isiTulisan ? `Isi tulisan tambahan: "${copy.isiTulisan}"` : null,
  ].filter((line): line is string => !!line);

  return (
    `${MASTER_STYLE_PROMPT}\n\n---\n\nKONTEN POSTER INI (isi teks yang harus muncul, TERJEMAHKAN ` +
    `ke elemen visual sesuai seluruh aturan gaya di atas - jangan tampilkan teks lain di luar ini):\n` +
    `${baris.join("\n")}\n\nBuat SATU poster promosi Pelangi Homestay memakai foto yang diberikan ` +
    `sebagai visual utama.`
  );
}

// Poster foto tunggal penuh (BEDA dari applyPromoOverlay yg cuma badge kecil 1 pojok) -
// gpt-image-1 edit TANPA mask (perlu kebebasan taruh headline/CTA/badge di mana saja
// sesuai komposisi terbaik, tidak bisa dibatasi 1 kotak spt badge overlay) - keamanan foto
// asli TIDAK diegakkan lewat mask di sini, murni lewat instruksi tegas di
// MASTER_STYLE_PROMPT (bagian FOTO & BATASAN KERAS).
export async function applyPosterDesign(opts: {
  brandId: string;
  projectId: string;
  imageUrl: string;
  copy: PosterCopy;
}): Promise<string> {
  const client = getClient();
  const baseImage = await prepareSquarePng(opts.imageUrl, EDIT_SIZE);

  const response = await client.images.edit({
    model: "gpt-image-1",
    image: await toFile(baseImage, "photo.png", { type: "image/png" }),
    prompt: buildPosterPrompt(opts.copy),
    size: "1024x1024",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("GPT Image tidak mengembalikan hasil poster");

  const buffer = Buffer.from(b64, "base64");
  const key = buildAssetKey(opts.brandId, opts.projectId, "poster.png");
  return uploadBuffer(key, buffer, "image/png");
}

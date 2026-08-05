import { fal } from "@fal-ai/client";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import type { PosterCopy } from "./posterCopy";

function ensureFalConfigured(): void {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_KEY belum diisi di .env");
  fal.config({ credentials: apiKey });
}

// "Pelangi Homestay Poster Design System v1" (2026-08-05, master prompt LENGKAP dari
// Agus, dipakai APA ADANYA - ini brief art-direction penuh, bukan sesuatu yg boleh
// disederhanakan sepihak) - CUMA berlaku jalur foto TUNGGAL (lihat processProject.ts),
// beda dari applyPromoOverlay (badge kecil 1 pojok, dipakai carousel multi-foto).
// Disinkronkan ulang (2026-08-05, sesi sama) ke versi prompt Agus yang lebih lengkap -
// dicek Agus sendiri vs kode, 90% sudah identik (konfirmasi arsitektur "DNA desain
// statis + konten per-poster dinamis" sudah persis sesuai maksud beliau), 4 bagian
// ditambah biar sinkron penuh: GALLERY (gaya multi-foto), TARGET AUDIENS, rasio OUTPUT
// jadi "4:5 atau 1:1" (sebelumnya cuma 1:1), 3 nama gaya layout tambahan. Guard anti-
// karang harga (BADGE HARGA, "kalau tidak ada harga JANGAN mengarang angka") SENGAJA
// dipertahankan walau tidak ada di teks asli Agus - itu jaring pengaman tambahan yg
// sudah terbukti berguna di seluruh sesi ini, bukan sesuatu yg diminta dihapus.
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

GALLERY: kalau ada lebih dari 1 foto, gunakan gaya polaroid modern, atau floating photo, atau overlapping card, dengan shadow lembut - konsisten dgn gaya card/shadow di atas.

CTA: harus sangat mencolok, warna orange.

TARGET AUDIENS: wisatawan umum, pasangan, keluarga, pekerja remote (long stay), dan tamu day use - poster boleh condong ke salah satu tergantung konten (mis. promo keluarga vs promo romantis) selama gaya visual brand tetap konsisten.

SUASANA yang harus terasa: nyaman, tenang, asri, bersih, premium, homey, natural, refreshing, family friendly.

OUTPUT: resolusi tinggi, social media ready (4:5 atau 1:1), margin rapi, semua tulisan harus mudah dibaca dgn jelas, tidak ada elemen yang saling bertabrakan/tumpang tindih secara berantakan.

VARIASI LAYOUT: boleh beda-beda tiap poster (kiri-kanan, hero image full, split layout, diagonal, magazine, luxury resort poster, minimal travel ads, floating card, modern property ads, editorial hospitality) selama warna/font/ikon/bayangan/nuansa visual tetap konsisten sbg satu brand yg sama.

BATASAN KERAS - JANGAN PERNAH: mengubah logo/identitas visual, pakai warna acak di luar palet di atas, bikin layout terlalu penuh/sesak, menambahkan elemen hotel yang tidak ada di foto asli, menghasilkan foto AI atau gambar stok, mengubah properti/bangunan/taman/kamar/pintu/view asli.

KONTAK: JANGAN PERNAH menambahkan nomor telepon/WhatsApp, alamat website/domain, atau handle media sosial di poster kecuali disebutkan eksplisit di KONTEN POSTER INI di bawah - kalau tidak disebutkan, JANGAN tampilkan footer kontak/website/social handle apa pun, jangan mengarang nomor atau username. Sama seperti aturan harga: lebih baik tidak ada info kontak sama sekali daripada info yang salah/mengarang.
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
// Nano Banana 2 (fal.ai, gemini-3.1-flash-image via fal-ai/nano-banana-2/edit) TANPA
// mask - model ini sama sekali TIDAK PUNYA fitur mask biner (2026-08-05, dicek langsung
// ke dokumentasi resmi: "no masks needed", editing murni lewat instruksi natural
// language/"semantic masking") - keamanan foto asli TIDAK ditegakkan lewat mask, murni
// lewat instruksi tegas di MASTER_STYLE_PROMPT (bagian FOTO & BATASAN KERAS). Sebelumnya
// pakai gpt-image-1 (OpenAI) - diganti ke sini atas permintaan Agus (resolusi 1K,
// ~$0,08/gambar dari playground fal.ai beliau).
export async function applyPosterDesign(opts: {
  brandId: string;
  projectId: string;
  imageUrl: string;
  copy: PosterCopy;
}): Promise<string> {
  ensureFalConfigured();

  const result = await fal.subscribe("fal-ai/nano-banana-2/edit", {
    input: {
      prompt: buildPosterPrompt(opts.copy),
      image_urls: [opts.imageUrl],
      resolution: "1K",
    },
  });

  const imageUrl = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url;
  if (!imageUrl) throw new Error("Nano Banana 2 (fal.ai) tidak mengembalikan hasil poster");

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Gagal ambil hasil poster dari fal.ai: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const key = buildAssetKey(opts.brandId, opts.projectId, "poster.png");
  return uploadBuffer(key, buffer, "image/png");
}

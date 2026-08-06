import { fal } from "@fal-ai/client";
import { subscribeFalWithRetry } from "./falRetry";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import type { PosterCopy } from "./posterCopy";

function ensureFalConfigured(): void {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_KEY belum diisi di .env");
  fal.config({ credentials: apiKey });
}

// Brand Design System (2026-08-06, permintaan Agus - "jangan hanya membuat prompt 'buat
// poster'... buatlah Brand Design System Prompt sehingga semua poster memiliki identitas
// yang konsisten, tetapi layout tetap dinamis... Brand Profile -> Master Design Prompt ->
// Foto Asli -> AI Image Editor -> Poster Profesional"). SEBELUM ini SATU prompt hardcode
// (hijau emerald, ikon "wifi/parking/breakfast") dipakai utk SEMUA brand tanpa pandang
// bulu - brand baru non-hospitality (laundry, barbershop, dst) dapat poster bergaya
// resort tropis yg sama sekali tidak relevan, PERSIS kelas bug yg sudah ditemukan &
// diperbaiki hari ini di knowledgeSite (pelangiKnowledge.ts) & isIdeSpesifikProperti
// (classifyIdea.ts) - "brand baru diam-diam warisan default Pelangi".
//
// Dipecah 2 lapis persis skema Agus:
// 1. MASTER_DESIGN_SYSTEM_PROMPT (di bawah) - bagian STRUKTURAL/KUALITAS/KEAMANAN yg
//    SAMA utk SEMUA brand (peran desainer, aturan foto asli wajib, hierarki visual,
//    larangan mengarang harga/kontak/logo, dst) - TIDAK diduplikasi per brand.
// 2. `brandProfile` (param fungsi ini, dari brands.posterBrandProfile - lihat schema.ts)
//    - bagian yg BOLEH beda per brand (warna, font, ikon relevan, tone, target audiens,
//    aturan foto spesifik niche) - staf isi via Brand Settings, BUKAN hardcode di kode.
const MASTER_DESIGN_SYSTEM_PROMPT = `
Kamu adalah seorang Senior Graphic Designer berpengalaman 15+ tahun, spesialis poster promosi komersial premium utk bisnis lokal (hospitality, laundry, resto, travel, jasa, dst). Ikuti PROFIL BRAND yang diberikan terpisah di bawah utk warna/font/ikon/tone - bagian ini berlaku SAMA utk semua brand.

STYLE: Modern Minimalist, Premium Commercial Advertising, Clean Layout, High Trust, Eye-catching, High Conversion. Harus terlihat seperti buatan desainer profesional, BUKAN buatan AI. Jangan membuat poster seperti brosur jadul.

KOMPOSISI: layout rapi, banyak ruang kosong (white space), visual utama (foto) mendominasi 60-70%, elemen teks 30-40%. Posisi headline/CTA/badge harga/benefit/icon boleh fleksibel tiap poster (kiri-kanan, hero image full, split layout, diagonal, magazine, floating card, editorial) selama tetap terlihat premium & seimbang - JANGAN selalu taruh semua di tengah.

FOTO (SANGAT PENTING): WAJIB pakai FOTO ASLI yang diberikan sbg visual utama - objek utamanya (kamar/pakaian/produk/apa pun sesuai niche brand, lihat PROFIL BRAND) HARUS tetap identik, JANGAN membuat objek baru, JANGAN mengganti objek dgn yang lain, JANGAN membuat foto AI atau memakai gambar stok. AI HANYA boleh: perspective correction, lighting enhancement, HDR enhancement, contrast improvement, color grading, highlight/shadow recovery, sharpness enhancement, background enhancement, reflection & depth. TIDAK BOLEH mengubah bentuk/identitas objek utama, menambah elemen yang tidak ada di foto asli.

TYPOGRAPHY: kombinasi maksimal 2 font. Headline: Bold/Extra Bold Sans Serif Modern (kecuali PROFIL BRAND minta lain). Body: Clean Sans Serif, mudah dibaca. Hierarki font harus sangat jelas.

HIERARKI visual (urutan kepentingan): 1) Headline, 2) Foto utama, 3) Promo/Badge, 4) Benefit/Fasilitas, 5) Harga, 6) CTA, 7) Kontak.

ICON: outline modern, minimalis, stroke seragam, warna sesuai warna utama PROFIL BRAND (bukan warna acak). Jangan pakai icon kartun.

CARD: card putih/gradient, rounded corner, soft shadow, floating card. Glass effect tipis boleh dipakai.

BADGE HARGA/PROMO: kalau ada harga/promo, bentuknya lingkaran/rounded badge/pill/ribbon, jadi salah satu fokus utama poster. Kalau TIDAK ada harga yg disebutkan di KONTEN POSTER di bawah, JANGAN menampilkan badge harga sama sekali - jangan mengarang angka.

EFEK: soft shadow natural (bukan hard shadow), soft glow, gradient overlay, light blur, depth, floating element, glassmorphism ringan. Jangan berlebihan/norak/sesak.

OUTPUT: resolusi tinggi, social media ready (4:5 atau 1:1), margin rapi, semua tulisan mudah dibaca, tidak ada elemen yang saling bertabrakan/tumpang tindih.

BATASAN KERAS - JANGAN PERNAH: mengubah logo/identitas visual brand, bikin layout terlalu penuh/sesak, menambahkan elemen yang tidak ada di foto asli, menghasilkan foto AI atau gambar stok, mengubah identitas objek utama di foto asli.

KONTAK: JANGAN PERNAH menambahkan nomor telepon/WhatsApp, alamat website/domain, atau handle media sosial di poster kecuali disebutkan eksplisit di KONTEN POSTER INI di bawah - lebih baik tidak ada info kontak sama sekali daripada info yang salah/mengarang.

LOGO: JANGAN PERNAH membuat/menggambar logo, badge brand, seal/stempel "verified"/"certified", watermark, atau simbol apa pun yang menyerupai identitas brand - JANGAN sekalipun sekadar elemen dekoratif. Logo ASLI brand (kalau ada) ditempel TERPISAH sesudah gambar ini jadi, lewat proses lain di luar kendalimu - tugasmu HANYA desain poster tanpa logo apa pun, jangan mengisi "kekosongan" itu dengan logo karangan.

ZONA AMAN LOGO (WAJIB DIPATUHI - bukan saran, ini POSISI PASTI): logo ASLI brand akan ditempel TEPAT di pojok KANAN ATAS gambar, berbentuk lingkaran, dengan diameter kira-kira 16% dari sisi PENDEK gambar dan margin sekitar 4% dari tepi atas & tepi kanan. Artinya area PERSEGI di pojok kanan-atas seluas kira-kira 20% lebar x 20% tinggi (dihitung dari sisi pendek gambar) HARUS dibiarkan KOSONG/BERSIH dari teks, headline, atau elemen penting apa pun - boleh diisi background/langit/warna polos/blur di area itu, TAPI JANGAN taruh huruf/kata di sana sama sekali, walau cuma sebagian huruf. Headline yang butuh 2 baris HARUS dimulai/diposisikan supaya baris manapun TIDAK menjorok ke area pojok kanan-atas itu - kalau perlu, geser headline lebih ke kiri/bawah atau perpendek baris pertama, JANGAN biarkan teks kepotong logo.
`.trim();

// Fallback (2026-08-06) - brand yg BELUM isi posterBrandProfile (mis. brand baru yg
// belum sempat diisi stafnya) pakai profil netral ini, BUKAN diam-diam warisan gaya
// Pelangi (itu justru bug yg sedang diperbaiki di sini). Sengaja generik/aman, bukan
// niche apa pun spesifik - mendorong staf mengisi profil asli lewat Brand Settings.
const FALLBACK_BRAND_PROFILE = `
PROFIL BRAND: belum diisi staf - pakai gaya netral & aman.
WARNA: Biru tua (#1E3A5F) & Putih sbg warna utama, abu-abu terang sbg background, satu warna aksen hangat (oranye/kuning) HANYA utk badge harga/CTA.
TONE: profesional, terpercaya, bersih, modern - netral, tidak condong ke niche tertentu.
`.trim();

function buildPosterPrompt(copy: PosterCopy, brandProfile: string | null | undefined): string {
  const baris = [
    `Headline: "${copy.headline}"`,
    copy.subheadline ? `Subheadline: "${copy.subheadline}"` : null,
    copy.harga ? `Harga/Badge Promo: "${copy.harga}"` : "Tidak ada harga/promo - JANGAN tampilkan badge harga sama sekali.",
    `CTA: "${copy.cta}"`,
    copy.benefits.length > 0 ? `Benefit/fasilitas yang ditonjolkan: ${copy.benefits.join(", ")}` : null,
    copy.isiTulisan ? `Isi tulisan tambahan: "${copy.isiTulisan}"` : null,
  ].filter((line): line is string => !!line);

  const profile = (brandProfile || "").trim() || FALLBACK_BRAND_PROFILE;

  return (
    `${MASTER_DESIGN_SYSTEM_PROMPT}\n\n---\n\nPROFIL BRAND (warna/font/ikon/tone brand ini - ` +
    `WAJIB diikuti, ini yang membedakan brand ini dari brand lain):\n${profile}\n\n---\n\n` +
    `KONTEN POSTER INI (isi teks yang harus muncul, TERJEMAHKAN ke elemen visual sesuai ` +
    `seluruh aturan gaya di atas - jangan tampilkan teks lain di luar ini):\n` +
    `${baris.join("\n")}\n\nBuat SATU poster promosi memakai foto yang diberikan sebagai visual utama.`
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
  brandProfile?: string | null;
}): Promise<string> {
  ensureFalConfigured();

  const result = await subscribeFalWithRetry("fal-ai/nano-banana-2/edit", {
    prompt: buildPosterPrompt(opts.copy, opts.brandProfile),
    image_urls: [opts.imageUrl],
    resolution: "1K",
  });

  const imageUrl = (result.data as { images?: Array<{ url: string }> })?.images?.[0]?.url;
  if (!imageUrl) throw new Error("Nano Banana 2 (fal.ai) tidak mengembalikan hasil poster");

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Gagal ambil hasil poster dari fal.ai: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const key = buildAssetKey(opts.brandId, opts.projectId, "poster.png");
  return uploadBuffer(key, buffer, "image/png");
}

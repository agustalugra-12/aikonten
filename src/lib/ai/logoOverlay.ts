import sharp from "sharp";

// Watermark logo brand (2026-08-05, permintaan Agus) - ditempel di SETIAP foto & video
// final kalau brand punya logoUrl (lihat brands.logoUrl, nullable - brand tanpa logo
// dilewati begitu saja, bukan wajib). Dua permintaan spesifik: (1) frame LINGKARAN,
// bukan kotak, (2) ukuran PROPORSIONAL - jangan sampai nutupin konten foto/video
// terlalu banyak. Diturunkan dari 16% ke 8% dari sisi pendek konten (2026-08-10,
// laporan Agus - "logo terlalu besar" di video hasil render) - tetap kebaca sbg
// watermark brand, tapi lebih dekat ukuran standar watermark media sosial (biasanya
// 5-10%, versi lama 16% kegedean).
export const LOGO_SIZE_RATIO = 0.08;
export const LOGO_MARGIN_RATIO = 0.04;

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal ambil file: ${url} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// Crop logo APA PUN bentuk aslinya (kotak, persegi panjang, dst) jadi lingkaran penuh
// via SVG circle sbg alpha mask (blend "dest-in" - area di luar lingkaran jadi
// transparan). sizePx = ukuran akhir dlm piksel, dihitung pemanggil berdasarkan
// proporsi konten (lihat LOGO_SIZE_RATIO).
export async function buildCircularLogoPng(logoUrl: string, sizePx: number): Promise<Buffer> {
  const raw = await fetchBuffer(logoUrl);
  const size = Math.max(8, Math.round(sizePx));
  const circleMask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );
  return sharp(raw)
    .resize(size, size, { fit: "cover", position: "centre" })
    .ensureAlpha()
    .composite([{ input: circleMask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

// Tempel logo lingkaran ke foto FINAL (poster/carousel) - pojok kanan-atas dgn margin,
// ukuran proporsional terhadap sisi PENDEK foto (supaya konsisten baik foto potret
// maupun persegi, tidak kegedean di foto sempit).
export async function applyLogoToImage(imageUrl: string, logoUrl: string): Promise<Buffer> {
  const imageBuffer = await fetchBuffer(imageUrl);
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 1080;
  const height = meta.height || 1080;
  const shortSide = Math.min(width, height);
  const logoSize = Math.round(shortSide * LOGO_SIZE_RATIO);
  const margin = Math.round(shortSide * LOGO_MARGIN_RATIO);
  const logoPng = await buildCircularLogoPng(logoUrl, logoSize);

  return sharp(imageBuffer)
    .composite([{ input: logoPng, top: margin, left: Math.max(0, width - logoSize - margin) }])
    .toBuffer();
}

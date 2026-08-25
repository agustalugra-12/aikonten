import sharp from "sharp";
import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";

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

// Asset Cache utk logo (2026-08-10, PRD "AI Content Editing Engine" - "Asset Cache...
// agar render ulang tidak perlu mengunduh ulang") - logoUrl brand SAMA dipakai di
// SETIAP video/foto brand itu (bukan sekali pakai spt footage Pexels/broll yg memang
// beda2 per video), jadi sebelum ini fetch+resize+crop lingkaran diulang dari NOL di
// SETIAP render, padahal hasilnya SELALU identik selama logoUrl+ukuran sama. Cache
// disk sederhana di tmpdir, key = hash(logoUrl+size) - TIDAK perlu invalidasi manual:
// upload logo baru dari BrandSettingsSidebar selalu dapat URL R2 baru (nama file
// pakai timestamp upload, lihat pola upload-url lain di project ini), jadi ganti logo
// otomatis dapat cache key baru, logo lama di cache jadi tidak pernah kepakai lagi
// (dibiarkan, bukan LRU - ukurannya kecil, PNG logo brand sedikit sekali variasinya).
const LOGO_CACHE_DIR = path.join(tmpdir(), "kontenpilot_logo_cache");

function logoCacheKey(logoUrl: string, sizePx: number): string {
  return createHash("sha256").update(`${logoUrl}::${sizePx}`).digest("hex");
}

// Crop logo APA PUN bentuk aslinya (kotak, persegi panjang, dst) jadi lingkaran penuh
// via SVG circle sbg alpha mask (blend "dest-in" - area di luar lingkaran jadi
// transparan). sizePx = ukuran akhir dlm piksel, dihitung pemanggil berdasarkan
// proporsi konten (lihat LOGO_SIZE_RATIO).
export async function buildCircularLogoPng(logoUrl: string, sizePx: number): Promise<Buffer> {
  const size = Math.max(8, Math.round(sizePx));
  const cacheFile = path.join(LOGO_CACHE_DIR, `${logoCacheKey(logoUrl, size)}.png`);
  try {
    return await readFile(cacheFile);
  } catch {
    // Cache miss (belum pernah/file terhapus) - lanjut proses normal di bawah.
  }

  const raw = await fetchBuffer(logoUrl);
  const circleMask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );
  // fit: "contain" (bukan "cover") - logo brand TIDAK SELALU persegi (mis. wordmark
  // studio/agency yg lebar horizontal, beda dari logo Pelangi/Laundry yg lebih persegi).
  // "cover" dulu mengisi penuh sizeXsize dgn CROP sisi panjang - utk logo lebar itu
  // artinya kiri-kanan wordmark terpotong sebelum sempat kena mask lingkaran, hasilnya
  // "tidak rapi" (2026-08-25, laporan Agus - brand Agustap Studio pojok kanan kacau,
  // sementara Laundry in Bali/Pelangi Homestay -yg logonya sudah persegi- terlihat baik-
  // baik saja, konsisten dgn root cause ini). "contain" + background transparan
  // menyisakan padding di sisi pendek alih2 crop - seluruh logo tetap utuh & tetap
  // proporsional di dalam bingkai lingkaran, utk logo yg SUDAH persegi hasilnya identik
  // dgn "cover" (tidak ada regresi utk brand yg sudah rapi).
  const png = await sharp(raw)
    .resize(size, size, { fit: "contain", position: "centre", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .composite([{ input: circleMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  try {
    await mkdir(LOGO_CACHE_DIR, { recursive: true });
    await writeFile(cacheFile, png);
  } catch (err) {
    // Gagal simpan cache TIDAK BOLEH menggagalkan render (mis. disk penuh sesaat) -
    // hasil PNG tetap dipakai/dikembalikan, cuma render berikutnya proses ulang lagi.
    console.error("[logoOverlay] gagal simpan cache logo, lanjut tanpa cache:", err);
  }
  return png;
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

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

// Bersihkan Zona Logo SECARA DETERMINISTIK (2026-09-06, permintaan Agus - "cari solusi
// terbaik agar bisa generate 1x saja tanpa logo dan hasilnya sesuai") - root cause
// masalah "AI tetap menaruh ikon di pojok kanan-atas" (kasus AgustaP Studio: brand
// profile brand ini SENDIRI eksplisit minta visual/floating label di "kanan atas",
// bentrok dgn zona reserved logo) TERBUKTI TIDAK BISA diselesaikan tuntas lewat
// instruksi teks ke model (sudah dicoba 2x reinforcement prompt, live test tetap 6/6
// gagal) - Nano Banana 2/Gemini image TIDAK PUNYA mask piksel, jadi kepatuhan spasial
// tidak pernah 100% terjamin dari sisi prompt. Fix SESUNGGUHNYA: jangan andalkan model
// patuh, PAKSA zona itu bersih lewat kode (blur berat, bukan hapus/crop - SHARED_
// STRUCTURAL_RULES di posterDesign.ts sendiri sudah bilang "boleh diisi background/
// blur" utk zona ini, jadi blur SESUAI spesifikasi awal, bukan tempelan asing). Dipanggil
// SEBELUM checkPosterQuality (lihat posterDesign.ts) - kalau zona sudah pasti bersih dari
// kode, kategori kegagalan QC "pojok kanan atas kotor" nyaris tidak akan pernah trigger
// lagi, artinya generate ULANG (auto-fix, $0.067 lagi) jadi jauh lebih jarang perlu -
// pencapaian "generate 1x saja" yg diminta, TANPA mengorbankan hasil (blur di pojok yg
// memang akan ditimpa logo asli tidak terlihat aneh sama sekali).
export async function clearLogoZone(buffer: Buffer): Promise<Buffer> {
  // (2026-09-29 v2) Bersihkan pojok kanan-atas dari artefak Gemini (kotak/panel/bezel/double-logo).
  // v1 cuma blur zona logo ~12% - TERBUKTI tak cukup: Gemini kadang gambar KOTAK jauh lebih besar
  // (~28% lebar x 22% tinggi) yg menjorok keluar zona. v2: TUTUP rectangle lebih besar dgn warna
  // background yg DI-SAMPLE dari tepi bawah-kiri zona (area yg by-design polos, lihat ZONA_AMAN_LOGO
  // di posterDesign) + feather tepi supaya menyatu. Zona ini memang direservasi kosong utk logo,
  // jadi menutupnya aman (bukan konten). Logo asli ditempel di atasnya sesudah ini.
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 1080;
  const height = meta.height || 1080;
  const shortSide = Math.min(width, height);
  const zoneW = Math.min(width, Math.round(shortSide * 0.28));
  const zoneH = Math.min(height, Math.round(shortSide * 0.22));
  const box = { left: Math.max(0, width - zoneW), top: 0, width: zoneW, height: zoneH };

  // Sample warna background dari titik tepat DI BAWAH-KIRI zona (biasanya bg polos poster).
  let r = 255, g = 255, b = 255;
  try {
    const sx = Math.max(0, box.left - Math.round(shortSide * 0.02));
    const sy = Math.min(height - 6, box.height + Math.round(shortSide * 0.01));
    const px = await sharp(buffer).extract({ left: sx, top: sy, width: 6, height: 6 }).resize(1, 1).raw().toBuffer();
    r = px[0]; g = px[1]; b = px[2];
  } catch { /* fallback putih */ }

  // Tutup zona dgn warna bg solid, lalu feather (blur ringan) seam-nya supaya menyatu.
  const patch = await sharp({ create: { width: box.width, height: box.height, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const filled = await sharp(buffer).composite([{ input: patch, left: box.left, top: box.top }]).toBuffer();
  const feather = await sharp(filled).extract(box).blur(Math.max(10, box.width * 0.06)).toBuffer();
  return sharp(filled).composite([{ input: feather, left: box.left, top: box.top }]).toBuffer();
}

// Tempel logo lingkaran ke foto FINAL (poster/carousel) - pojok kanan-atas dgn margin,
// ukuran proporsional terhadap sisi PENDEK foto (supaya konsisten baik foto potret
// maupun persegi, tidak kegedean di foto sempit).
export async function applyLogoToImage(imageUrl: string, logoUrl: string): Promise<Buffer> {
  // (2026-09-29, Opsi B) TIDAK lagi mengosongkan zona pojok (clearLogoZone) - reservasi/pembersihan
  // zona itu justru yang MEMICU Gemini menggambar kotak/panel placeholder (dibuktikan lewat tes
  // no-logo: tanpa reservasi, pojok bersih & natural). Sekarang desain kanvas dibiarkan PENUH &
  // natural; logo kecil ditumpuk di pojok kanan-atas dgn backing lingkaran putih tipis (bukan kotak
  // besar) supaya tetap terbaca di atas background apa pun. Berlaku SEMUA jalur (poster & carousel).
  const imageBuffer = await fetchBuffer(imageUrl);
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 1080;
  const height = meta.height || 1080;
  const shortSide = Math.min(width, height);
  const logoSize = Math.round(shortSide * LOGO_SIZE_RATIO);
  const margin = Math.round(shortSide * LOGO_MARGIN_RATIO);
  const logoPng = await buildCircularLogoPng(logoUrl, logoSize);
  const logoLeft = Math.max(0, width - logoSize - margin);
  // Backing lingkaran putih tipis (sedikit lebih besar dari logo) - kontras cukup di atas background
  // apa pun TANPA jadi kotak besar. Semi-transparan (0.9) supaya menyatu, bukan tempelan kaku.
  const backSize = Math.round(logoSize * 1.16);
  const backOffset = Math.round((backSize - logoSize) / 2);
  const backTop = Math.max(0, margin - backOffset);
  const backLeft = Math.max(0, logoLeft - backOffset);
  const backPng = await sharp(Buffer.from(
    `<svg width="${backSize}" height="${backSize}"><circle cx="${backSize / 2}" cy="${backSize / 2}" r="${backSize / 2}" fill="white" fill-opacity="0.9"/></svg>`
  )).png().toBuffer();

  // .png() eksplisit (2026-09-06, ditemukan sekalian audit migrasi Gemini) - TANPA ini
  // sharp mempertahankan format INPUT apa adanya (JPEG kalau posternya JPEG) krn tidak
  // ada encoder eksplisit dipanggil. Sebelum migrasi ke Gemini API ini TIDAK PERNAH
  // ketahuan krn fal.ai selalu balikin PNG - sekarang Gemini kadang balikin JPEG (lihat
  // geminiImage.ts), sementara SATU-SATUNYA pemanggil (processProject.ts) hardcode
  // upload sbg "logo_N.png"/"image/png" - tanpa .png() di sini, hasil JPEG bisa
  // ke-upload dgn ekstensi/content-type png yg salah (bug yg sama persis sudah
  // diperbaiki di posterDesign.ts, di sini dibetulkan dgn cara SEBALIKNYA - paksa
  // output PNG selalu, bukan ikutkan mimeType asli, krn caller sudah menganggap PNG).
  return sharp(imageBuffer)
    .composite([
      { input: backPng, top: backTop, left: backLeft },
      { input: logoPng, top: margin, left: logoLeft },
    ])
    .png()
    .toBuffer();
}

// Verifikasi fix logoOverlay.ts (2026-08-25, laporan Agus - logo brand Agustap Studio
// "tidak rapi" di pojok kanan poster, beda dari Laundry in Bali/Pelangi Homestay).
// Root cause: fit "cover" meng-crop sisi panjang logo NON-persegi (wordmark lebar)
// sebelum kena mask lingkaran. Test ini bikin logo wordmark palsu (lebar >> tinggi),
// jalankan pipeline resize+mask yang SAMA seperti buildCircularLogoPng, lalu pastikan
// piksel dari UJUNG KIRI & UJUNG KANAN logo asli masih ada di hasil akhir (dgn fit
// "contain" seharusnya ada, dgn "cover" yang lama akan hilang/terpotong).
// Jalankan: npx tsx scripts/verify-logo-overlay.ts

import sharp from "sharp";

let failed = false;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed = true;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

async function buildMasked(raw: Buffer, size: number, fit: "cover" | "contain"): Promise<Buffer> {
  const circleMask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );
  return sharp(raw)
    .resize(size, size, { fit, position: "centre", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .composite([{ input: circleMask, blend: "dest-in" }])
    .raw()
    .toBuffer();
}

async function edgeHasColor(raw: Buffer, size: number, fit: "cover" | "contain"): Promise<boolean> {
  const pixels = await buildMasked(raw, size, fit);
  // Pixel tengah-vertikal, dekat tepi kiri (x=2) - kalau mark di ujung kiri logo asli
  // masih ada, warna merah harus kebaca di sana (contain: ada: cover: crop, hilang).
  const y = Math.floor(size / 2);
  const x = 2;
  const idx = (y * size + x) * 4; // RGBA raw buffer
  const [r, g, b] = [pixels[idx], pixels[idx + 1], pixels[idx + 2]];
  return r > 150 && g < 100 && b < 100; // merah dominan
}

async function main() {
  const WIDE_W = 600;
  const WIDE_H = 120;
  // Wordmark palsu: latar putih, mark merah HANYA di ujung kiri (x:0-30) - mensimulasikan
  // teks/elemen logo yang menyentuh tepi kiri gambar asli (khas wordmark studio lebar).
  // "cover" akan crop ~80% sisi lebar (scale height 120->120 = 1x, lalu crop tengah
  // 600->120) sehingga mark di x:0-30 pasti hilang; "contain" menyusutkan SELURUH lebar
  // jadi muat (tanpa crop), mark tetap kebaca dekat tepi hasil akhir.
  const wideLogo = await sharp({
    create: { width: WIDE_W, height: WIDE_H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 30, height: WIDE_H, channels: 4, background: { r: 220, g: 20, b: 20, alpha: 1 } },
        })
          .png()
          .toBuffer(),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  const size = 120;

  const containHasEdge = await edgeHasColor(wideLogo, size, "contain");
  const coverHasEdge = await edgeHasColor(wideLogo, size, "cover");

  assert(containHasEdge, "fit=contain (fix baru): tepi kiri wordmark lebar TETAP ada di hasil circular crop");
  assert(!coverHasEdge, "fit=cover (perilaku lama): tepi kiri wordmark lebar HILANG ter-crop (bukti bug lama nyata)");

  // Regresi: logo yang SUDAH persegi harus identik hasilnya di kedua fit (tidak ada
  // downside utk brand yang logonya sudah rapi, mis. Pelangi Homestay/Laundry in Bali).
  const squareLogo = await sharp({
    create: { width: 300, height: 300, channels: 4, background: { r: 30, g: 120, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const containSquare = await buildMasked(squareLogo, size, "contain");
  const coverSquare = await buildMasked(squareLogo, size, "cover");
  assert(Buffer.compare(containSquare, coverSquare) === 0, "logo persegi: fit contain vs cover hasil identik (no regresi)");

  if (failed) {
    console.error("\nADA YANG GAGAL");
    process.exit(1);
  }
  console.log("\nSEMUA LOLOS");
}

main();

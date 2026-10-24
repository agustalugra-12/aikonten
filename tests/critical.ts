// Unit test jalur kritis (uang & keamanan) - 2026-10-23. Murni fungsi, TIDAK menyentuh DB
// produksi. Jalankan: `npm test` (tsx tests/critical.ts). Set env SEBELUM import modul yg
// membaca env saat module-load (duitku/tripay).
import assert from "node:assert";
import crypto from "node:crypto";

process.env.DUITKU_MERCHANT_CODE = "DTEST";
process.env.DUITKU_API_KEY = "apikeytest";
process.env.TRIPAY_PRIVATE_KEY = "privtest";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.error("  ✗ GAGAL:", name); }
}

async function run() {
  // ---------- TOTP (RFC 6238) ----------
  const totp = await import("../src/lib/totp.ts");
  ok("TOTP vektor RFC 287082", totp._selfCheck());
  const sec = totp.generateSecret();
  ok("TOTP kode valid diterima", totp.verifyTotp(sec, totp.totpAt(sec, Date.now())));
  ok("TOTP kode salah ditolak", !totp.verifyTotp(sec, "000000"));
  ok("TOTP format bukan 6 digit ditolak", !totp.verifyTotp(sec, "12ab"));
  ok("TOTP toleransi window (step -1)", totp.verifyTotp(sec, totp.totpAt(sec, Date.now() - 30000)));

  // ---------- Duitku signature ----------
  const duitku = await import("../src/lib/billing/duitku.ts");
  ok("Duitku configured (env terisi)", duitku.duitkuConfigured());
  const oid = "bill_x", amt = 149000;
  const expInq = crypto.createHash("md5").update("DTEST" + oid + String(amt) + "apikeytest").digest("hex");
  ok("Duitku inquirySignature = MD5 benar", duitku.inquirySignature(oid, amt) === expInq);
  const cbSig = crypto.createHash("md5").update("DTEST149000" + oid + "apikeytest").digest("hex");
  ok("Duitku callback: sig benar diterima", duitku.verifyCallbackSignature({ merchantOrderId: oid, amount: "149000", signature: cbSig }));
  ok("Duitku callback: sig salah ditolak", !duitku.verifyCallbackSignature({ merchantOrderId: oid, amount: "149000", signature: "0".repeat(32) }));

  // ---------- Tripay signature ----------
  const tripay = await import("../src/lib/billing/tripay.ts");
  ok("Tripay configured (env terisi)", tripay.tripayConfigured());
  const body = JSON.stringify({ reference: "T1", merchant_ref: "bill_x", status: "PAID" });
  const tSig = crypto.createHmac("sha256", "privtest").update(body).digest("hex");
  ok("Tripay callback: sig benar diterima", tripay.verifyTripayCallback(body, tSig));
  ok("Tripay callback: sig salah ditolak", !tripay.verifyTripayCallback(body, "nope"));
  ok("Tripay callback: body diubah ditolak (sig atas body mentah)", !tripay.verifyTripayCallback(body + " ", tSig));

  // ---------- Rate limit ----------
  const rl = await import("../src/lib/rateLimit.ts");
  const k = "test:" + crypto.randomUUID();
  let blockedAt = 0;
  for (let i = 1; i <= 6; i++) {
    if (rl.cekRateLimit(k, 5).blocked) { blockedAt = i; break; }
    rl.catatGagal(k, 60000);
  }
  ok("RateLimit blokir pada percobaan ke-6 (maks 5)", blockedAt === 6);
  rl.resetRateLimit(k);
  ok("RateLimit reset membuka blokir", !rl.cekRateLimit(k, 5).blocked);

  // ---------- Aturan produk: video panjang + kredit carousel (2026-10-24) ----------
  const ap = await import("../src/lib/billing/aturanProduk.ts");
  ok("carousel 1 slide = 1 kredit", ap.hitungBiayaKredit("carousel", { carouselPhotosPerPost: 1 }) === 1);
  ok("carousel 3 slide = 3 kredit", ap.hitungBiayaKredit("carousel", { carouselPhotosPerPost: 3 }) === 3);
  ok("carousel 5 slide = 5 kredit", ap.hitungBiayaKredit("carousel", { carouselPhotosPerPost: 5 }) === 5);
  ok("carousel >5 di-cap 5 (render cap)", ap.hitungBiayaKredit("carousel", { carouselPhotosPerPost: 10 }) === 5);
  ok("foto (poster_feed) = 1 kredit", ap.hitungBiayaKredit("carousel", { contentFormat: "poster_feed", carouselPhotosPerPost: 5 }) === 1);
  ok("video = 1 kredit (tak berubah)", ap.hitungBiayaKredit("video", {}) === 1);
  ok("video 300s = long-form", ap.apakahVideoPanjang("video", null, 300) === true);
  ok("video 60s = BUKAN long-form", ap.apakahVideoPanjang("video", null, 60) === false);
  ok("youtube_shorts = BUKAN long-form", ap.apakahVideoPanjang("video", "youtube_shorts", 300) === false);
  ok("carousel = BUKAN long-form", ap.apakahVideoPanjang("carousel", null, 300) === false);
  let blokEkst = false; try { ap.pastikanFormatDiizinkan({ type: "video", contentFormat: null, videoDurationTarget: 300, unlimited: false }); } catch { blokEkst = true; }
  ok("tenant eksternal + long-form DITOLAK", blokEkst);
  let intOK = true; try { ap.pastikanFormatDiizinkan({ type: "video", contentFormat: null, videoDurationTarget: 300, unlimited: true }); } catch { intOK = false; }
  ok("brand internal (unlimited) + long-form DIIZINKAN", intOK);
  let pendekOK = true; try { ap.pastikanFormatDiizinkan({ type: "video", contentFormat: null, videoDurationTarget: 60, unlimited: false }); } catch { pendekOK = false; }
  ok("tenant eksternal + video pendek DIIZINKAN", pendekOK);
  let fotoOK = true; try { ap.pastikanFormatDiizinkan({ type: "carousel", contentFormat: "poster_feed", videoDurationTarget: null, unlimited: false }); } catch { fotoOK = false; }
  ok("tenant eksternal + foto/carousel DIIZINKAN", fotoOK);

  ok("batas starter video=1", ap.batasHarianPaket("starter").video === 1);
  ok("batas pro video=3", ap.batasHarianPaket("pro").video === 3);
  ok("batas agency video=5 foto=5", ap.batasHarianPaket("agency").video === 5 && ap.batasHarianPaket("agency").foto === 5);
  ok("paket tak dikenal/null -> starter", ap.batasHarianPaket("xxx").video === 1 && ap.batasHarianPaket(null).video === 1);
  ok("clamp min(setting 10, cap starter 1)=1", Math.min(10, ap.batasHarianPaket("starter").video) === 1);

  console.log(`\n${pass} lolos, ${fail} gagal`);
  assert.strictEqual(fail, 0, `${fail} tes gagal`);
}
run().catch((e) => { console.error(e); process.exit(1); });

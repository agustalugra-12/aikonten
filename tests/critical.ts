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

  // (revisi-6 2026-11-06) Blok batasHarianPaket DIHAPUS: fungsi itu sudah dibuang saat plafon harian per-tipe
  // dihapus (keputusan "No Daily Type Cap"); tes basi ini melempar TypeError & menggagalkan SELURUH suite.

  // ---------- Render: font subtitle + preset animasi + title card (Phase 1, 2026-10-25) ----------
  const sd = await import("../src/lib/render/subtitleDesign.ts");
  const words = [
    { word: "Halo", start: 0, end: 0.4 },
    { word: "dunia", start: 0.4, end: 0.9 },
  ];
  const ass = sd.buildWordHighlightAss(words, sd.DEFAULT_SUBTITLE_DESIGN, 1080, 1920);
  ok("subtitle Style memakai font Poppins SemiBold (bukan hardcode lain)", ass.includes("Default,Poppins SemiBold,"));
  ok("default animasi = PopIn (scale 70->100)", ass.includes("\\fscx70\\fscy70\\t(0,120,\\fscx100\\fscy100)"));
  // Preset registry: tiap gaya hasilkan tag khas & berbeda.
  const hl = "&H4DD8FF&"; // contoh tag warna (urutan bgr)
  ok("preset PopIn ada \\fscx70", sd.SUBTITLE_ANIMATION_PRESETS.PopIn(hl).includes("\\fscx70"));
  ok("preset FadeIn pakai \\alpha (fade), tanpa skala", sd.SUBTITLE_ANIMATION_PRESETS.FadeIn(hl).includes("\\alpha&HFF&") && !sd.SUBTITLE_ANIMATION_PRESETS.FadeIn(hl).includes("\\fscx"));
  ok("preset Bounce overshoot (2x \\t)", sd.SUBTITLE_ANIMATION_PRESETS.Bounce(hl).match(/\\t\(/g)?.length === 2);
  ok("preset None hanya warna (tanpa transform)", !sd.SUBTITLE_ANIMATION_PRESETS.None(hl).includes("\\t(") && !sd.SUBTITLE_ANIMATION_PRESETS.None(hl).includes("\\fscx"));
  ok("buildWordHighlightAss hormati animation=FadeIn", sd.buildWordHighlightAss(words, { ...sd.DEFAULT_SUBTITLE_DESIGN, animation: "FadeIn" }, 1080, 1920).includes("\\alpha&HFF&"));

  const tc = await import("../src/lib/render/titleCard.ts");
  const titleAss = tc.buildTitleCardAss("Rahasia Sukses", tc.DEFAULT_TITLE_CARD_DESIGN, 1080, 1920, { startSeconds: 0 });
  ok("title card berisi teks judul", titleAss.includes("Rahasia Sukses"));
  ok("title card center (\\an5) + fade + pop", titleAss.includes("\\an5") && titleAss.includes("\\fad(") && titleAss.includes("\\t(0,250,\\fscx100\\fscy100)"));
  ok("title card pakai font Poppins SemiBold", titleAss.includes("Title,Poppins SemiBold,"));
  ok("title card sanitasi { } (tak bikin ASS override liar)", !tc.buildTitleCardAss("a{b}c", tc.DEFAULT_TITLE_CARD_DESIGN, 1080, 1920).includes("a{b}c"));

  // ---------- Phase 2: Font Studio & Brand Kit (2026-10-25) ----------
  const fr = await import("../src/lib/render/fontRegistry.ts");
  const r1 = fr.resolveFont("poppins", "semibold");
  ok("resolveFont poppins/semibold -> assName 'Poppins SemiBold'", r1.assName === "Poppins SemiBold" && r1.file.endsWith("Poppins-SemiBold.ttf") && !r1.usedFallback);
  ok("resolveFont poppins/bold -> assBold -1 (file Bold)", fr.resolveFont("poppins", "bold").assBold === -1 && fr.resolveFont("poppins", "bold").file.endsWith("Poppins-Bold.ttf"));
  const r2 = fr.resolveFont("tidakada", "bold");
  ok("resolveFont family invalid -> fallback poppins + usedFallback", r2.family === "poppins" && r2.usedFallback === true);
  const r3 = fr.resolveFont("anton", "bold");
  ok("resolveFont anton/bold (weight tak ada) -> regular + usedFallback", r3.weight === "regular" && r3.usedFallback === true);
  ok("fontCatalog berisi 6 family kurasi", fr.fontCatalog().length === 6 && fr.fontCatalog().some((f) => f.id === "bebasneue"));
  ok("isFontFamilyId tolak sembarang", !fr.isFontFamilyId("../etc/passwd") && fr.isFontFamilyId("poppins"));

  const bkm = await import("../src/lib/render/brandKit.ts");
  ok("validateBrandKit terima config valid", bkm.validateBrandKit({ subtitleFont: "anton", subtitleColor: "#FF0000", outlineWidth: 3 }).ok === true);
  ok("validateBrandKit tolak font asing", bkm.validateBrandKit({ subtitleFont: "comic-sans" }).ok === false);
  ok("validateBrandKit tolak hex invalid", bkm.validateBrandKit({ subtitleColor: "red" }).ok === false);
  ok("validateBrandKit tolak outlineWidth di luar rentang", bkm.validateBrandKit({ outlineWidth: 999 }).ok === false);
  ok("validateBrandKit tolak path font mentah", bkm.validateBrandKit({ headingFont: "/usr/share/fonts/x.ttf" }).ok === false);
  ok("validateBrandKit null -> ok (reset)", bkm.validateBrandKit(null).ok === true);
  const rbk = bkm.resolveBrandKit(JSON.stringify({ subtitleFont: "bebasneue", subtitleColor: "#00FF00", headingFont: "anton" }));
  ok("resolveBrandKit set font subtitle + heading file", rbk?.subtitleDesign.font === "Bebas Neue" && rbk?.subtitleDesign.color === "#00FF00" && rbk?.headingFontFile.endsWith("Anton-Regular.ttf"));
  ok("resolveBrandKit null => null (default)", bkm.resolveBrandKit(null) === null && bkm.resolveBrandKit("") === null);
  ok("resolveBrandKit font asing di DB -> usedFallback (tak senyap)", (bkm.resolveBrandKit(JSON.stringify({ subtitleFont: "nope" }))?.usedFallbacks.length ?? 0) > 0);

  // bold flag di Style ASS: brand kit explicit vs default
  const assBoldOff = sd.buildWordHighlightAss(words, { ...sd.DEFAULT_SUBTITLE_DESIGN, bold: false }, 1080, 1920);
  ok("SubtitleDesign bold:false -> Style Bold 0", assBoldOff.includes(",&H00000000,0,0,0,0,100,100,"));
  ok("SubtitleDesign default (undefined) -> Style Bold -1 (lama)", ass.includes(",&H00000000,-1,0,0,0,100,100,"));

  // ---------- Fase 3: Motion Library - Animated Title (2026-10-26) ----------
  const mp = await import("../src/lib/render/motionPresets.ts");
  ok("TITLE_ANIMATIONS FadePop (default) = \\fad+pop 60->100", mp.TITLE_ANIMATIONS.FadePop({ an: 5 }).includes("\\an5\\fad(300,300)\\fscx60"));
  ok("TITLE_ANIMATIONS ZoomIn = skala 35", mp.TITLE_ANIMATIONS.ZoomIn({ an: 5 }).includes("\\fscx35"));
  ok("TITLE_ANIMATIONS PopBounce = 2x \\t (overshoot)", (mp.TITLE_ANIMATIONS.PopBounce({ an: 5 }).match(/\\t\(/g) ?? []).length === 2);
  ok("titleAlignment top/middle/bottom = 8/5/2", mp.titleAlignment("top-center") === 8 && mp.titleAlignment("middle-center") === 5 && mp.titleAlignment("bottom-center") === 2);
  ok("resolveTitleAnimation invalid -> FadePop + fallback", mp.resolveTitleAnimation("ngawur").animation === "FadePop" && mp.resolveTitleAnimation("ngawur").usedFallback === true);
  ok("isTitleAnimation tolak sembarang", !mp.isTitleAnimation("../x") && mp.isTitleAnimation("ZoomIn"));

  // (tc = titleCard sudah di-import di blok tes Fase 1 di atas - reuse)
  ok("buildTitleCardAss default = FadePop (fscx60)", tc.buildTitleCardAss("Halo", tc.DEFAULT_TITLE_CARD_DESIGN, 1080, 1920).includes("\\fscx60"));
  ok("buildTitleCardAss animation=ZoomIn", tc.buildTitleCardAss("Halo", { ...tc.DEFAULT_TITLE_CARD_DESIGN, animation: "ZoomIn" }, 1080, 1920).includes("\\fscx35"));
  ok("buildTitleCardAss position top-center -> alignment 8 di Style", tc.buildTitleCardAss("Halo", tc.DEFAULT_TITLE_CARD_DESIGN, 1080, 1920, { position: "top-center" }).includes(",1,6,0,8,40,40,"));

  ok("validateBrandKit title valid", bkm.validateBrandKit({ title: { enabled: true, preset: "ZoomIn", position: "top-center", durationSeconds: 3 } }).ok === true);
  ok("validateBrandKit title.preset asing ditolak", bkm.validateBrandKit({ title: { preset: "Explode" } }).ok === false);
  ok("validateBrandKit title.position asing ditolak", bkm.validateBrandKit({ title: { position: "corner" } }).ok === false);
  ok("validateBrandKit title.durationSeconds di luar rentang ditolak", bkm.validateBrandKit({ title: { durationSeconds: 99 } }).ok === false);
  ok("validateBrandKit title.enabled non-bool ditolak", bkm.validateBrandKit({ title: { enabled: "ya" } }).ok === false);

  const rtk = bkm.resolveBrandKit(JSON.stringify({ title: { enabled: true, preset: "PopBounce", position: "bottom-center", durationSeconds: 4 } }));
  ok("resolveBrandKit title enabled -> titleEnabled true + preset + posisi", rtk?.titleEnabled === true && rtk?.titleCardDesign.animation === "PopBounce" && rtk?.titlePosition === "bottom-center" && rtk?.titleDurationSeconds === 4);
  ok("resolveBrandKit tanpa title -> titleEnabled FALSE (default-off, backward-compat)", bkm.resolveBrandKit(JSON.stringify({ subtitleFont: "anton" }))?.titleEnabled === false);

  // ---------- Fase 3: Lower Third warna aksen brand (2026-10-26) ----------
  const lt = await import("../src/lib/render/lowerThird.ts");
  ok("lowerThird default = bar putih (backward-compat)", lt.buildLowerThirdFilter("Nama", "tagline", 1080, 1920).includes("color=white@0.9"));
  ok("lowerThird accent brand #RRGGBB -> 0xRRGGBB", lt.buildLowerThirdFilter("Nama", "tagline", 1080, 1920, undefined, "#FFD84D").includes("color=0xFFD84D@0.9"));
  ok("lowerThird accent invalid -> fallback putih (anti-injeksi)", lt.buildLowerThirdFilter("Nama", "tagline", 1080, 1920, undefined, "red;drawbox").includes("color=white@0.9"));
  ok("resolveBrandKit expose lowerThirdAccentColor dari primaryColor", bkm.resolveBrandKit(JSON.stringify({ primaryColor: "#112233" }))?.lowerThirdAccentColor === "#112233");

  // ---------- Fase 3: CTA warna box brand (2026-10-26) ----------
  const sb = await import("../src/lib/render/subscribeButton.ts");
  const ctaDefault = sb.buildSubscribeButtonFilterStages(1, "Subscribe", 1080, 1920, 30, "v", "out").join("|");
  ok("CTA default = box merah #CC1F1F (backward-compat)", ctaDefault.includes("color=#CC1F1F@0.85"));
  const ctaBrand = sb.buildSubscribeButtonFilterStages(1, "Follow", 1080, 1920, 30, "v", "out", undefined, undefined, "#1DA1F2").join("|");
  ok("CTA warna brand #1DA1F2 dipakai", ctaBrand.includes("color=#1DA1F2@0.85"));
  const ctaBad = sb.buildSubscribeButtonFilterStages(1, "Follow", 1080, 1920, 30, "v", "out", undefined, undefined, "x;drawbox").join("|");
  ok("CTA warna invalid -> fallback merah (anti-injeksi)", ctaBad.includes("color=#CC1F1F@0.85"));
  ok("validateBrandKit ctaColor hex valid", bkm.validateBrandKit({ ctaColor: "#1DA1F2" }).ok === true && bkm.validateBrandKit({ ctaColor: "biru" }).ok === false);
  ok("resolveBrandKit expose ctaButtonColor", bkm.resolveBrandKit(JSON.stringify({ ctaColor: "#1DA1F2" }))?.ctaButtonColor === "#1DA1F2");

  // ---------- Fase 3D: Transitions per Brand (2026-10-27) ----------
  const tr = await import("../src/lib/render/transitions.ts");
  ok("brandTransitionType fade->fade, dissolve->dissolve, wipe->wipeleft", tr.brandTransitionType("fade") === "fade" && tr.brandTransitionType("dissolve") === "dissolve" && tr.brandTransitionType("wipe") === "wipeleft");
  ok("brandTransitionType auto->null (tak override = perilaku lama)", tr.brandTransitionType("auto") === null && tr.brandTransitionType("ngawur") === null);
  ok("isBrandTransitionStyle tolak sembarang", !tr.isBrandTransitionStyle("xfade=0") && tr.isBrandTransitionStyle("dissolve"));
  ok("dissolve/wipeleft TIDAK di ALL_TRANSITION_TYPES (fallback Director tak berubah)", !tr.ALL_TRANSITION_TYPES.includes("dissolve") && !tr.ALL_TRANSITION_TYPES.includes("wipeleft") && tr.ALL_TRANSITION_TYPES.length === 10);
  ok("override jaga panjang array (durasi sama)", [..."abc"].map(() => tr.brandTransitionType("dissolve")).length === 3);
  ok("validateBrandKit transition.style valid", bkm.validateBrandKit({ transition: { style: "dissolve" } }).ok === true);
  ok("validateBrandKit transition.style asing ditolak (anti filter mentah)", bkm.validateBrandKit({ transition: { style: "xfade=custom" } }).ok === false);
  ok("resolveBrandKit transitionStyle di-set", bkm.resolveBrandKit(JSON.stringify({ transition: { style: "wipe" } }))?.transitionStyle === "wipe");
  ok("resolveBrandKit tanpa transition -> auto (default lama)", bkm.resolveBrandKit(JSON.stringify({ subtitleFont: "anton" }))?.transitionStyle === "auto");

  // ---------- Fase 3E: Kinetic Typography (2026-10-27) ----------
  const kt = await import("../src/lib/render/kineticText.ts");
  const kmp = await import("../src/lib/render/motionPresets.ts");
  const kd = (p: string) => ({ ...kt.DEFAULT_KINETIC_DESIGN, preset: p as never });
  ok("kinetic FadeIn -> \\fad", kt.buildKineticTextAss("Promo Spesial", kd("FadeIn"), 1080, 1920).includes("\\fad(300,300)"));
  ok("kinetic Pop -> scale 55", kt.buildKineticTextAss("Promo Spesial", kd("Pop"), 1080, 1920).includes("\\fscx55"));
  ok("kinetic SlideUp -> \\move", kt.buildKineticTextAss("Promo Spesial", kd("SlideUp"), 1080, 1920).includes("\\move("));
  ok("kinetic WordByWord -> banyak \\alpha (reveal bertahap)", (kt.buildKineticTextAss("satu dua tiga", kd("WordByWord"), 1080, 1920).match(/\\alpha&HFF&/g) ?? []).length === 3);
  ok("kinetic HighlightKeyword -> warna highlight pada kata terpanjang", kt.buildKineticTextAss("beli sekarang", kd("HighlightKeyword"), 1080, 1920).includes("{\\c&H"));
  ok("kinetic SANITASI injeksi ({ } \\ newline dibuang)", (() => { const a = kt.buildKineticTextAss("Hack {\\an1}evil", kd("FadeIn"), 1080, 1920); return a.includes("Hack an1 evil") && !a.includes("{\\an1}evil"); })());
  ok("kinetic durasi di-clamp 1-6", (() => { const a = kt.buildKineticTextAss("x", { ...kt.DEFAULT_KINETIC_DESIGN }, 1080, 1920, { durationSeconds: 99, startSeconds: 0 }); return a.includes("0:00:00.00,0:00:06.00"); })());
  ok("kinetic teks kosong -> tanpa Dialogue (no-op aman)", !kt.buildKineticTextAss("   ", kt.DEFAULT_KINETIC_DESIGN, 1080, 1920).includes("Dialogue:"));
  ok("kinetic 1 Dialogue saja (tak ubah durasi/audio)", (kt.buildKineticTextAss("satu dua", kt.DEFAULT_KINETIC_DESIGN, 1080, 1920).match(/Dialogue:/g) ?? []).length === 1);
  ok("motionPresets resolveKineticPreset invalid -> FadeIn + fallback", kmp.resolveKineticPreset("ledakan").preset === "FadeIn" && kmp.resolveKineticPreset("ledakan").usedFallback === true);
  ok("isKineticPreset tolak sembarang", !kmp.isKineticPreset("drawtext") && kmp.isKineticPreset("WordByWord"));
  // Validasi brandKit + resolve
  ok("validateBrandKit kinetic valid", bkm.validateBrandKit({ kineticTypography: { enabled: true, preset: "WordByWord", position: "middle-center", durationSeconds: 3, primaryColor: "#FFFFFF", highlightColor: "#FF0000" } }).ok === true);
  ok("validateBrandKit kinetic preset asing ditolak", bkm.validateBrandKit({ kineticTypography: { preset: "Explode" } }).ok === false);
  ok("validateBrandKit kinetic warna invalid ditolak", bkm.validateBrandKit({ kineticTypography: { primaryColor: "biru" } }).ok === false);
  ok("validateBrandKit kinetic durasi di luar rentang ditolak", bkm.validateBrandKit({ kineticTypography: { durationSeconds: 99 } }).ok === false);
  const rk = bkm.resolveBrandKit(JSON.stringify({ headingFont: "anton", kineticTypography: { enabled: true, preset: "Pop", position: "top-center", primaryColor: "#00FF00" } }));
  ok("resolveBrandKit kinetic enabled + design", rk?.kineticEnabled === true && rk?.kineticDesign.preset === "Pop" && rk?.kineticDesign.font === "Anton" && rk?.kineticDesign.color === "#00FF00" && rk?.kineticPosition === "top-center");
  ok("resolveBrandKit tanpa kinetic -> disabled (default-off, backward-compat)", bkm.resolveBrandKit(JSON.stringify({ subtitleFont: "anton" }))?.kineticEnabled === false);
  // Kompatibilitas fitur lain tetap ada di resolve yg sama (title/lowerThird/cta/transitions)
  const rall = bkm.resolveBrandKit(JSON.stringify({ title: { enabled: true }, ctaColor: "#1DA1F2", primaryColor: "#112233", transition: { style: "dissolve" }, kineticTypography: { enabled: true } }));
  ok("kinetic + Animated Title + CTA + LowerThird + Transitions ko-eksis", rall?.titleEnabled === true && rall?.ctaButtonColor === "#1DA1F2" && rall?.lowerThirdAccentColor === "#112233" && rall?.transitionStyle === "dissolve" && rall?.kineticEnabled === true);

  // ---------- Fase 3F: Background Animation (2026-10-27) ----------
  const bg = await import("../src/lib/render/bgAnimation.ts");
  const bgd = (p: string, extra = {}) => ({ ...bg.DEFAULT_BG_DESIGN, preset: p as never, ...extra });
  ok("bg None -> 0 stage (no-op, perilaku lama)", bg.buildBackgroundStages(bgd("None"), 1080, 1920, 30, "0:v", "o").length === 0);
  ok("bg Ambient -> 1 stage hue (1 filter ringan)", (() => { const s = bg.buildBackgroundStages(bgd("Ambient"), 1080, 1920, 30, "0:v", "o"); return s.length === 1 && s[0].includes("hue=h=") && s[0].includes("[o]"); })());
  ok("bg Gradient -> 2 stage (gradients source + overlay, tanpa -i)", (() => { const s = bg.buildBackgroundStages(bgd("Gradient", { primaryColor: "#FF0000", secondaryColor: "#00FF00" }), 1080, 1920, 30, "0:v", "o"); return s.length === 2 && s[0].startsWith("gradients=") && s[0].includes("c0=0xFF0000") && s[0].includes("c1=0x00FF00") && s[1].includes("overlay=0:0"); })());
  ok("bg Gradient d = ceil(durasi+1) tutup penuh", bg.buildBackgroundStages(bgd("Gradient"), 1080, 1920, 42.3, "0:v", "o")[0].includes("d=44"));
  ok("bg warna invalid di design -> fallback (anti-injeksi filter)", bg.buildBackgroundStages(bgd("Gradient", { primaryColor: "evil;drawbox" }), 1080, 1920, 30, "0:v", "o")[0].includes("c0=0x14213D"));
  ok("bg intensity di-clamp (tak meledak)", (() => { const s = bg.buildBackgroundStages(bgd("Gradient", { intensity: 9999 }), 1080, 1920, 30, "0:v", "o"); const m = s[0].match(/aa=([0-9.]+)/); return !!m && Number(m[1]) <= 0.4; })());

  ok("bg resolveBgAnimation invalid -> None + fallback", kmp.resolveBgAnimation("boom").preset === "None" && kmp.resolveBgAnimation("boom").usedFallback === true && kmp.isBgAnimation("Gradient"));
  ok("validateBrandKit bg valid", bkm.validateBrandKit({ backgroundAnimation: { enabled: true, preset: "Gradient", durationSeconds: 8, intensity: 60, primaryColor: "#112233", secondaryColor: "#445566" } }).ok === true);
  ok("validateBrandKit bg preset asing ditolak", bkm.validateBrandKit({ backgroundAnimation: { preset: "Fireworks" } }).ok === false);
  ok("validateBrandKit bg warna/intensity/durasi invalid ditolak", bkm.validateBrandKit({ backgroundAnimation: { primaryColor: "x" } }).ok === false && bkm.validateBrandKit({ backgroundAnimation: { intensity: 999 } }).ok === false && bkm.validateBrandKit({ backgroundAnimation: { durationSeconds: 99 } }).ok === false);
  const rb = bkm.resolveBrandKit(JSON.stringify({ primaryColor: "#101010", secondaryColor: "#202020", backgroundAnimation: { enabled: true, preset: "Ambient", intensity: 70 } }));
  ok("resolveBrandKit bg enabled + warna fallback ke brand", rb?.bgEnabled === true && rb?.bgDesign.preset === "Ambient" && rb?.bgDesign.primaryColor === "#101010" && rb?.bgDesign.secondaryColor === "#202020" && rb?.bgDesign.intensity === 70);
  ok("resolveBrandKit tanpa bg -> disabled (default-off, backward-compat)", bkm.resolveBrandKit(JSON.stringify({ subtitleFont: "anton" }))?.bgEnabled === false);
  const rfull = bkm.resolveBrandKit(JSON.stringify({ title: { enabled: true }, ctaColor: "#1DA1F2", primaryColor: "#112233", transition: { style: "dissolve" }, kineticTypography: { enabled: true }, backgroundAnimation: { enabled: true, preset: "Gradient" } }));
  ok("bg ko-eksis dgn Title+CTA+LowerThird+Transitions+Kinetic", rfull?.titleEnabled === true && rfull?.ctaButtonColor === "#1DA1F2" && rfull?.transitionStyle === "dissolve" && rfull?.kineticEnabled === true && rfull?.bgEnabled === true);

  // ---------- Fase 4: Scene Manifest JSON (2026-10-27) ----------
  const sm = await import("../src/lib/render/sceneManifest.ts");
  const validManifest = {
    version: 1, orientation: "portrait",
    scenes: [
      { id: "s0", footage: { kind: "segment", sourceUrl: "https://x/a.mp4", start: 0, end: 3 }, motion: "zoom-in", transitionAfter: "fade" },
      { id: "s1", footage: { kind: "segment", sourceUrl: "https://x/b.mp4", start: 1, end: 4 }, motion: "pan-left", transitionAfter: "dissolve" },
      { id: "s2", footage: { kind: "broll", videoUrl: "https://x/c.mp4", durationSeconds: 2 } },
    ],
    overlays: { titleText: "Hook", ctaText: "Follow", lowerThird: { name: "Toko A", tagline: "UMKM" } },
    audio: { musicUrl: "https://x/m.mp3", hasVoiceover: true }, subtitlePresent: true,
  };
  ok("manifest valid diterima", sm.validateSceneManifest(validManifest).ok === true);
  ok("manifest version salah ditolak", sm.validateSceneManifest({ ...validManifest, version: 2 }).ok === false);
  ok("manifest orientation asing ditolak", sm.validateSceneManifest({ ...validManifest, orientation: "diagonal" }).ok === false);
  ok("manifest scenes kosong ditolak", sm.validateSceneManifest({ ...validManifest, scenes: [] }).ok === false);
  ok("manifest footage sourceUrl kosong ditolak (aset tak ada)", sm.validateSceneManifest({ version: 1, orientation: "portrait", scenes: [{ id: "x", footage: { kind: "segment", sourceUrl: "", start: 0, end: 1 } }] }).ok === false);
  ok("manifest start>=end ditolak", sm.validateSceneManifest({ version: 1, orientation: "portrait", scenes: [{ id: "x", footage: { kind: "segment", sourceUrl: "u", start: 2, end: 2 } }] }).ok === false);
  ok("manifest motion/transisi asing ditolak", sm.validateSceneManifest({ version: 1, orientation: "portrait", scenes: [{ id: "x", footage: { kind: "segment", sourceUrl: "u", start: 0, end: 1 }, motion: "teleport" }] }).ok === false);
  ok("manifest sourceUrl non-string (anti-injeksi) ditolak", sm.validateSceneManifest({ version: 1, orientation: "portrait", scenes: [{ id: "x", footage: { kind: "segment", sourceUrl: { evil: 1 }, start: 0, end: 1 } }] }).ok === false);
  ok("resolveSceneManifest null/invalid -> null (backward-compat proyek lama)", sm.resolveSceneManifest(null) === null && sm.resolveSceneManifest("{bukan json") === null && sm.resolveSceneManifest(JSON.stringify({ version: 9 })) === null);

  const vmRes = sm.validateSceneManifest(validManifest);
  if (!vmRes.ok) throw new Error("validManifest seharusnya valid");
  const manifest = vmRes.value;
  const compiled = sm.compileManifestToRenderInputs(manifest);
  ok("compile: 2 segment + 1 broll", compiled.segments.length === 2 && compiled.brollClips.length === 1);
  ok("compile: transitions N-1 (3 klip -> 2)", compiled.transitions.length === 2 && compiled.transitions[0] === "fade");
  ok("compile: motions per klip urutan allClips (seg dulu lalu broll)", compiled.motions.length === 3 && compiled.motions[0] === "zoom-in" && compiled.motions[2] === "static");
  ok("compile: overlay + music diteruskan", compiled.titleText === "Hook" && compiled.ctaText === "Follow" && compiled.musicUrl === "https://x/m.mp3");
  ok("estimasi durasi (3+3+2 - 2x0.5 overlap = 7)", sm.estimateManifestDurationSeconds(manifest) === 7);

  // roundtrip build->compile konsisten
  const built = sm.buildManifestFromRenderInputs({ segments: [{ sourceUrl: "u1", start: 0, end: 2 }, { sourceUrl: "u2", start: 0, end: 3 }], brollClips: [{ videoUrl: "b1", durationSeconds: 1 }], motions: ["zoom-in", "static", "pan-right"], transitions: ["slideleft", "fade"], orientation: "portrait" });
  ok("build->validate valid", sm.validateSceneManifest(built).ok === true);
  const rc = sm.compileManifestToRenderInputs(built);
  ok("roundtrip build->compile konsisten", rc.segments.length === 2 && rc.brollClips.length === 1 && rc.motions.join() === "zoom-in,static,pan-right" && rc.transitions.length === 2);

  // ---------- Fase 4 WIRING + persistence (2026-10-28) ----------
  // Reorder scene -> compile ikut urutan baru (bukti editor bisa mengubah urutan visual).
  const reordered = { ...validManifest, scenes: [validManifest.scenes[1], validManifest.scenes[0], validManifest.scenes[2]] };
  const rr = sm.validateSceneManifest(reordered);
  if (!rr.ok) throw new Error("reordered seharusnya valid");
  const rrc = sm.compileManifestToRenderInputs(rr.value);
  ok("reorder scene: segment urutan ikut manifest", rrc.segments[0].sourceUrl === "https://x/b.mp4" && rrc.segments[1].sourceUrl === "https://x/a.mp4");
  ok("reorder scene: motion ikut urutan baru", rrc.motions[0] === "pan-left" && rrc.motions[1] === "zoom-in");

  // Pembaca DEFENSIF kolom (batas adapter aman). DB in-memory, TANPA boot pipeline.
  const store = await import("../src/lib/render/sceneManifestStore.ts");
  const Database = (await import("better-sqlite3")).default;

  // (a) Kolom BELUM ada (= DB prod belum migrasi) -> null, TAK throw -> flow render lama.
  const dbNoCol = new Database(":memory:");
  dbNoCol.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, brand_id TEXT)");
  dbNoCol.prepare("INSERT INTO projects (id, brand_id) VALUES (?, ?)").run("p1", "b1");
  ok("defensif: kolom scene_manifest belum ada -> null (aman, tak crash)", store.readSceneManifestColumn(dbNoCol, "p1") === null);

  // (b) Kolom ADA. NULL baris = proyek lama -> null -> flow lama. JSON valid -> dikembalikan.
  const dbCol = new Database(":memory:");
  dbCol.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, brand_id TEXT, scene_manifest TEXT)");
  const ins = dbCol.prepare("INSERT INTO projects (id, brand_id, scene_manifest) VALUES (?, ?, ?)");
  ins.run("old", "bA", null);                                   // proyek lama: NULL
  ins.run("valid", "bA", JSON.stringify(validManifest));        // tenant A
  ins.run("broken", "bA", "{bukan json");                       // manifest korup
  ins.run("other", "bB", JSON.stringify({ ...validManifest, orientation: "landscape" })); // tenant B
  ok("persistence: proyek lama (NULL) -> null (fallback flow lama)", store.readSceneManifestColumn(dbCol, "old") === null);
  ok("persistence: baca-balik manifest valid = JSON tersimpan", store.readSceneManifestColumn(dbCol, "valid") === JSON.stringify(validManifest));
  ok("persistence: manifest korup tersimpan -> resolve null (tak rusak proyek)", sm.resolveSceneManifest(store.readSceneManifestColumn(dbCol, "broken")) === null);
  ok("persistence: roundtrip simpan->baca->resolve->compile", (() => {
    const back = sm.resolveSceneManifest(store.readSceneManifestColumn(dbCol, "valid"));
    return back !== null && sm.compileManifestToRenderInputs(back).segments.length === 2;
  })());
  // Isolasi tenant: query scoped WHERE id=? -> manifest tenant B TIDAK bocor ke id tenant A.
  const aBack = sm.resolveSceneManifest(store.readSceneManifestColumn(dbCol, "valid"));
  ok("isolasi tenant: id A -> manifest A (orientation portrait), bukan B", aBack !== null && aBack.orientation === "portrait");
  ok("isolasi tenant: id tak dikenal -> null", store.readSceneManifestColumn(dbCol, "tidak-ada") === null);
  dbNoCol.close(); dbCol.close();

  // ---------- Fase 4 API persistence: save/read + validasi + isolasi tenant (2026-10-28) ----------
  // DB percobaan mereplikasi skema+gate getOwnedProject (projects JOIN brands ON brand_id,
  // filter projects.id=? AND brands.user_id=?) utk membuktikan: tenant lain TIDAK bisa
  // tulis/baca manifest proyek orang. writeSceneManifestColumn hanya dipanggil SETELAH gate lolos.
  const apiDb = new Database(":memory:");
  apiDb.exec(`CREATE TABLE brands (id TEXT PRIMARY KEY, user_id TEXT);
              CREATE TABLE projects (id TEXT PRIMARY KEY, brand_id TEXT, scene_manifest TEXT);`);
  apiDb.prepare("INSERT INTO brands (id,user_id) VALUES ('brandA','userA'),('brandB','userB')").run();
  apiDb.prepare("INSERT INTO projects (id,brand_id,scene_manifest) VALUES ('projA','brandA',NULL),('projB','brandB',NULL)").run();
  // Gate = SQL yg SAMA dgn getOwnedProject (session.ts).
  const owns = (userId: string, projectId: string): boolean =>
    !!apiDb.prepare("SELECT p.id FROM projects p JOIN brands b ON p.brand_id=b.id WHERE p.id=? AND b.user_id=?").get(projectId, userId);
  // Simulasi handler PATCH: gate -> validasi -> tulis. Return status.
  const patchManifest = (userId: string, projectId: string, input: unknown): number => {
    if (!owns(userId, projectId)) return 404;                    // isolasi tenant
    if (input !== null) {
      const res = sm.validateSceneManifest(input);
      if (!res.ok) return 400;                                   // invalid -> tak ditulis
      store.writeSceneManifestColumn(apiDb, projectId, JSON.stringify(res.value));
      return 200;
    }
    store.writeSceneManifestColumn(apiDb, projectId, null);       // null = reset
    return 200;
  };

  ok("API: owner (userA) simpan manifest ke projA -> 200", patchManifest("userA", "projA", validManifest) === 200);
  ok("API: read-back projA = manifest tersimpan (roundtrip)", (() => {
    const back = sm.resolveSceneManifest(store.readSceneManifestColumn(apiDb, "projA"));
    return back !== null && back.scenes.length === 3 && back.orientation === "portrait";
  })());
  ok("API: tenant lain (userB) simpan ke projA -> 404 (isolasi tenant)", patchManifest("userB", "projA", validManifest) === 404);
  ok("API: projA TIDAK berubah oleh percobaan userB (masih manifest userA)", (() => {
    const back = sm.resolveSceneManifest(store.readSceneManifestColumn(apiDb, "projA"));
    return back !== null && back.scenes.length === 3;
  })());
  ok("API: userA baca projB -> 404 (tak bisa intip tenant lain)", !owns("userA", "projB"));
  ok("API: manifest invalid -> 400 & data lama utuh", (() => {
    const before = store.readSceneManifestColumn(apiDb, "projA");
    const status = patchManifest("userA", "projA", { version: 1, orientation: "portrait", scenes: [] }); // scenes kosong = invalid
    const after = store.readSceneManifestColumn(apiDb, "projA");
    return status === 400 && before === after;
  })());
  ok("API: null -> reset ke flow lama (resolve null)", patchManifest("userA", "projA", null) === 200 && store.readSceneManifestColumn(apiDb, "projA") === null && sm.resolveSceneManifest(store.readSceneManifestColumn(apiDb, "projA")) === null);
  // End-to-end logis: save -> read -> resolve -> compile -> render inputs lengkap (renderable).
  ok("API: e2e save->read->resolve->compile render inputs lengkap", (() => {
    patchManifest("userA", "projA", validManifest);
    const back = sm.resolveSceneManifest(store.readSceneManifestColumn(apiDb, "projA"));
    if (!back) return false;
    const ci = sm.compileManifestToRenderInputs(back);
    return ci.segments.length === 2 && ci.brollClips.length === 1 && ci.transitions.length === 2 && ci.orientation === "portrait";
  })());
  apiDb.close();

  // ---------- Fase 5A: seedManifestFromProject (2026-10-28) ----------
  const seedMod = await import("../src/lib/scene/seedManifest.ts");
  // (1) Manifest tersimpan menang -> source "stored", orientasi dari manifest (bukan arg).
  const sStored = seedMod.seedManifestFromProject({ sceneManifest: JSON.stringify(validManifest), clipSelection: null, orientation: "landscape" });
  ok("seed: manifest tersimpan dipakai (source=stored, orientasi dari manifest)", sStored.source === "stored" && sStored.manifest?.orientation === "portrait" && sStored.manifest?.scenes.length === 3);
  // (2) Proyek lama (manifest NULL) + clipSelection valid -> seed, compile lengkap, orientasi brand.
  const clip = JSON.stringify([
    { sourceUrl: "https://x/a.mp4", start: 0, end: 3, score: 9 },
    { sourceUrl: "https://x/b.mp4", start: 1, end: 4, score: 7 },
  ]);
  const sSeed = seedMod.seedManifestFromProject({ sceneManifest: null, clipSelection: clip, orientation: "landscape" });
  ok("seed: proyek lama -> source=seeded + 2 scene + orientasi brand", sSeed.source === "seeded" && sSeed.manifest?.scenes.length === 2 && sSeed.manifest?.orientation === "landscape");
  ok("seed: hasil seed valid & bisa dikompilasi", (() => {
    if (!sSeed.manifest) return false;
    const v = sm.validateSceneManifest(sSeed.manifest);
    if (!v.ok) return false;
    const ci = sm.compileManifestToRenderInputs(sSeed.manifest);
    return ci.segments.length === 2 && ci.segments[0].sourceUrl === "https://x/a.mp4";
  })());
  // (3) Entri cacat dibuang (anti data kotor): start>=end & non-string sourceUrl diabaikan.
  const dirty = JSON.stringify([
    { sourceUrl: "https://x/ok.mp4", start: 0, end: 2 },
    { sourceUrl: "https://x/bad.mp4", start: 5, end: 5 },        // start>=end
    { sourceUrl: 123, start: 0, end: 1 },                         // sourceUrl bukan string
    { start: 0, end: 1 },                                         // tanpa sourceUrl
  ]);
  const sDirty = seedMod.seedManifestFromProject({ sceneManifest: null, clipSelection: dirty, orientation: "portrait" });
  ok("seed: entri clipSelection cacat dibuang (sisa 1 valid)", sDirty.source === "seeded" && sDirty.manifest?.scenes.length === 1);
  // (4) Tak ada manifest & tak ada clip valid -> empty (editor tampilkan state kosong).
  ok("seed: manifest null + clipSelection kosong/invalid -> empty", seedMod.seedManifestFromProject({ sceneManifest: null, clipSelection: null, orientation: "portrait" }).source === "empty" && seedMod.seedManifestFromProject({ sceneManifest: null, clipSelection: "{bukan array}", orientation: "portrait" }).manifest === null);

  // ---------- Fase 5B: manifestReducer (2026-10-28) ----------
  const red = await import("../src/lib/scene/manifestReducer.ts");
  const base = sm.buildManifestFromRenderInputs({
    segments: [{ sourceUrl: "https://x/a.mp4", start: 0, end: 3 }, { sourceUrl: "https://x/b.mp4", start: 0, end: 2 }],
    orientation: "portrait",
    overlays: { titleText: "Hook" },
  });
  const validAfter = (m: unknown) => sm.validateSceneManifest(m).ok;
  // addScene
  const added = red.addScene(base, red.brollFootageFromBank("https://x/c.mp4", 4), "new-1");
  ok("reducer addScene: +1 scene di akhir, valid, overlays dipertahankan", added.scenes.length === 3 && added.scenes[2].id === "new-1" && added.overlays?.titleText === "Hook" && validAfter(added));
  ok("reducer addScene: immutable (base tak berubah)", base.scenes.length === 2);
  // brollFootageFromBank fallback
  ok("reducer brollFootageFromBank: durasi null -> fallback 5s", (() => { const f = red.brollFootageFromBank("u", null); return f.kind === "broll" && f.durationSeconds === 5; })());
  ok("reducer brollFootageFromBank: durasi valid dipakai", (() => { const f = red.brollFootageFromBank("u", 7); return f.kind === "broll" && f.durationSeconds === 7; })());
  // removeScene
  const removed = red.removeScene(base, base.scenes[0].id);
  ok("reducer removeScene: hapus 1, valid", removed.scenes.length === 1 && removed.scenes[0].id === base.scenes[1].id && validAfter(removed));
  ok("reducer removeScene: NO-OP kalau sisa 1 scene (tak pernah kosong)", red.removeScene(removed, removed.scenes[0].id).scenes.length === 1);
  ok("reducer removeScene: id tak ada -> no-op", red.removeScene(base, "xxx").scenes.length === 2);
  // moveScene
  const moved = red.moveScene(base, base.scenes[1].id, "up");
  ok("reducer moveScene up: tukar urutan, valid", moved.scenes[0].id === base.scenes[1].id && moved.scenes[1].id === base.scenes[0].id && validAfter(moved));
  ok("reducer moveScene: di ujung -> no-op", red.moveScene(base, base.scenes[0].id, "up").scenes[0].id === base.scenes[0].id && red.moveScene(base, base.scenes[1].id, "down").scenes[1].id === base.scenes[1].id);
  // setSceneFootage (pertahankan motion)
  const withMotion = { ...base, scenes: base.scenes.map((s, i) => (i === 0 ? { ...s, motion: "zoom-in" as const } : s)) };
  const swapped = red.setSceneFootage(withMotion, withMotion.scenes[0].id, red.brollFootageFromBank("https://x/new.mp4", 6));
  ok("reducer setSceneFootage: footage diganti, motion dipertahankan, valid", swapped.scenes[0].footage.kind === "broll" && swapped.scenes[0].motion === "zoom-in" && validAfter(swapped));

  // ---------- Fase 5C: Clip Properties (trim/durasi) ----------
  ok("5C setSegmentTrim valid -> start/end + manifest valid", (() => {
    const r = red.setSegmentTrim(base, base.scenes[0].id, 1, 2.5);
    if (!r.ok) return false;
    const f = r.manifest.scenes[0].footage;
    return f.kind === "segment" && f.start === 1 && f.end === 2.5 && sm.validateSceneManifest(r.manifest).ok;
  })());
  ok("5C setSegmentTrim end<=start -> error", !red.setSegmentTrim(base, base.scenes[0].id, 2, 2).ok);
  ok("5C setSegmentTrim start negatif -> error", !red.setSegmentTrim(base, base.scenes[0].id, -1, 2).ok);
  ok("5C setSegmentTrim NaN -> error", !red.setSegmentTrim(base, base.scenes[0].id, Number.NaN, 2).ok);
  ok("5C setSegmentTrim pertahankan motion", (() => {
    const wm = { ...base, scenes: base.scenes.map((s, i) => (i === 0 ? { ...s, motion: "pan-left" as const } : s)) };
    const r = red.setSegmentTrim(wm, wm.scenes[0].id, 0, 2);
    return r.ok && r.manifest.scenes[0].motion === "pan-left";
  })());
  ok("5C setBrollDuration valid -> durationSeconds", (() => {
    const r = red.setBrollDuration(added, "new-1", 8);
    if (!r.ok) return false;
    const sc = r.manifest.scenes.find((s) => s.id === "new-1");
    return !!sc && sc.footage.kind === "broll" && sc.footage.durationSeconds === 8;
  })());
  ok("5C setBrollDuration <=0 -> error", !red.setBrollDuration(added, "new-1", 0).ok);
  ok("5C setSegmentTrim pada broll -> error (kind salah)", !red.setSegmentTrim(added, "new-1", 0, 1).ok);
  ok("5C setBrollDuration pada segment -> error (kind salah)", !red.setBrollDuration(base, base.scenes[0].id, 3).ok);

  // ---------- Fase 5D: Motion & Transitions ----------
  const sid = base.scenes[0].id;
  ok("5D setSceneMotion valid -> set + manifest valid + footage utuh", (() => {
    const m = red.setSceneMotion(base, sid, "zoom-in");
    return m.scenes[0].motion === "zoom-in" && m.scenes[0].footage.kind === "segment" && sm.validateSceneManifest(m).ok;
  })());
  ok("5D setSceneMotion static eksplisit valid", red.setSceneMotion(base, sid, "static").scenes[0].motion === "static");
  ok("5D setSceneMotion undefined -> hapus (default static)", (() => {
    const withM = red.setSceneMotion(base, sid, "pan-left");
    return red.setSceneMotion(withM, sid, undefined).scenes[0].motion === undefined;
  })());
  ok("5D setSceneMotion invalid -> no-op", red.setSceneMotion(base, sid, "teleport" as unknown as import("../src/lib/render/cameraMotion.ts").MotionType).scenes[0].motion === base.scenes[0].motion);
  ok("5D setSceneMotion id tak ada -> no-op", red.setSceneMotion(base, "xxx", "zoom-in").scenes[0].motion === base.scenes[0].motion);
  ok("5D setSceneTransition dissolve (valid lengkap) -> set + manifest valid", (() => {
    const m = red.setSceneTransition(base, sid, "dissolve");
    return m.scenes[0].transitionAfter === "dissolve" && sm.validateSceneManifest(m).ok;
  })());
  ok("5D setSceneTransition undefined -> hapus (default fade)", (() => {
    const withT = red.setSceneTransition(base, sid, "dissolve");
    return red.setSceneTransition(withT, sid, undefined).scenes[0].transitionAfter === undefined;
  })());
  ok("5D setSceneTransition invalid -> no-op", red.setSceneTransition(base, sid, "warpspeed" as unknown as import("../src/lib/render/transitions.ts").TransitionType).scenes[0].transitionAfter === base.scenes[0].transitionAfter);

  // ---------- Fase 5E fix: normalisasi manifest stabil (anti false-conflict) ----------
  // validateSceneManifest harus menghasilkan string IDENTIK terlepas dari urutan key input
  // (motion-lalu-transisi vs sebaliknya). Ini dasar perbaikan serverStr = JSON.stringify(v.value)
  // supaya cocok dgn yg server simpan & GET kembalikan -> tak ada konflik palsu.
  ok("5E normalisasi: urutan key motion/transisi tak pengaruhi bentuk tersimpan", (() => {
    const a = { version: 1, orientation: "portrait", scenes: [{ id: "a", footage: { kind: "segment", sourceUrl: "u", start: 0, end: 2 }, motion: "pan-left", transitionAfter: "dissolve" }] };
    const b = { version: 1, orientation: "portrait", scenes: [{ id: "a", footage: { kind: "segment", sourceUrl: "u", start: 0, end: 2 }, transitionAfter: "dissolve", motion: "pan-left" }] };
    const ra = sm.validateSceneManifest(a), rb = sm.validateSceneManifest(b);
    return ra.ok && rb.ok && JSON.stringify(ra.value) === JSON.stringify(rb.value);
  })());

  // ---------- Price Overlay / animasi harga (2026-10-29) ----------
  const po = await import("../src/lib/render/priceOverlay.ts");
  ok("price: 'Rp150.000/malam' -> Rp150.000", po.extractPrice("Intip Pelangi mulai Rp150.000/malam sudah sarapan") === "Rp150.000");
  ok("price: 'Rp 150.000' (spasi) -> Rp150.000", po.extractPrice("harga Rp 150.000 saja") === "Rp150.000");
  ok("price: 'Rp150rb' -> Rp150rb", po.extractPrice("cuma Rp150rb") === "Rp150rb");
  ok("price: tanpa harga -> null", po.extractPrice("penginapan nyaman di Bedugul") === null);
  ok("price: teks kosong/null -> null", po.extractPrice(null) === null && po.extractPrice("") === null);
  const bk = await import("../src/lib/render/brandKit.ts");
  ok("brandKit priceOverlay valid diterima", bk.validateBrandKit({ priceOverlay: { enabled: true, label: "Mulai dari" } }).ok === true);
  ok("brandKit priceOverlay.enabled non-bool ditolak", bk.validateBrandKit({ priceOverlay: { enabled: "ya" } }).ok === false);
  ok("brandKit priceOverlay.label kepanjangan ditolak", bk.validateBrandKit({ priceOverlay: { label: "x".repeat(25) } }).ok === false);
  ok("resolveBrandKit priceOverlay enabled -> flag + label", (() => {
    const r = bk.resolveBrandKit(JSON.stringify({ priceOverlay: { enabled: true, label: "Mulai dari" } }));
    return r?.priceOverlayEnabled === true && r?.priceOverlayLabel === "Mulai dari";
  })());
  ok("resolveBrandKit tanpa priceOverlay -> disabled (default-off)", (() => {
    const r = bk.resolveBrandKit(JSON.stringify({}));
    return r?.priceOverlayEnabled === false;
  })());

  // ---------- Tripay createTransaction gating/signature (2026-10-29) ----------
  // Env kosong di test -> gating HARUS menolak (anti transaksi tanpa kredensial).
  const tp = await import("../src/lib/billing/tripay.ts");
  ok("tripay: tripayCreateReady() false saat kredensial kosong (gating)", tp.tripayCreateReady() === false);
  ok("tripay: transactionSignature deterministik + 64 hex", (() => {
    const a = tp.transactionSignature("bill_1", 150000);
    const b = tp.transactionSignature("bill_1", 150000);
    return a === b && /^[0-9a-f]{64}$/.test(a);
  })());
  ok("tripay: signature beda utk ref/amount beda", tp.transactionSignature("bill_1", 150000) !== tp.transactionSignature("bill_2", 150000) && tp.transactionSignature("bill_1", 150000) !== tp.transactionSignature("bill_1", 160000));
  ok("tripay: createTransaction MELEMPAR saat belum dikonfigurasi (tak buat tx diam2)", await (async () => {
    try { await tp.createTransaction({ merchantOrderId: "x", paymentAmount: 1000, productDetails: "t", email: "a@b.c", returnUrl: "https://x/r" }); return false; }
    catch { return true; }
  })());

  ok("tripay: getPaymentChannels MELEMPAR saat belum dikonfigurasi (gating)", await (async () => {
    try { await tp.getPaymentChannels(100000); return false; } catch { return true; }
  })());

  // ---------- feat/buffer-quota-saver: cache dashboard 24 jam ----------
  const ac = await import("../src/lib/analyticsCache.ts");
  ok("analyticsCache: DASHBOARD_CACHE_MS = 24 jam", ac.DASHBOARD_CACHE_MS === 24 * 60 * 60 * 1000);
  ok("analyticsCache: <=24 jam -> fresh (pakai cache)", ac.isDashboardCacheFresh(Date.now() - 23 * 3600e3) === true);
  ok("analyticsCache: >24 jam -> stale (refetch, data tak hilang)", ac.isDashboardCacheFresh(Date.now() - 25 * 3600e3) === false);
  ok("analyticsCache: belum pernah cache -> fetch", ac.isDashboardCacheFresh(null) === false);

  // ---------- feat/buffer-quota-saver: learning insight MURNI dari DB (fungsi pure, 0 call Buffer) ----------
  const pl = await import("../src/lib/ai/performanceLearning.ts");
  ok("learning: insight kosong saat data <3 (fail-soft)", pl.buildPerformanceInsightBlock([{ pillar: "A", angle: null, performanceViews: 10 }]) === "");
  ok("learning: insight dari data DB (>=3), urut performa", (() => {
    const b = pl.buildPerformanceInsightBlock([
      { pillar: "Promo", angle: null, performanceViews: 300 },
      { pillar: "Edukasi", angle: null, performanceViews: 100 },
      { pillar: "Promo", angle: null, performanceViews: 200 },
    ]);
    return b.includes("PERFORMA KONTEN NYATA") && b.indexOf("Promo") < b.indexOf("Edukasi");
  })());

  // ---------- feat/buffer-quota-saver: sweep reconcile aman (prasyarat sebelum dinyalakan) ----------
  const sw = await import("../src/lib/publish/sweep.ts");
  ok("sweep: default OFF (jalur lama tetap)", sw.sweepEnabled() === false);
  ok("sweep: hanya channel ber-pending yang disapu", JSON.stringify(sw.channelsToSweep([{ channelId: "c1" }, { channelId: "c1" }, { channelId: "c2" }])) === JSON.stringify(["c1", "c2"]));
  ok("sweep: post 'sent' lewat jendela dup -> confirmed", (() => {
    const cfg = { nowMs: 1_000_000, dupWindowMs: 5 * 60_000, stuckMs: 20 * 60_000 };
    const r = sw.reconcileSweep([{ id: "pc1", platformPostId: "P1", text: "t", createdAtMs: cfg.nowMs - 6 * 60_000, dupHandled: false }],
      [{ id: "P1", text: "t", status: "sent" }], new Set(["P1"]), cfg);
    return r.confirmed.length === 1 && r.errored.length === 0 && r.duplicates.length === 0;
  })());
  ok("sweep: post 'error' -> errored (koreksi, bukan diam2 sukses)", (() => {
    const cfg = { nowMs: 1_000_000, dupWindowMs: 5 * 60_000, stuckMs: 20 * 60_000 };
    const r = sw.reconcileSweep([{ id: "pc2", platformPostId: "P2", text: "t", createdAtMs: cfg.nowMs - 60_000, dupHandled: false }],
      [{ id: "P2", text: "t", status: "error" }], new Set(["P2"]), cfg);
    return r.errored.length === 1 && r.confirmed.length === 0;
  })());
  ok("sweep: duplikat (post lain teks sama, bukan milik kita) terdeteksi", (() => {
    const cfg = { nowMs: 1_000_000, dupWindowMs: 5 * 60_000, stuckMs: 20 * 60_000 };
    const r = sw.reconcileSweep([{ id: "pc3", platformPostId: "P3", text: "dup", createdAtMs: cfg.nowMs - 6 * 60_000, dupHandled: false }],
      [{ id: "P3", text: "dup", status: "sent" }, { id: "P9", text: "dup", status: "sent" }], new Set(["P3"]), cfg);
    return r.duplicates.length === 1 && r.duplicates[0].postId === "P9";
  })());

  // ---- competitorAnalysis: saringan aktif + benchmark_profile terbaca (fix/competitor-analysis-inputs) ----
  const ca = await import("../src/lib/ai/competitorAnalysis");
  const CA_PROF = JSON.stringify({
    hookPattern: "Buka dengan janji angka konkret",
    storytellingPattern: "Satu taktik sampai tuntas",
    contentAngle: "Bantu UMKM naikkan omset",
    pacing: "Cepat dan padat",
    ctaPattern: "Ajakan tunggal ke konsultasi",
    visualPattern: "Judul besar tebal di atas frame",
    audiencePattern: "Pemilik usaha kecil Indonesia",
  });
  const caRow = (over: Record<string, unknown>) =>
    ({ id: "c", name: "X", notes: null, role: null, benchmarkProfile: null, benchmarkActive: false, ...over }) as any;

  ok("compAnalysis: pembanding NONAKTIF dibuang walau profilnya kaya", (() => {
    const sel = ca.selectCompetitorsForPrompt([caRow({ name: "Lama", benchmarkActive: false, benchmarkProfile: CA_PROF, notes: "[ANALISIS ASLI - dari konten publik nyata]" })]);
    return sel.length === 0;
  })());

  ok("compAnalysis: aktif + profil (notes pendek) tetap masuk", (() => {
    const sel = ca.selectCompetitorsForPrompt([caRow({ name: "Baru", benchmarkActive: true, benchmarkProfile: CA_PROF, notes: "-" })]);
    return sel.length === 1 && sel[0].name === "Baru";
  })());

  ok("compAnalysis: aktif + hanya notes panjang tetap masuk (brand lama tak rusak)", (() =>
    ca.selectCompetitorsForPrompt([caRow({ name: "NotesOnly", benchmarkActive: true, notes: "posting tiap hari, banyak reels promo" })]).length === 1)());

  ok("compAnalysis: aktif tapi tanpa substansi (notes pendek, tanpa profil) dibuang", (() =>
    ca.selectCompetitorsForPrompt([caRow({ benchmarkActive: true, notes: "-" })]).length === 0)());

  ok("compAnalysis: REGRESI agustap - 6 aktif dari 12 baris, 6 nonaktif tak masuk prompt", (() => {
    const rows = [
      ...["Alex Hormozi", "Justin Welsh", "Neil Patel", "Seth Godin", "Vanessa Lau", "Victoria Wong"].map((n) =>
        caRow({ name: n, benchmarkActive: false, benchmarkProfile: CA_PROF, notes: "[ANALISIS ASLI - via Inspiration Analyzer]" })),
      ...["Dewa Eka Prayoga", "Tjokro Wimantara", "Kevin Christabel", "Leo Givanni", "Belajar AI with Guru", "Bukit Vista"].map((n) =>
        caRow({ name: n, benchmarkActive: true, benchmarkProfile: CA_PROF, notes: "[SEED MANUAL - dari riset web Nov 2026]" })),
    ];
    const sel = ca.selectCompetitorsForPrompt(rows);
    const brief = sel.map(ca.buildCompetitorBrief).join("\n\n");
    return sel.length === 6 && !brief.includes("Alex Hormozi") && !brief.includes("Seth Godin") && brief.includes("Bukit Vista");
  })());

  ok("compAnalysis: brief MEMUAT isi benchmark_profile + role", (() => {
    const b = ca.buildCompetitorBrief(caRow({ name: "Dewa", benchmarkActive: true, role: "kosakata pemilik usaha", benchmarkProfile: CA_PROF }));
    return b.includes("Peran pembanding: kosakata pemilik usaha")
      && b.includes("Pola hook: Buka dengan janji angka konkret")
      && b.includes("Pola CTA: Ajakan tunggal ke konsultasi")
      && b.includes("Profil audiens: Pemilik usaha kecil Indonesia")
      && b.includes("POLA KONTEN TERAMATI");
  })());

  ok("compAnalysis: notes dilabeli ASAL DATA (metadata), bukan pengamatan konten", (() => {
    const b = ca.buildCompetitorBrief(caRow({ name: "Dewa", benchmarkActive: true, benchmarkProfile: CA_PROF, notes: "[SEED MANUAL - dari riset web Nov 2026] @dewa (Instagram)" }));
    return b.indexOf("KETERANGAN ASAL DATA (metadata, BUKAN pengamatan konten)") > b.indexOf("POLA KONTEN TERAMATI")
      && b.includes("[SEED MANUAL");
  })());

  ok("compAnalysis: benchmark_profile JSON rusak -> null, tidak throw", (() =>
    ca.parseBenchmarkProfile("{bukan json") === null
    && ca.parseBenchmarkProfile("[]") === null
    && ca.parseBenchmarkProfile("{}") === null
    && ca.parseBenchmarkProfile(null) === null
    && ca.buildCompetitorBrief(caRow({ benchmarkActive: true, benchmarkProfile: "{rusak", notes: "catatan cukup panjang utk lolos" })).includes("belum ada profil benchmark"))());

  ok("compAnalysis: parse buang field non-string/kosong/tak dikenal", (() => {
    const p = ca.parseBenchmarkProfile(JSON.stringify({ hookPattern: "ok", pacing: "   ", ctaPattern: 5, lain: "abaikan" }));
    return !!p && p.hookPattern === "ok" && p.pacing === undefined && p.ctaPattern === undefined && (p as any).lain === undefined;
  })());

  // ---- brandContext: konteks identitas brand, WAJIB bebas harga/paket/kredit ----
  // (`ca` = modul competitorAnalysis, sudah di-import di blok tes sebelumnya)
  const MK_AGUSTAP = [
    "IDENTITAS BRAND",
    "",
    "Agustap Studio adalah perusahaan pembuat perangkat lunak.",
    "Produknya bernama KontenPilot.",
    "Agustap Studio BUKAN agensi. Pelanggan memakai alatnya sendiri.",
    "",
    "==================================================",
    "PAKET HARGA",
    "==================================================",
    "",
    "STARTER Rp 149.000/bulan - 60 kredit",
    "PRO Rp 299.000/bulan - 120 kredit",
    "AGENCY Rp 550.000/bulan - 180 kredit",
  ].join("\n");
  const TERLARANG = /149|299|550|\bRp\b|kredit|starter|\bpro\b|agency|paket|harga/i;

  ok("brandContext: dibangun dari kolom pendek, manual_knowledge TIDAK dipakai", (() => {
    const ctx = ca.buildBrandContext({
      niche: "Marketing & strategi konten untuk UMKM dan bisnis lokal",
      positioning: "Agustap Studio = akun yang membedah masalah marketing bisnis",
      targetAudience: "UMKM, bisnis lokal, entrepreneur",
      toneOfVoice: "Edukatif & Berbobot",
      contentPillars: JSON.stringify({ pillars: ["Bedah UMKM", "Marketing Mistakes", "Case Study"], targetPercent: {} }),
      manualKnowledge: MK_AGUSTAP,
    });
    return ctx.includes("Niche: Marketing & strategi konten")
      && ctx.includes("Positioning: Agustap Studio =")
      && ctx.includes("Target audiens: UMKM, bisnis lokal")
      && ctx.includes("Tone of voice: Edukatif & Berbobot")
      && ctx.includes("Pilar konten: Bedah UMKM, Marketing Mistakes, Case Study")
      && !ctx.includes("perangkat lunak") // kolom ada -> jalur cadangan TIDAK dipakai
      && ctx.length < 600;
  })());

  ok("brandContext: harga/nama paket/jumlah kredit DIBUANG dari kolom yang tercemar", (() => {
    const ctx = ca.buildBrandContext({
      niche: "Jasa konten",
      positioning: "Paket Starter Rp149.000 per bulan berisi 60 kredit",
      targetAudience: "UMKM yang butuh 120 kredit/bulan",
      toneOfVoice: "Santai",
      contentPillars: JSON.stringify({ pillars: ["Promo Agency 550.000", "Edukasi"] }),
    });
    return !TERLARANG.test(ctx) && ctx.includes("Jasa konten") && ctx.includes("Santai");
  })());

  ok("brandContext: jalur cadangan dipotong TEGAS di IDENTITAS BRAND, tak merembet ke PAKET HARGA", (() => {
    const ctx = ca.buildBrandContext({
      niche: null, positioning: "", targetAudience: null, toneOfVoice: null,
      contentPillars: null, manualKnowledge: MK_AGUSTAP,
    });
    return ctx.includes("perangkat lunak")
      && ctx.includes("BUKAN agensi")
      && !ctx.includes("PAKET HARGA")
      && !TERLARANG.test(ctx);
  })());

  ok("brandContext: harga DI DALAM seksi IDENTITAS BRAND pun tetap dibuang", (() => {
    const ctx = ca.buildBrandContext({
      manualKnowledge: [
        "IDENTITAS BRAND", "",
        "Kami perusahaan software.",
        "Paket Starter Rp149.000 per bulan, 60 kredit.",
        "Kami bukan agensi.", "",
        "==================================================", "PAKET HARGA",
      ].join("\n"),
    });
    return ctx.includes("perusahaan software") && ctx.includes("bukan agensi") && !TERLARANG.test(ctx);
  })());

  ok("extractIdentitySection: berhenti di pemisah; seksi tak ada -> kosong", (() => {
    const sec = ca.extractIdentitySection(MK_AGUSTAP);
    return sec.includes("BUKAN agensi")
      && !sec.includes("PAKET")
      && !sec.includes("149.000")
      && ca.extractIdentitySection("PRODUK UTAMA\nKontenPilot halo") === ""
      && ca.extractIdentitySection(null) === ""
      && ca.extractIdentitySection("==========\nIDENTITAS BRAND\n==========\nKami software.\n==========\nPAKET HARGA") === "Kami software.";
  })());

  ok("brandContext: diplafon 1200 karakter dan tiap baris dipotong", (() => {
    const panjang = "x".repeat(5000);
    const semua = ca.buildBrandContext({
      niche: panjang, positioning: panjang, targetAudience: panjang,
      toneOfVoice: panjang, contentPillars: panjang,
    });
    const satu = ca.buildBrandContext({ niche: panjang });
    return semua.length <= 1200 && semua.includes("Niche: xxx") && satu.length < 260;
  })());

  ok("brandContext: pilar JSON di-parse; objek tanpa pillars diabaikan; brand kosong -> kosong", (() => {
    return ca.buildBrandContext({ contentPillars: JSON.stringify(["Satu", "Dua"]) }) === "Pilar konten: Satu, Dua"
      && ca.buildBrandContext({ contentPillars: JSON.stringify({ targetPercent: {} }) }) === ""
      && ca.buildBrandContext({ contentPillars: "pilar teks bebas" }) === "Pilar konten: pilar teks bebas"
      && ca.buildBrandContext({}) === ""
      && ca.buildBrandContext({ niche: null, manualKnowledge: null }) === "";
  })());

  ok("brandContext TIDAK BOCOR: gemaan brandContext dibuang dari competitorDoing", (() => {
    const bc = "Niche: Marketing untuk UMKM dan bisnis lokal\nTone of voice: Edukatif & Berbobot";
    const kept = ca.stripBrandContextEcho(
      ["Marketing untuk UMKM dan bisnis lokal", "Edukatif & Berbobot dalam membawakan materi", "Pembanding rajin bikin carousel bedah angka"],
      bc
    );
    return kept.length === 1 && kept[0].startsWith("Pembanding rajin");
  })());

  ok("stripBrandContextEcho: item pendek & brandContext kosong tidak mengubah apa pun", (() => {
    const bc = "Niche: Marketing untuk UMKM dan bisnis lokal";
    return ca.stripBrandContextEcho(["UMKM"], bc).length === 1
      && ca.stripBrandContextEcho(["Marketing untuk UMKM dan bisnis lokal"], "").length === 1
      && ca.stripBrandContextEcho(["Marketing untuk UMKM dan bisnis lokal"], null).length === 1;
  })());

  ok("route competitor-analysis BENAR-BENAR meneruskan brandContext (anti lupa-sambung)", (() => {
    const fsRoute = require("node:fs").readFileSync(
      "src/app/api/brands/[id]/competitor-analysis/route.ts", "utf8"
    ) as string;
    return fsRoute.includes("buildBrandContext")
      && /generateCompetitorIntelligence\(\s*brand\.name,\s*comps,\s*ownPerformance,\s*brandContext\s*\)/.test(fsRoute);
  })());
  // ---- 4 cacat video nyata (fix/video-defects-4) ----
  const akk = await import("../src/lib/ai/angkaKeKata");
  ok("cacat1 TTS: Rp350.000 -> kata wajar", akk.angkaKeKata("Rp350.000") === "tiga ratus lima puluh ribu rupiah");
  ok("cacat1 TTS: Rp350,000 (koma ribuan Inggris) TIDAK jadi 'nol nol nol'", (() => {
    const r = akk.angkaKeKata("Rp350,000");
    return r === "tiga ratus lima puluh ribu rupiah" && !/nol/.test(r);
  })());
  ok("cacat1 TTS: 1,250,000 -> juta (bukan desimal)", akk.angkaKeKata("1,250,000") === "satu juta dua ratus lima puluh ribu");
  ok("cacat1 TTS: desimal asli 3,5 tetap 'tiga koma lima'", akk.angkaKeKata("3,5") === "tiga koma lima");
  ok("cacat1 TTS: tak ada digit tersisa", !akk.adaAngkaTersisa(akk.angkaKeKata("Rp350,000 dan 1.000 dan 30%")));

  // ---- bentuk angka yang dulu lolos mentah ke TTS (fix/tts-bentuk-angka, 2026-11-07) ----
  // Bukti nyata: caption laundry TERBIT "cuci komplit Rp7.000/kg" terdengar
  // "Gunang anggar tekanan kilogram" - nilai harganya hilang total.
  ok("bentuk/satuan: Rp7.000/kg -> 'tujuh ribu rupiah per kilogram'",
    akk.angkaKeKata("Rp7.000/kg") === "tujuh ribu rupiah per kilogram");
  ok("bentuk/satuan: spasi di sekitar garis miring tetap kena",
    akk.angkaKeKata("Rp 7.000 / kg") === "tujuh ribu rupiah per kilogram");
  ok("bentuk/satuan: Rp149.000/bulan + 50.000/hari + 25.000/orang",
    akk.angkaKeKata("Rp149.000/bulan") === "seratus empat puluh sembilan ribu rupiah per bulan"
    && akk.angkaKeKata("50.000/hari") === "lima puluh ribu per hari"
    && akk.angkaKeKata("25.000/orang") === "dua puluh lima ribu per orang");
  ok("bentuk/satuan: kalimat caption nyata utuh (harga TIDAK hilang)",
    akk.angkaKeKata("mulai dari cuci komplit Rp7.000/kg hingga layanan express")
      === "mulai dari cuci komplit tujuh ribu rupiah per kilogram hingga layanan express");
  ok("bentuk/satuan: satuan setelah KATA ('Rp1,5 juta/bulan') ikut jadi 'per'",
    akk.angkaKeKata("Rp1,5 juta/bulan") === "satu koma lima juta rupiah per bulan");
  ok("bentuk/satuan: garis miring BUKAN satuan tak disentuh (check-in/out, villa/homestay)", (() => {
    const a = akk.angkaKeKata("Fleksibel check-in/out di villa/homestay");
    return a === "Fleksibel check-in/out di villa/homestay";
  })());
  ok("bentuk/satuan: pecahan & '24/7' (digit di kedua sisi) tidak jadi 'per'",
    !/per/.test(akk.angkaKeKata("1/2")) && !/per/.test(akk.angkaKeKata("24/7")));

  ok("bentuk/emoji: 1\u20e3 2\u20e3 3\u20e3 -> satu dua tiga (tanpa sisa keycap)", (() => {
    const r = akk.angkaKeKata("1\uFE0F\u20e3 2\uFE0F\u20e3 3\uFE0F\u20e3");
    return r === "satu dua tiga" && !/\u20e3|\uFE0F/.test(r);
  })());
  ok("bentuk/emoji: 0\u20e3-9\u20e3 semua jadi kata, tanpa sisa keycap", (() => {
    const src = Array.from({ length: 10 }, (_v, i) => `${i}\uFE0F\u20e3`).join(" ");
    const r = akk.angkaKeKata(src);
    return r === "nol satu dua tiga empat lima enam tujuh delapan sembilan"
      && !/\u20e3/.test(r) && !akk.adaAngkaTersisa(r);
  })());
  ok("bentuk/emoji: keycap nempel kata tetap terpisah ('1\u20e3Cuci')",
    akk.angkaKeKata("1\uFE0F\u20e3Cuci") === "satu Cuci");

  ok("bentuk/rentang: 5-10, 5\u201310 (en), 5\u201410 (em) -> 'lima sampai sepuluh'",
    akk.angkaKeKata("5-10 menit") === "lima sampai sepuluh menit"
    && akk.angkaKeKata("5\u201310 menit") === "lima sampai sepuluh menit"
    && akk.angkaKeKata("5\u201410 menit") === "lima sampai sepuluh menit");
  ok("bentuk/rentang: Rp50.000-Rp100.000 dan 30-50%",
    akk.angkaKeKata("Rp50.000-Rp100.000") === "lima puluh ribu rupiah sampai seratus ribu rupiah"
    && akk.angkaKeKata("30-50%") === "tiga puluh sampai lima puluh persen");
  ok("bentuk/rentang: nomor telepon TIDAK jadi 'sampai' (grup 4 digit diabaikan)",
    !/sampai/.test(akk.angkaKeKata("0851-1934-9960")) && !/sampai/.test(akk.angkaKeKata("2026-2027")));

  ok("bentuk/persen: RE_PERSEN lama tetap jalan",
    akk.angkaKeKata("diskon 30%") === "diskon tiga puluh persen"
    && akk.angkaKeKata("1.500%") === "seribu lima ratus persen");
  ok("bentuk/derajat: 30\u00B0C / 100\u00B0F / 30\u00B0 telanjang",
    akk.angkaKeKata("30\u00B0C") === "tiga puluh derajat celsius"
    && akk.angkaKeKata("100\u00B0F") === "seratus derajat fahrenheit"
    && akk.angkaKeKata("30\u00B0") === "tiga puluh derajat");

  ok("bentuk/jam: 08.00 -> delapan, 08:30 -> delapan tiga puluh",
    akk.angkaKeKata("08.00") === "delapan" && akk.angkaKeKata("08:30") === "delapan tiga puluh");
  ok("bentuk/jam: titik akhir kalimat tak menggagalkan ('pukul 12.00.')",
    akk.angkaKeKata("pukul 12.00.") === "pukul dua belas." );
  ok("bentuk/jam: rentang jam 08.00-22.00 -> 'sampai'",
    akk.angkaKeKata("buka 08.00-22.00") === "buka delapan sampai dua puluh dua");
  // JEBAKAN: titik = pemisah ribuan DAN pemisah jam. Keduanya harus tetap benar.
  ok("bentuk/jam vs ribuan: 1.000 / 1.000.000 / Rp350.000 TIDAK dibaca sebagai jam",
    akk.angkaKeKata("1.000") === "seribu"
    && akk.angkaKeKata("1.000.000") === "satu juta"
    && akk.angkaKeKata("Rp350.000") === "tiga ratus lima puluh ribu rupiah"
    && akk.angkaKeKata("Harga 12.000 saja") === "Harga dua belas ribu saja");
  ok("bentuk/jam: tanggal 7.11.2026 bukan jam", !/belas|puluh satu/.test(akk.angkaKeKata("7.11.2026").split(" ")[1] || ""));

  ok("besaran: Rp1,5 juta / Rp2 juta / Rp150rb (urutan kata benar, tak ada sisa 'rb')",
    akk.angkaKeKata("Rp1,5 juta") === "satu koma lima juta rupiah"
    && akk.angkaKeKata("Rp2 juta") === "dua juta rupiah"
    && akk.angkaKeKata("Rp150rb") === "seratus lima puluh ribu rupiah");
  ok("deret digit panjang (>12) dibaca satu-satu, tak ada digit tersisa", (() => {
    const r = akk.angkaKeKata("1234567890123456");
    return r === "satu dua tiga empat lima enam tujuh delapan sembilan nol satu dua tiga empat lima enam"
      && !akk.adaAngkaTersisa(r);
  })());

  ok("GERBANG QC: semua bentuk baru -> adaAngkaTersisa() false", (() => {
    const kasus = ["Rp7.000/kg", "Rp149.000/bulan", "50.000/hari", "25.000/orang",
      "1\uFE0F\u20e3 2\uFE0F\u20e3 3\uFE0F\u20e3", "5-10", "5\u201310", "5\u201410", "30%", "30\u00B0C",
      "08.00", "08:30", "Rp1,5 juta/bulan", "0851-1934-9960", "1234567890123456",
      "1\uFE0F\u20e3 Cuci Rp7.000/kg\n2\uFE0F\u20e3 Express 3-5 jam, buka 08.00-22.00\n3\uFE0F\u20e3 Antar gratis 30%"];
    return kasus.every((k) => !akk.adaAngkaTersisa(akk.angkaKeKata(k)) && !/\u20e3|\u00B0/.test(akk.angkaKeKata(k)));
  })());

  const hfc = await import("../src/lib/render/hyperframesComposition");
  const bi = { orientation: "portrait" as const, brand: { mark: "laundry in bali" }, hook: "Hook uji",
    audioDurationSeconds: 8, words: [], clips: [{ videoUrl: "u", durationSeconds: 5 }] };
  ok("cacat4: garis aksen atas DEFAULT OFF", (() => {
    const h = hfc.buildComposition(bi);
    return !h.includes('class="bar"') && !h.includes("#bar");
  })());
  ok("cacat4: topBar:true -> opt-in muncul", (() => {
    const h = hfc.buildComposition({ ...bi, topBar: true });
    return h.includes('class="bar"') && h.includes("#bar");
  })());
  ok("cacat3: tanpa logo -> nama dikapitalisasi (bukan huruf kecil mentah)", (() => {
    const h = hfc.buildComposition(bi);
    return h.includes("Laundry in Bali") && !h.includes(">laundry in bali<");
  })());
  ok("cacat3: ada logoUrl -> pakai <img> logo, TANPA tulisan nama", (() => {
    const h = hfc.buildComposition({ ...bi, brand: { mark: "laundry in bali", logoUrl: "https://x/logo.png" } });
    return h.includes('id="brandlogo"') && h.includes("logo.png") && !h.includes('id="mark"');
  })());
  ok("cacat1 layar: kartu stat mulai dari nilai terformat id-ID (bukan '0')", (() => {
    const h = hfc.buildComposition({ ...bi, stats: [{ label: "Harga", value: "Rp350.000" }] });
    return h.includes(">350.000<") && !h.includes('id="num0">0<');
  })());
  ok("cacat1 layar: nilai koma-Inggris 350,000 tetap tampil 350.000", (() => {
    const h = hfc.buildComposition({ ...bi, stats: [{ label: "Harga", value: "Rp350,000" }] });
    return h.includes(">350.000<");
  })());
  ok("cacat3: titleCase tak merusak ALL-CAPS / yg sudah berkapital",
    hfc.titleCase("PELANGI") === "PELANGI" && hfc.titleCase("Pelangi Homestay") === "Pelangi Homestay");
  ok("semua cacat: motion-blur TETAP off (tak ada yg memaksa screenshot)", (() => {
    const h = hfc.buildComposition({ ...bi, topBar: true, brand: { mark: "x", logoUrl: "https://x/l.png" },
      stats: [{ label: "Harga", value: "Rp350,000" }] });
    return h.includes('data-motion-blur="off"') && !h.includes('data-motion-blur="on"');
  })());
  // ---------- Motion Pack 1 (2026-11-06) - 6 motion tone-aware jalur HyperFrames (GSAP) ----------
  const mpk = await import("../src/lib/render/motionPack.ts");
  ok("motionPack: 6 id + semua cost 'cheap' (BeginFrame)", mpk.MOTION_IDS.length === 6 && mpk.MOTION_IDS.every((id) => mpk.MOTION_COST[id] === "cheap"));
  ok("motionPack: resolveMotionTone fallback friendly", mpk.resolveMotionTone("x").tone === "friendly" && mpk.resolveMotionTone("x").usedFallback === true && mpk.resolveMotionTone("playful").usedFallback === false);
  ok("motionPack: disabled/absent -> null (default-off)", mpk.resolveMotionPackConfig(undefined) === null && mpk.resolveMotionPackConfig({ tone: "playful" }) === null && mpk.resolveMotionPackConfig({ enabled: false }) === null);
  ok("motionPack: intensitas low != high (efek nyata)", JSON.stringify(mpk.punchIn({ target: "#b", at: 0, duration: 1, intensity: 0.1 })) !== JSON.stringify(mpk.punchIn({ target: "#b", at: 0, duration: 1, intensity: 0.9 })));
  ok("motionPack: premium vs playful beda (ease/flash)", (() => {
    const p = mpk.resolveMotionPackConfig({ enabled: true, tone: "premium" }), q = mpk.resolveMotionPackConfig({ enabled: true, tone: "playful" });
    return !!p && !!q && p.eases.pop !== q.eases.pop && p.enabled.flash === false && q.enabled.flash === true;
  })());
  ok("motionPack: fragmen tanpa kontrol media (.play/.pause/.seek/.currentTime/playbackRate)", (() => {
    const frag = [...mpk.punchIn({ target: "#b", at: 0, duration: 1, intensity: 1 }), ...mpk.whipPan({ target: "#c", at: 0, intensity: 1 }), ...mpk.flash({ at: 0, intensity: 1 }), ...mpk.countUp({ varName: "o", numId: "n", num: 5, grouped: true, at: 0, intensity: 1 })].join("\n");
    return [".play(", ".pause(", ".seek(", ".currentTime", "playbackRate"].every((f) => !frag.includes(f));
  })());
  ok("motionPack: buildComposition disabled == baseline (byte-identik)", hfc.buildComposition({ orientation: "portrait", hook: "Halo", audioDurationSeconds: 5, words: [{ word: "Halo", start: 0, end: 0.4 }] }) === hfc.buildComposition({ orientation: "portrait", hook: "Halo", audioDurationSeconds: 5, words: [{ word: "Halo", start: 0, end: 0.4 }], motionPack: undefined }));
  ok("motionPack: enabled playful -> HTML beda + flash + motion-blur tetap off + tanpa kontrol media", (() => {
    const inp = { orientation: "portrait" as const, brand: { accent: "#FFD84D", ink: "#FFF" }, hook: "Halo dunia", audioDurationSeconds: 6, clips: [{ videoUrl: "u1", durationSeconds: 5 }, { videoUrl: "u2", durationSeconds: 5 }], words: [{ word: "Halo", start: 0, end: 0.4 }, { word: "dunia", start: 0.5, end: 0.9 }], stats: [{ label: "x", value: "350.000" }], lowerThird: { title: "A", subtitle: "B" } };
    const cfg = mpk.resolveMotionPackConfig({ enabled: true, tone: "playful" })!;
    const html = hfc.buildComposition({ ...inp, motionPack: cfg }), bas = hfc.buildComposition(inp);
    return html !== bas && html.includes('id="flash"') && html.includes('data-motion-blur="off"') && !html.includes('data-motion-blur="on"') && [".play(", ".pause(", ".seek(", ".currentTime", "playbackRate"].every((f) => !html.includes(f));
  })());
  ok("motionPack: validateBrandKit terima config valid, tolak enum/range/bool salah", mpk && bkm.validateBrandKit({ motionPack: { enabled: true, tone: "playful", intensity: 80, motions: { flash: false } } }).ok === true && bkm.validateBrandKit({ motionPack: { tone: "boom" } }).ok === false && bkm.validateBrandKit({ motionPack: { intensity: 999 } }).ok === false && bkm.validateBrandKit({ motionPack: { motions: { punchIn: "x" } } }).ok === false);
  ok("motionPack: resolveBrandKit expose enabled + config (default-off backward-compat)", bkm.resolveBrandKit(JSON.stringify({ motionPack: { enabled: true, tone: "playful" } }))?.motionPackEnabled === true && bkm.resolveBrandKit(JSON.stringify({ subtitleFont: "anton" }))?.motionPackEnabled === false);

  // ---- BAGIAN A (2026-11-07): suara produksi + hitung-naik mata uang ----
  // A3: tes SAMBUNGAN, bukan tes fungsi. Yang meleset 2026-11-06 adalah wiring-nya:
  // angkaKeKata lolos semua tes unit tapi TIDAK PERNAH dipanggil sebelum TTS.
  const srcPP = require("node:fs").readFileSync("src/lib/pipeline/processProject.ts", "utf8") as string;
  ok("A3 SAMBUNGAN: generateVoiceover menerima teks hasil angkaKeKata, bukan teks mentah", (() => {
    const adaDeklarasi = /const narrationTts = angkaKeKata\(narrationText\);/.test(srcPP);
    const ttsPakaiTerkonversi = /generateVoiceover\(narrationTts,/.test(srcPP);
    const takAdaMentah = !/generateVoiceover\(narrationText[,)]/.test(srcPP);
    return adaDeklarasi && ttsPakaiTerkonversi && takAdaMentah;
  })());
  ok("A3 SAMBUNGAN: QC memeriksa variabel YANG SAMA dgn yang diucapkan (satu deklarasi saja)", (() => {
    const deklarasi = (srcPP.match(/const narrationTts\s*=/g) || []).length;
    return deklarasi === 1 && srcPP.includes("adaAngkaTersisa(narrationTts)");
  })());
  ok("A3: teks yang dikirim ke TTS utk caption nyata benar-benar bebas digit", (() => {
    const caption = "Paket langganan mulai Rp350.000 per bulan, antar jemput gratis, selesai dalam 2 hari.";
    const dikirim = akk.angkaKeKata(caption);
    return !akk.adaAngkaTersisa(dikirim) && !/\d/.test(dikirim) && /tiga ratus lima puluh ribu/.test(dikirim);
  })());

  ok("A4: isCurrencyStat kenali uang, abaikan angka biasa", (() =>
    hfc.isCurrencyStat("Rp350.000") && hfc.isCurrencyStat("rp 350000") && hfc.isCurrencyStat("IDR 350.000")
    && hfc.isCurrencyStat("mulai Rp1.200.000 rupiah")
    && !hfc.isCurrencyStat("10.000 pelanggan") && !hfc.isCurrencyStat("3 hari") && !hfc.isCurrencyStat(""))());

  ok("A4: stat UANG -> tanpa tween hitung-naik, nilai akhir langsung tampil (jalur lama)", (() => {
    const h = hfc.buildComposition({ ...bi, stats: [{ label: "Harga Paket", value: "Rp350.000" }] });
    return h.includes(">350.000<") && !/\bo0\b/.test(h) && h.includes('id="statCard0"');
  })());
  ok("A4: stat UANG -> tanpa hitung-naik JUGA saat Motion Pack playful aktif", (() => {
    const cfg = mpk.resolveMotionPackConfig({ enabled: true, tone: "playful" })!;
    const h = hfc.buildComposition({ ...bi, stats: [{ label: "Harga", value: "Rp350.000" }], motionPack: cfg });
    return h.includes(">350.000<") && !/\bo0\b/.test(h);
  })());
  ok("A4: angka NON-uang TETAP dihitung naik (efeknya bagus, jangan dimatikan)", (() => {
    const h = hfc.buildComposition({ ...bi, stats: [{ label: "Pelanggan", value: "10.000 pelanggan" }] });
    const hp = hfc.buildComposition({ ...bi, stats: [{ label: "Pelanggan", value: "10.000 pelanggan" }],
      motionPack: mpk.resolveMotionPackConfig({ enabled: true, tone: "playful" })! });
    return /\bo0\b/.test(h) && /\bo0\b/.test(hp);
  })());

  // ---- caption: kata dari naskah asli, waktu dari Whisper (2026-11-07) ----
  const cw = await import("../src/lib/ai/captionWords");
  const ASLI = "Harganya Starter Rp149.000 per bulan untuk 60 konten.";
  const UCAP = akk.angkaKeKata(ASLI);
  const kataWhisper = cw.tokenisasi(UCAP).map((w, i) => ({ word: w, start: i * 0.4, end: i * 0.4 + 0.35 }));

  ok("caption: token berangka dipulihkan jadi Rp149.000 (bukan 'puluh')", (() => {
    const kata = cw.captionDariTeksAsli(ASLI, UCAP, kataWhisper).map((h) => h.word);
    return kata.includes("Rp149.000") && kata.includes("60")
      && !kata.some((k) => /^(puluh|ratus|ribu|sembilan|empat|seratus|enam)$/i.test(k));
  })());
  ok("caption: waktu digabung dari kata Whisper yang menyusun angka itu", (() => {
    const hasil = cw.captionDariTeksAsli(ASLI, UCAP, kataWhisper);
    const rp = hasil.find((h) => h.word === "Rp149.000")!;
    const i0 = cw.tokenisasi(UCAP).findIndex((w) => /seratus/i.test(w));
    return !!rp && Math.abs(rp.start - i0 * 0.4) < 1e-6 && rp.end > rp.start;
  })());
  ok("caption: urutan kata tetap & tak ada kata tampil hilang di tengah", (() => {
    const hasil = cw.captionDariTeksAsli(ASLI, UCAP, kataWhisper);
    const kata = hasil.map((h) => h.word);
    return kata[0] === "Harganya" && kata[1] === "Starter" && kata[2] === "Rp149.000"
      && hasil.every((h, i) => i === 0 || h.start >= hasil[i - 1].start);
  })());
  ok("caption: teks tanpa angka -> kata Whisper apa adanya", (() => {
    const w = [{ word: "halo", start: 0, end: 1 }, { word: "dunia", start: 1, end: 2 }];
    return cw.captionDariTeksAsli("halo dunia", "halo dunia", w) === w;
  })());
  ok("caption: masukan kosong / penyelarasan gagal -> fail-soft ke Whisper", (() => {
    const w = [{ word: "x", start: 0, end: 1 }];
    return cw.captionDariTeksAsli("", "", w) === w
      && cw.captionDariTeksAsli("Rp1.000", "seribu", []).length === 0
      && cw.captionDariTeksAsli("Rp1.000 a b c d e f", "zzz qqq", w) === w;
  })());
  ok("caption: petakanUcapanKeTampil memetakan kata angka ke satu token", (() => {
    const peta = cw.petakanUcapanKeTampil(["beli", "2", "hari"], ["beli", "dua", "hari"]);
    return peta[0] === 0 && peta[1] === 1 && peta[2] === 2;
  })());
  // ---- prompt VideoPlan (2026-11-07): bentuk datar, field per tipe, target durasi ----
  const vpd = await import("../src/lib/video/videoPlanDirector");
  const vp = await import("../src/lib/video/videoPlan");

  ok("vplan prompt: contoh JSON DATAR + contoh SALAH bersarang disebut eksplisit", (() => {
    const spec = vp.videoPlanPromptSpec();
    return spec.includes('{"type":"hook","hook":{"text":"..."}}')
      && spec.includes('BENAR: {"type":"hook","text":"..."}')
      && spec.includes("JANGAN bungkus isi adegan dalam objek bernama tipe")
      && spec.includes('"type":"feature-list","duration":5');
  })());

  ok("vplan prompt: daftar field DIIZINKAN memuat semua 8 scene type", (() => {
    const spec = vp.videoPlanPromptSpec();
    return vp.SCENE_TYPES.every((t) => spec.includes(`  ${t}`.slice(0, 2 + t.length)))
      && spec.includes("Field lain APA PUN DITOLAK");
  })());

  ok("vplan prompt: batas teks ditulis dgn contoh BENAR dan SALAH", (() => {
    const spec = vp.videoPlanPromptSpec();
    return spec.includes("BENAR \"Cucian menumpuk lagi?\"") && spec.includes("SALAH \"Apakah kamu merasa")
      && spec.includes(`<=${vp.LIMITS.text.hook.chars} karakter`)
      && spec.includes(`<=${vp.LIMITS.text.featureItem.chars} karakter`);
  })());

  ok("vplan prompt: contoh item feature lewat-tipis ada DAN hitungan karakternya jujur", (() => {
    const spec = vp.videoPlanPromptSpec();
    const lim = vp.LIMITS.text.featureItem.chars;
    const re = /GAGAL "([^"]+)" \((\d+)\)\s*-> BENAR "([^"]+)" \((\d+)\)/g;
    let m: RegExpExecArray | null, n = 0, adaTipis = false;
    while ((m = re.exec(spec))) {
      const [, buruk, nBuruk, baik, nBaik] = m;
      // angka di prompt harus = panjang asli, sisi salah harus lewat, sisi benar harus lolos
      if (buruk.length !== Number(nBuruk) || baik.length !== Number(nBaik)) return false;
      if (buruk.length <= lim || baik.length > lim) return false;
      if (buruk.length === lim + 1) adaTipis = true;
      n++;
    }
    return n >= 3 && adaTipis;
  })());

  ok("vplan prompt: batas item diajarkan lewat angka konkret, bukan hanya plafon", (() => {
    const spec = vp.videoPlanPromptSpec();
    const lim = vp.LIMITS.text.featureItem.chars;
    return spec.includes(`${lim + 1} karakter untuk batas ${lim}`) && spec.includes("2-3 kata per item");
  })());

  ok("vplan: rentang yang diiklankan SELALU di dalam jendela validator (hook mana pun)", (() => {
    // Validator: |total - (audio + durasiHook)| <= maks(2, (audio+durasiHook)*0.25).
    // Durasi hook dipilih AI (1.2-4 dtk), jadi rentang kita harus tahan ketiga ujungnya.
    const diterima = (audio: number, hook: number, total: number) => {
      const target = audio + hook;
      return Math.abs(total - target) <= Math.max(2, target * 0.25);
    };
    for (const audio of [8, 12, 20, 45, 90]) {
      const r = vpd.targetTotalDetik(audio);
      if (r.takTercapai) continue;
      for (const hook of [vp.LIMITS.hookSeconds.min, 2.6, vp.LIMITS.hookSeconds.max]) {
        if (!diterima(audio, hook, r.min) || !diterima(audio, hook, r.max)) return false;
      }
      if (r.min >= r.max) return false;
    }
    return vpd.targetTotalDetik(20).takTercapai === false;
  })());

  ok("vplan: durasi sangat pendek -> rentang tetap di dalam LIMITS.totalSeconds", (() => {
    const r = vpd.targetTotalDetik(1);
    return r.min >= vp.LIMITS.totalSeconds.min && r.max <= vp.LIMITS.totalSeconds.max && r.min <= r.max;
  })());

  ok("vplan: long-form ditandai takTercapai (batas kontrak, bukan salah prompt)", (() => {
    const r = vpd.targetTotalDetik(440);
    return r.takTercapai === true && r.max === vp.LIMITS.totalSeconds.max;
  })());

  ok("vplan: rentang target IKUT dikirim ke prompt (bukan cuma rumus)", (() => {
    const { user, system } = vpd.directorPrompts({
      projectId: "p", brandName: "B", brief: "b", script: "naskah uji", hookText: null,
      orientation: "portrait", brandLook: null, footage: [], audioDurationSeconds: 20, internal: true,
    });
    const o = JSON.parse(user);
    return o.totalTargetDetik && typeof o.totalTargetDetik.min === "number" && o.durasiVO === 20
      && system.includes("jumlah semua duration masuk totalTargetDetik");
  })());

  // ---- gerbang long-form: DILEWATI, bukan GAGAL (2026-11-07) ----
  const inpLF = (audio: number) => ({
    projectId: "p", brandName: "B", brief: "b", script: "naskah", hookText: null,
    orientation: "portrait" as const, brandLook: null, footage: [], audioDurationSeconds: audio, internal: true,
  });
  // Kalau gerbangnya bocor, mock ini MELEMPAR -> tes merah. Itu buktinya AI tak dipanggil.
  const aiDilarang: Parameters<typeof vpd.generateVideoPlan>[1] =
    async () => { throw new Error("AI TIDAK BOLEH dipanggil utk long-form"); };

  const lf = await vpd.generateVideoPlan(inpLF(440), aiDilarang);
  ok("longform: dilewati=true, ok=false, attempts=0, costUsd=0, AI tak dipanggil",
    lf.dilewati === true && lf.ok === false && lf.attempts === 0 && lf.costUsd === 0
    && lf.errors.length === 1 && lf.errors[0].startsWith("dilewati:long_form"));

  ok("longform: short-form TIDAK dilewati (gerbang tak kebablasan)", await (async () => {
    const r = await vpd.generateVideoPlan(inpLF(12), (async () => ({ text: "{}", promptTokens: 0, completionTokens: 0 })) as never);
    return r.dilewati !== true && r.attempts >= 1;
  })());

  ok("longform: summarizeShadow mengeluarkan yang dilewati dari penyebut", (() => {
    const baris = [
      JSON.stringify({ ok: true, plan: {}, errors: [], attempts: 1, latencyMs: 10, promptTokens: 1, completionTokens: 1, costUsd: 0.001 }),
      JSON.stringify({ ok: false, plan: null, errors: ["$.scenes: count(1)"], attempts: 2, latencyMs: 20, promptTokens: 1, completionTokens: 1, costUsd: 0.001 }),
      JSON.stringify({ ok: false, plan: null, dilewati: true, errors: ["dilewati:long_form (VO 440.0s ...)"], attempts: 0, latencyMs: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 }),
    ];
    const s2 = vpd.summarizeShadow(baris) as { total: number; pass: number; passRate: number; dilewatiLongForm: number; totalTermasukDilewati: number; topReasons: Array<[string, number]> };
    // 1 lolos dari 2 yang DIHITUNG (bukan 1 dari 3), dan alasan "dilewati" tak mencemari daftar
    return s2.total === 2 && s2.pass === 1 && Math.abs(s2.passRate - 0.5) < 1e-9
      && s2.dilewatiLongForm === 1 && s2.totalTermasukDilewati === 3
      && !s2.topReasons.some(([k]) => k.startsWith("dilewati"));
  })());

  // ---- jumlah adegan disarankan, diturunkan dari rentang durasi (2026-11-07) ----
  ok("adegan: saran diturunkan dari durasi, bukan plafon 12", (() => {
    // VO 11,6 dtk -> rentang 11,8-15,9 -> tengah 13,85 / 3,5 = 4. Rencana yang LOLOS
    // saat pembedahan memang 4 adegan; yang gagal 5-8.
    const a = vpd.adeganDisarankanUntuk(11.6, true);
    const b = vpd.adeganDisarankanUntuk(32.8, true);
    return a === 4 && b > a && b <= vp.LIMITS.scenes.max;
  })());

  ok("adegan: saran selalu di dalam LIMITS.scenes dan tak melebihi plafon tenant", (() => {
    for (const audio of [3, 8, 11.6, 20, 45, 90]) {
      for (const internal of [true, false]) {
        const n = vpd.adeganDisarankanUntuk(audio, internal);
        if (n < vp.LIMITS.scenes.min || n > vp.LIMITS.scenes.max) return false;
        if (n > vpd.maxScenesFor(internal)) return false;
      }
    }
    return true;
  })());

  ok("adegan: saran x durasi adegan yang wajar jatuh DI DALAM rentang target", (() => {
    for (const audio of [8, 11.6, 20, 45]) {
      const n = vpd.adeganDisarankanUntuk(audio, true);
      const r = vpd.targetTotalDetik(audio);
      const tengah = (r.min + r.max) / 2;
      const perAdegan = tengah / n;
      // durasi tiap adegan harus mungkin dipenuhi kontrak
      if (perAdegan < vp.LIMITS.sceneSeconds.min || perAdegan > vp.LIMITS.sceneSeconds.max) return false;
    }
    return true;
  })());

  ok("adegan: payload mengirim angka konkret + plafon terpisah", (() => {
    const { user, system } = vpd.directorPrompts({
      projectId: "p", brandName: "B", brief: "b", script: "n", hookText: null,
      orientation: "portrait", brandLook: null, footage: [], audioDurationSeconds: 11.6, internal: true,
    });
    const o = JSON.parse(user);
    return o.adeganDisarankan === 4 && o.adeganMaksimum === vpd.maxScenesFor(true)
      && system.includes("jumlah adegan = adeganDisarankan")
      && vp.videoPlanPromptSpec().includes('PAKAI "adeganDisarankan"');
  })());

  ok("vplan prompt: subject wajib benda terlihat, dgn contoh BENAR dan SALAH", (() => {
    const spec = vp.videoPlanPromptSpec();
    return spec.includes("BENDA YANG TERLIHAT DI FRAME")
      && spec.includes('BENAR "tumpukan cucian terbungkus plastik"')
      && spec.includes('SALAH "pickup delivery gratis"')
      && spec.includes("kalau kalimatnya tidak bisa difoto");
  })());


  // ---------- Status pembayaran: batas poll & ambang menggantung (2026-11-07) ----------
  const stp = await import("../src/lib/billing/statusPembayaran.ts");
  ok("poll: lanjut di awal (0 ms)", stp.bolehPollLagi(0));
  ok("poll: lanjut tepat sebelum batas", stp.bolehPollLagi(stp.BATAS_POLL_MS - 1));
  ok("poll: BERHENTI tepat di batas (bukan spinner abadi)", !stp.bolehPollLagi(stp.BATAS_POLL_MS));
  ok("poll: BERHENTI jauh lewat batas", !stp.bolehPollLagi(stp.BATAS_POLL_MS * 10));
  ok("poll: jeda rapat di awal lalu melebar", stp.jedaPollMs(1) === 2500 && stp.jedaPollMs(7) === 2500 && stp.jedaPollMs(8) === 6000);
  ok("poll: total putaran terbatas (batas / jeda terkecil)", stp.BATAS_POLL_MS / stp.jedaPollMs(1) < 100);
  const t0 = 1_800_000_000_000;
  ok("menggantung: baru dibuat -> belum", !stp.menggantung(t0, t0 + 60_000));
  ok("menggantung: tepat di ambang -> ya", stp.menggantung(t0, t0 + stp.AMBANG_MENGGANTUNG_MS));
  ok("menggantung: lewat ambang -> ya", stp.menggantung(t0, t0 + stp.AMBANG_MENGGANTUNG_MS + 1));
  ok("menggantung: ambang > batas poll (pelanggan dulu dapat layar jelas, baru owner dinotif)", stp.AMBANG_MENGGANTUNG_MS > stp.BATAS_POLL_MS);
  ok("peta status Tripay: PAID -> sukses", stp.petakanStatusTripay("PAID") === "sukses");
  ok("peta status Tripay: EXPIRED/FAILED/REFUND -> gagal", ["EXPIRED", "FAILED", "REFUND"].every((s) => stp.petakanStatusTripay(s) === "gagal"));
  ok("peta status Tripay: UNPAID -> pending", stp.petakanStatusTripay("UNPAID") === "pending");
  ok("peta status Tripay: status asing/kosong -> pending (konservatif, jangan tandai gagal)",
    stp.petakanStatusTripay("STATUS_BARU") === "pending" && stp.petakanStatusTripay("") === "pending");
  ok("peta status Tripay: huruf kecil tetap terbaca", stp.petakanStatusTripay("paid") === "sukses");

  console.log(`\n${pass} lolos, ${fail} gagal`);
  assert.strictEqual(fail, 0, `${fail} tes gagal`);
}
run().catch((e) => { console.error(e); process.exit(1); });

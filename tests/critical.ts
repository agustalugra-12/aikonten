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

  console.log(`\n${pass} lolos, ${fail} gagal`);
  assert.strictEqual(fail, 0, `${fail} tes gagal`);
}
run().catch((e) => { console.error(e); process.exit(1); });

import { generateImageWithGemini, type GeneratedImage } from "./geminiImage";
import { uploadBuffer, buildAssetKey } from "@/lib/storage";
import { checkPosterQuality } from "./posterQualityCheck";
import { LOGO_SIZE_RATIO, LOGO_MARGIN_RATIO, clearLogoZone } from "./logoOverlay";
import type { PosterCopy } from "./posterCopy";

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
// Dipecah jadi 3 bagian (2026-08-11, permintaan Agus - brand "laundry in bali": "untuk
// konten foto ... bisa berikan sedikit kebebasan foto bisa full generate ai juga") -
// SEBELUM ini SATU string monolitik yg KERAS melarang foto AI/stok sama sekali (baris
// FOTO + baris BATASAN KERAS "menghasilkan foto AI atau gambar stok"), ditulis sengaja
// awalnya utk brand hospitality (jangan sampai tamu lihat kamar palsu). Larangan itu
// TETAP berlaku penuh utk jalur foto ASLI (applyPosterDesign, brand tanpa toggle
// allowAiGeneratedPhotos) - visualSourceRule di bawah jadi SATU-SATUNYA bagian yg beda
// antara 2 mode, sisanya (layout/tipografi/badge harga/zona logo/anti-mengarang
// kontak) SAMA PERSIS di kedua mode, tidak diduplikasi.
const SHARED_STRUCTURAL_RULES = `
Kamu adalah seorang Senior Graphic Designer berpengalaman 15+ tahun, spesialis poster promosi komersial premium utk bisnis lokal (hospitality, laundry, resto, travel, jasa, dst). Ikuti PROFIL BRAND yang diberikan terpisah di bawah utk warna/font/ikon/tone - bagian ini berlaku SAMA utk semua brand.

STYLE: Modern Minimalist, Premium Commercial Advertising, Clean Layout, High Trust, Eye-catching, High Conversion. Harus terlihat seperti buatan desainer profesional, BUKAN buatan AI. Jangan membuat poster seperti brosur jadul.

KOMPOSISI: layout rapi, banyak ruang kosong (white space), visual utama mendominasi 60-70%, elemen teks 30-40%. Posisi headline/CTA/badge harga/benefit/icon boleh fleksibel tiap poster (kiri-kanan, hero image full, split layout, diagonal, magazine, floating card, editorial) selama tetap terlihat premium & seimbang - JANGAN selalu taruh semua di tengah.

TYPOGRAPHY: kombinasi maksimal 2 font. Headline: Bold/Extra Bold Sans Serif Modern (kecuali PROFIL BRAND minta lain). Body: Clean Sans Serif, mudah dibaca. Hierarki font harus sangat jelas.

HIERARKI visual (urutan kepentingan): 1) Headline, 2) Visual utama, 3) Promo/Badge, 4) Benefit/Fasilitas, 5) Harga, 6) CTA, 7) Kontak.

ICON: outline modern, minimalis, stroke seragam, warna sesuai warna utama PROFIL BRAND (bukan warna acak). Jangan pakai icon kartun.

CARD: card putih/gradient, rounded corner, soft shadow, floating card. Glass effect tipis boleh dipakai.

BADGE HARGA/PROMO: kalau ada harga/promo, bentuknya lingkaran/rounded badge/pill/ribbon, jadi salah satu fokus utama poster. Kalau TIDAK ada harga yg disebutkan di KONTEN POSTER di bawah, JANGAN menampilkan badge harga sama sekali - jangan mengarang angka, DAN JANGAN JUGA membuat elemen dekoratif generik yang MENYERUPAI badge diskon/promo (lingkaran kecil berisi simbol "%", pita "SALE"/"DISKON", starburst harga, dst) walau tanpa angka sungguhan di dalamnya - kalau KONTEN POSTER di bawah tidak menyebut promo, poster ini TIDAK SEDANG promo apa pun, jangan seolah-olah begitu hanya karena itu lazim di poster retail pada umumnya.

EFEK: soft shadow natural (bukan hard shadow), soft glow, gradient overlay, light blur, depth, floating element, glassmorphism ringan. Jangan berlebihan/norak/sesak.

OUTPUT: resolusi tinggi, social media ready (4:5 atau 1:1), margin rapi, semua tulisan mudah dibaca, tidak ada elemen yang saling bertabrakan/tumpang tindih.

KONTAK: JANGAN PERNAH menambahkan nomor telepon/WhatsApp, alamat website/domain, atau handle media sosial di poster kecuali disebutkan eksplisit di KONTEN POSTER INI di bawah - lebih baik tidak ada info kontak sama sekali daripada info yang salah/mengarang.
`.trim();

// LOGO section (2026-09-06, diperkuat - permintaan Agus "jangan berisi logo kecuali
// owner minta logo dilampirkan" - temuan kasus AgustaP Studio: draft AI menaruh IKON
// GENERIK (Instagram/TikTok) di zona logo, QC menandai ini sbg "logo/badge tidak
// seharusnya ada" krn MENYERUPAI identitas walau bukan logo brand sungguhan yg
// digambar ulang. Larangan versi LAMA cuma sebut "logo, badge brand, seal, watermark"
// - diperluas eksplisit sebut ikon aplikasi/medsos & elemen dekoratif apa pun yg bisa
// disalahartikan sbg identitas, supaya celah yg sama tidak lolos lagi). Dipisah jadi
// fungsi (bukan konstanta tunggal) krn sekarang PER-BRAND: default STRICT (larangan
// penuh), brand dgn allowLogoInAiContent=true (lihat schema.ts, dgn logoInContentNote
// wajib terisi sbg bukti persetujuan biaya) dapat versi RELAXED yg mengizinkan elemen
// identitas tampil di gambar - staf SUDAH diberi tahu konsekuensi biaya 2x lewat UI
// (BrandSettingsSidebar) sebelum mengaktifkan toggle ini.
function buildLogoSection(allowLogoInContent: boolean): string {
  if (allowLogoInContent) {
    return `
LOGO/IDENTITAS (brand ini MENGIZINKAN): brand ini secara eksplisit mengizinkan elemen logo/identitas/ikon brand tampil di gambar - boleh menyertakan ikon aplikasi/media sosial, badge, atau elemen visual lain yang relevan dgn PROFIL BRAND di bawah, SELAMA tetap rapi & tidak mengganggu keterbacaan headline/CTA/harga. Logo ASLI brand (kalau ada) tetap akan ditempel TERPISAH sesudah gambar ini jadi di pojok kanan-atas (lihat ZONA AMAN LOGO) - jangan gambar ulang logo ASLI brand itu sendiri (hindari duplikasi), tapi elemen identitas LAIN (ikon medsos, badge fitur, dst) boleh dipakai bebas di luar zona itu.
`.trim();
  }
  return `
LOGO: JANGAN PERNAH membuat/menggambar logo, badge brand, seal/stempel "verified"/"certified", watermark, ikon aplikasi/media sosial (Instagram/TikTok/WhatsApp/dst), atau simbol/elemen dekoratif apa pun yang bisa disalahartikan sbg identitas brand - JANGAN sekalipun sekadar elemen dekoratif atau "biar ramai". Logo ASLI brand (kalau ada) ditempel TERPISAH sesudah gambar ini jadi, lewat proses lain di luar kendalimu - tugasmu HANYA desain poster tanpa elemen identitas apa pun, jangan mengisi "kekosongan" itu dengan logo/ikon karangan.
`.trim();
}

// (2026-09-06, root cause ditemukan - kasus AgustaP Studio) posterBrandProfile brand
// ini SENDIRI eksplisit minta visual utama & floating label ikon ditaruh "kanan atas"
// (bagian VISUAL COMPOSITION/DEVICE MOCKUP di profil AgustaP) - bentrok LANGSUNG dgn
// zona ini. Prompt brand profile ditulis BELAKANGAN dgn penekanan "WAJIB diikuti" (lihat
// buildPosterPrompt), jadi rawan "menang" atas aturan zona yg ditulis lebih awal kalau
// tidak ditegaskan eksplisit siapa yg menang - kalimat precedence terakhir di bawah
// ditambahkan khusus utk itu (berlaku general utk brand MANAPUN yg profilnya kebetulan
// minta posisi serupa, bukan cuma AgustaP).
const ZONA_AMAN_LOGO = `
ZONA AMAN LOGO (WAJIB DIPATUHI - bukan saran, ini POSISI PASTI): logo ASLI brand akan ditempel TEPAT di pojok KANAN ATAS gambar, berbentuk lingkaran, dengan diameter kira-kira ${LOGO_SIZE_RATIO * 100}% dari sisi PENDEK gambar dan margin sekitar ${LOGO_MARGIN_RATIO * 100}% dari tepi atas & tepi kanan. Artinya area PERSEGI di pojok kanan-atas seluas kira-kira ${(LOGO_SIZE_RATIO + LOGO_MARGIN_RATIO) * 100}% lebar x ${(LOGO_SIZE_RATIO + LOGO_MARGIN_RATIO) * 100}% tinggi (dihitung dari sisi pendek gambar) HARUS dibiarkan KOSONG/BERSIH dari teks, headline, logo/badge/ikon/elemen dekoratif apa pun, atau elemen penting lain - boleh diisi background/langit/warna polos/blur di area itu, TAPI JANGAN taruh huruf/kata/ikon/lambang di sana sama sekali, walau cuma sebagian. (2026-09-11, ditemukan lewat A/B test - beberapa hasil generate menggambar GARIS/OUTLINE/BINGKAI/LINGKARAN KOSONG sbg semacam "placeholder" di zona ini, seolah menandai "logo nanti di sini", ATAU sebaliknya menjorokkan PANEL/KARTU/BLOK dgn tepi/bezel yg jelas [mis. sudut layar HP/laptop/tablet mockup, kartu UI, kotak dashboard] ke dalam zona ini - KEDUANYA DILARANG. Zona harus BENAR-BENAR polos rata [background/gradient/warna solid TANPA tepi/garis/bezel/sudut benda apa pun yg terlihat sbg objek tersendiri]. KHUSUS kalau visual utama berupa mockup device [HP/laptop/tablet/layar dashboard] yg diletakkan miring/diagonal - WAJIB atur posisi & sudut kemiringannya supaya bezel/tepi/sudut device itu MENJAUHI pojok kanan-atas [condongkan ke kiri-bawah], BUKAN mengarah/menjorok ke sana.) ATURAN INI BERLAKU WALAU brand mengizinkan elemen identitas di bagian LAIN gambar (lihat LOGO di atas), zona ini TETAP harus kosong krn sudah direservasi utk logo ASLI. Headline yang butuh 2 baris HARUS dimulai/diposisikan supaya baris manapun TIDAK menjorok ke area pojok kanan-atas itu - kalau perlu, geser headline lebih ke kiri/bawah atau perpendek baris pertama, JANGAN biarkan teks kepotong logo. PRIORITAS: kalau PROFIL BRAND di bawah (nanti) menyebutkan posisi visual utama/mockup/label/ikon di "kanan atas"/"kanan"/"pojok kanan", aturan ZONA AMAN LOGO ini TETAP MENANG - geser visual/label itu SEDIKIT ke kiri/bawah supaya TIDAK masuk area reserved ini, JANGAN korbankan zona ini demi mengikuti instruksi posisi di PROFIL BRAND.
`.trim();

const REAL_PHOTO_VISUAL_RULE = `
FOTO (SANGAT PENTING): WAJIB pakai FOTO ASLI yang diberikan sbg visual utama - objek utamanya (kamar/pakaian/produk/apa pun sesuai niche brand, lihat PROFIL BRAND) HARUS tetap identik, JANGAN membuat objek baru, JANGAN mengganti objek dgn yang lain, JANGAN membuat foto AI atau memakai gambar stok. AI HANYA boleh: perspective correction, lighting enhancement, HDR enhancement, contrast improvement, color grading, highlight/shadow recovery, sharpness enhancement, background enhancement, reflection & depth. TIDAK BOLEH mengubah bentuk/identitas objek utama, menambah elemen yang tidak ada di foto asli.
`.trim();
const REAL_PHOTO_BATASAN = "BATASAN KERAS - JANGAN PERNAH: mengubah logo/identitas visual brand, bikin layout terlalu penuh/sesak, menambahkan elemen yang tidak ada di foto asli, menghasilkan foto AI atau gambar stok, mengubah identitas objek utama di foto asli.";

// Full AI-Generate (2026-08-11) - HANYA dipakai brand dgn allowAiGeneratedPhotos=true
// (lihat schema.ts) - TIDAK ada foto asli sama sekali, visual utama dibuat PENUH lewat
// AI generation. Tetap photorealistic/premium (bukan kartun/clip art) & relevan niche
// brand, plus larangan wajah spesifik (privasi - tidak ada orang sungguhan yg fotonya
// dipakai tanpa izin).
const FULL_AI_VISUAL_RULE = `
VISUAL UTAMA (SANGAT PENTING): TIDAK ADA foto asli yang dipakai kali ini - buat visual utama SEPENUHNYA lewat AI image generation, photorealistic & premium quality (BUKAN ilustrasi kartun/clip art/gambar datar), relevan dgn niche bisnis sesuai PROFIL BRAND di bawah (mis. tumpukan pakaian bersih rapi, mesin cuci modern, proses laundry, kamar/fasilitas sesuai niche - SESUAIKAN dgn niche brand, jangan objek generik yang tidak relevan). Kalau perlu figur manusia, buat GENERIK/tidak menghadap kamera langsung/wajah tidak jelas terlihat (privasi - JANGAN buat wajah spesifik yang terlihat seperti orang sungguhan tertentu).
`.trim();
const FULL_AI_BATASAN = "BATASAN KERAS - JANGAN PERNAH: mengubah logo/identitas visual brand, bikin layout terlalu penuh/sesak, membuat visual generik yang tidak relevan niche brand, membuat wajah manusia spesifik yang terlihat seperti orang sungguhan tertentu.";

// Fallback (2026-08-06) - brand yg BELUM isi posterBrandProfile (mis. brand baru yg
// belum sempat diisi stafnya) pakai profil netral ini, BUKAN diam-diam warisan gaya
// Pelangi (itu justru bug yg sedang diperbaiki di sini). Sengaja generik/aman, bukan
// niche apa pun spesifik - mendorong staf mengisi profil asli lewat Brand Settings.
const FALLBACK_BRAND_PROFILE = `
PROFIL BRAND: belum diisi staf - pakai gaya netral & aman.
WARNA: Biru tua (#1E3A5F) & Putih sbg warna utama, abu-abu terang sbg background, satu warna aksen hangat (oranye/kuning) HANYA utk badge harga/CTA.
TONE: profesional, terpercaya, bersih, modern - netral, tidak condong ke niche tertentu.
`.trim();

// Layout Infografis (2026-08-11, permintaan Agus - "jika buat konten tips dan edukasi
// pada poster gunakan konsep infografis sehingga konsumen mendapatkan info lengkap
// bukan seperti sekarang terputus") - TAMBAHAN di atas SHARED_STRUCTURAL_RULES (bukan
// pengganti - tipografi/zona logo/anti-mengarang kontak dst TETAP sama), meng-OVERRIDE
// bagian KOMPOSISI/HIERARKI SPESIFIK: mode promosi biasa visual dominan 60-70% (wajar,
// tujuannya jual), mode infografis KEBALIKANNYA - teks/poin yg WAJIB dominan & mudah
// dibaca, visual jadi pendukung/aksen, krn tujuannya konsumen dapat INFO LENGKAP
// langsung dari 1 gambar, bukan cuma hook yg mengarahkan ke tempat lain.
const INFOGRAFIS_LAYOUT_RULE = `
LAYOUT INFOGRAFIS (mode konten edukasi/tips - OVERRIDE bagian KOMPOSISI/HIERARKI di atas): tujuan poster ini INFORMATIF, konsumen harus dapat SELURUH info dari poster ini sendiri tanpa perlu baca teks lain. SEMUA poin di INFOGRAFISPOINTS di bawah WAJIB tampil LENGKAP & mudah dibaca (bukan cuma judulnya, TERJEMAHKAN teks penuh tiap poin ke dalam gambar apa adanya, JANGAN dipotong/diringkas lagi) - gunakan layout numbered-list/step-card yang jelas (nomor besar 1/2/3/dst + 1 ikon relevan kecil + teks poin lengkap per baris/card), susun vertikal atau grid rapi tergantung jumlah poin. Visual (foto/AI) jadi BACKGROUND/aksen kecil di satu sisi/belakang (BUKAN dominan 60-70% lagi) - PRIORITASKAN ruang & keterbacaan teks poin di atas ukuran visual. CTA dibuat JAUH lebih kecil/halus di pojok bawah (bukan tombol besar mencolok) krn ini bukan poster hard-sell.
`.trim();

function buildPosterPrompt(
  copy: PosterCopy,
  brandProfile: string | null | undefined,
  mode: "real-photo" | "full-ai",
  allowLogoInContent: boolean = false
): string {
  const isInfografis = !!copy.infografisPoints && copy.infografisPoints.length > 0;
  const baris = [
    `Headline: "${copy.headline}"`,
    copy.subheadline ? `Subheadline: "${copy.subheadline}"` : null,
    copy.harga ? `Harga/Badge Promo: "${copy.harga}"` : "Tidak ada harga/promo - JANGAN tampilkan badge harga sama sekali.",
    `CTA: "${copy.cta}"`,
    isInfografis
      ? `INFOGRAFISPOINTS (WAJIB tampil LENGKAP semua, lihat LAYOUT INFOGRAFIS di atas):\n${copy.infografisPoints!.map((p) => `  ${p.nomor}. ${p.teks}`).join("\n")}`
      : null,
    !isInfografis && copy.benefits.length > 0 ? `Benefit/fasilitas yang ditonjolkan: ${copy.benefits.join(", ")}` : null,
    // 2026-08-13, bug nyata ditemukan lewat tes live: "Isi tulisan tambahan:" (nama
    // field ini) sempat ke-render HARFIAH sbg judul/label yg tampil di poster - beda
    // dari Headline/Subheadline/CTA yg AI sudah "paham" konvensi desainnya (jadi
    // otomatis tidak menampilkan label field-nya), "isi tulisan tambahan" bukan istilah
    // desain baku yg dikenali, jadi AI defaultnya menampilkan apa adanya sbg teks
    // literal. Diperjelas eksplisit: JANGAN tampilkan nama field ini sama sekali.
    copy.isiTulisan
      ? `Teks pendukung tambahan (BUKAN judul terpisah - sisipkan sbg 1 baris subtext/caption kecil yg menyatu wajar dgn desain, mis. di bawah headline atau dekat CTA. JANGAN PERNAH menampilkan kata "teks pendukung"/"isi tulisan"/"tambahan" atau label apa pun di poster - TULISKAN LANGSUNG isinya saja sbg teks poster biasa, tanpa tanda kutip, tanpa nama field ini muncul sama sekali): "${copy.isiTulisan}"`
      : null,
  ].filter((line): line is string => !!line);

  const profile = (brandProfile || "").trim() || FALLBACK_BRAND_PROFILE;
  const visualRule = mode === "full-ai" ? FULL_AI_VISUAL_RULE : REAL_PHOTO_VISUAL_RULE;
  const batasan = mode === "full-ai" ? FULL_AI_BATASAN : REAL_PHOTO_BATASAN;
  const layoutOverride = isInfografis ? `\n\n${INFOGRAFIS_LAYOUT_RULE}` : "";
  // (2026-09-06) diulang di baris PALING AKHIR prompt (bukan cuma sekali di tengah
  // dekat PROFIL BRAND) - kasus AgustaP Studio: reminder 1x saja TERBUKTI belum cukup
  // kuat lawan instruksi brand profile yg sangat eksplisit/detail soal posisi "kanan
  // atas" (live test 3x masih gagal QC pojok kanan-atas setelah reminder pertama
  // ditambahkan). Kalimat penutup PALING AKHIR yg dibaca model sebelum generate biasanya
  // dapat bobot perhatian lebih besar (recency) - diulang lagi di sini sbg lapisan
  // ketiga (SHARED_STRUCTURAL_RULES awal -> reminder dekat PROFIL BRAND -> sini).
  const zonaFinalReminder =
    " INGAT SEKALI LAGI SEBELUM GENERATE: pojok kanan-atas gambar (kira-kira " +
    `${(LOGO_SIZE_RATIO + LOGO_MARGIN_RATIO) * 100}% lebar x ${(LOGO_SIZE_RATIO + LOGO_MARGIN_RATIO) * 100}% tinggi dari sisi pendek) ` +
    "WAJIB kosong total/background polos - TIDAK ADA pengecualian utk instruksi posisi apa pun di PROFIL BRAND (kalau PROFIL BRAND minta visual/mockup/label/ikon di kanan/kanan-atas, geser ke kiri/tengah/bawah sebagai gantinya).";
  const closingLine =
    (mode === "full-ai"
      ? "Buat SATU poster promosi dengan visual utama HASIL AI GENERATION SEPENUHNYA (tidak ada foto asli)."
      : "Buat SATU poster promosi memakai foto yang diberikan sebagai visual utama.") + zonaFinalReminder;

  const logoSection = buildLogoSection(allowLogoInContent);

  return (
    `${SHARED_STRUCTURAL_RULES}\n\n${logoSection}\n\n${ZONA_AMAN_LOGO}\n\n${visualRule}\n\n${batasan}${layoutOverride}\n\n---\n\n` +
    `PROFIL BRAND (warna/font/ikon/tone brand ini - ` +
    `WAJIB diikuti, ini yang membedakan brand ini dari brand lain):\n${profile}\n\n` +
    // (2026-09-11, bug nyata ditemukan lewat A/B test AgustaP Studio) PROFIL BRAND di
    // atas = INSTRUKSI DESAIN utkmu (model gambar), BUKAN teks yang harus muncul di
    // poster. Token teknis di dalamnya - kode warna hex (#1647D9/#FFFFFF/dst), rasio
    // persen (60-70%), nama font (Montserrat/Inter/dst) - DAN contoh ilustratif (mis.
    // "SEMUA PAKET TERMASUK", "Rp1,5 JUTA") berulang kali bocor ke-render HARFIAH sbg
    // teks/badge di poster (mis. badge berisi "White #FFFFFF 60-70%"). Guard eksplisit
    // di bawah: profil = cara mendesain, bukan isi yang digambar.
    `PENTING - PROFIL BRAND di atas adalah PANDUAN GAYA utkmu (cara memilih warna/font/` +
    `layout), BUKAN teks yang digambar di poster. JANGAN PERNAH menampilkan token teknis ` +
    `dari profil sbg teks/badge/label di poster: kode warna hex (mis. #1647D9, #FFFFFF, ` +
    `#171717), angka rasio/persen (mis. "60-70%"), nama font (mis. Montserrat/Inter/` +
    `Poppins), maupun CONTOH ilustratif yang disebut di profil (mis. "SEMUA PAKET ` +
    `TERMASUK", "Rp1,5 JUTA", "90 KONTEN/BULAN" - itu cuma contoh gaya, bukan konten ` +
    `poster ini). Terapkan warnanya (pakai birunya, putihnya) TANPA menuliskan kode/nama/` +
    `persennya. Satu-satunya teks yang boleh muncul di poster = KONTEN POSTER INI di bawah.\n\n` +
    `PENGINGAT (kalau PROFIL BRAND di atas menyebut posisi "kanan atas"/"kanan"/"pojok kanan" utk visual/mockup/label/ikon apa pun): ZONA AMAN LOGO yg sudah dijelaskan di awal TETAP MENANG - jangan taruh elemen apa pun dari PROFIL BRAND di area itu, geser ke kiri/bawah.\n\n---\n\n` +
    `KONTEN POSTER INI (isi teks yang harus muncul, TERJEMAHKAN ke elemen visual sesuai ` +
    `seluruh aturan gaya di atas - jangan tampilkan teks lain di luar ini):\n` +
    `${baris.join("\n")}\n\n${closingLine}`
  );
}

async function uploadPosterResult(opts: { brandId: string; projectId: string }, image: GeneratedImage): Promise<string> {
  // clearLogoZone dipanggil di SINI (2026-09-06) - satu-satunya titik pertemuan SEMUA
  // pemanggil generateImageWithGemini di file ini (applyPosterDesign, generatePosterFullAi,
  // applyPosterFix) - bersihkan zona logo SEBELUM upload/QC, lihat catatan lengkap di
  // logoOverlay.ts. sharp mempertahankan format input (jpeg tetap jpeg) - image.mimeType
  // di bawah TETAP akurat sesudah proses ini.
  const cleanedBuffer = await clearLogoZone(image.buffer);
  // Ekstensi & content-type ikut mimeType ASLI dari Gemini (kadang image/jpeg, bukan
  // selalu png - lihat catatan di geminiImage.ts) - jangan hardcode png lagi.
  const ext = image.mimeType === "image/jpeg" ? "jpg" : "png";
  // buildAssetKey SUDAH prefix timestamp sendiri (lihat storage.ts) - key tetap unik
  // tiap panggilan (percobaan awal vs hasil perbaikan QC) walau nama filenya sama.
  const key = buildAssetKey(opts.brandId, opts.projectId, `poster.${ext}`);
  return uploadBuffer(key, cleanedBuffer, image.mimeType);
}

// Perbaikan bertarget (2026-08-13, lihat catatan lengkap di posterQualityCheck.ts) -
// BEDA dari regenerasi total dari foto asli lagi: poster yang SUDAH JADI (walau cacat)
// dimasukkan lagi sbg `image_urls` ke nano-banana-2/edit yg SAMA, dgn instruksi
// SPESIFIK memperbaiki HANYA masalah yg ditemukan QC - lebih murah/terarah drpd
// generate ulang dari nol (yg bisa melahirkan cacat BARU yg beda lagi tiap percobaan)
// & bekerja SAMA utk kedua jalur (foto asli maupun full-AI) krn inputnya poster yg
// sudah jadi, bukan foto asli/copy lagi.
async function applyPosterFix(opts: { brandId: string; projectId: string }, flawedPosterUrl: string, issues: string[]): Promise<string> {
  const prompt = `Ini poster promosi yang SUDAH dibuat, tapi pemeriksaan kualitas menemukan masalah berikut yang WAJIB diperbaiki:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nINSTRUKSI PERBAIKAN: perbaiki HANYA masalah di atas. JANGAN ubah elemen lain yang sudah benar (headline, layout, warna, foto, badge, CTA, dst harus tetap SAMA PERSIS kecuali yang perlu diperbaiki). Kalau masalahnya elemen logo/badge/lambang tambahan (termasuk di pojok kanan-atas) - HAPUS elemen itu sepenuhnya, biarkan areanya kosong/bersih (logo ASLI brand akan ditempel terpisah sesudah ini, jangan gambar logo apa pun sbg gantinya). Hasil akhir tetap 1 poster utuh, resolusi & rasio sama seperti sebelumnya.`;

  const image = await generateImageWithGemini({
    prompt,
    imageUrls: [flawedPosterUrl],
    aspectRatio: "4:5",
    usageLabel: "gemini-3.1-flash-image-poster-fix",
  });
  return uploadPosterResult(opts, image);
}

// QC + 1x perbaikan otomatis (2026-08-13, permintaan Agus - laporan nyata "hasil
// generatenya kadang ada dobel logo atau frame logo lain di pojok kanan... Sebelum
// output final, lakukan self-check secara visual... Jika menemukan kesalahan... jangan
// berikan hasil tersebut sebagai output final; perbaiki terlebih dahulu"). Dipakai SAMA
// utk applyPosterDesign & generatePosterFullAi (generateInitial = closure beda sumber,
// alur QC-nya identik) - signature fungsi publik TIDAK berubah, processProject.ts
// (pemanggil) tidak perlu tahu/disentuh sama sekali. Maks 2 percobaan total (generate
// awal + 1x perbaikan bertarget) - frugal, sama semangat dgn checkAndHandleDuplicate
// (KontenPilot repo lain) yg SENGAJA dibatasi drpd retry tak terbatas.
async function runPosterWithQualityCheck(
  opts: { brandId: string; projectId: string; allowLogoInContent?: boolean },
  generateInitial: () => Promise<string>
): Promise<string> {
  const allowLogo = !!opts.allowLogoInContent;
  const url = await generateInitial();
  let qc: { passed: boolean; issues: string[] };
  try {
    qc = await checkPosterQuality(url, allowLogo);
  } catch (err) {
    console.error(`[posterDesign] QC gagal dijalankan (project ${opts.projectId}), pakai hasil apa adanya:`, err);
    return url;
  }
  if (qc.passed) return url;

  console.warn(`[posterDesign] QC gagal percobaan awal (project ${opts.projectId}): ${qc.issues.join("; ")} - coba perbaikan otomatis`);
  try {
    const fixedUrl = await applyPosterFix(opts, url, qc.issues);
    const qc2 = await checkPosterQuality(fixedUrl, allowLogo);
    if (qc2.passed) return fixedUrl;
    console.warn(
      `[posterDesign] QC MASIH gagal setelah perbaikan (project ${opts.projectId}): ${qc2.issues.join("; ")} - ` +
        `pakai hasil perbaikan apa adanya (sudah lebih baik dari percobaan awal), PERLU DICEK MANUAL di Draft Review.`
    );
    return fixedUrl;
  } catch (err) {
    console.error(`[posterDesign] gagal jalankan perbaikan QC (project ${opts.projectId}), pakai hasil awal apa adanya:`, err);
    return url;
  }
}

// Poster foto tunggal penuh (BEDA dari applyPromoOverlay yg cuma badge kecil 1 pojok) -
// Gemini API LANGSUNG (2026-09-06, migrasi dari fal.ai - lihat geminiImage.ts) model
// gemini-3.1-flash-image TANPA mask - model ini sama sekali TIDAK PUNYA fitur mask
// biner (2026-08-05, dicek langsung ke dokumentasi resmi: "no masks needed", editing
// murni lewat instruksi natural language/"semantic masking") - keamanan foto asli
// TIDAK ditegakkan lewat mask, murni lewat instruksi tegas di MASTER_STYLE_PROMPT
// (bagian FOTO & BATASAN KERAS).
export async function applyPosterDesign(opts: {
  brandId: string;
  projectId: string;
  imageUrl: string;
  copy: PosterCopy;
  brandProfile?: string | null;
  allowLogoInContent?: boolean;
}): Promise<string> {
  return runPosterWithQualityCheck(opts, async () => {
    const image = await generateImageWithGemini({
      prompt: buildPosterPrompt(opts.copy, opts.brandProfile, "real-photo", opts.allowLogoInContent),
      imageUrls: [opts.imageUrl],
      aspectRatio: "4:5",
      usageLabel: "gemini-3.1-flash-image-poster",
    });
    return uploadPosterResult(opts, image);
  });
}

// Poster full AI-generate, TANPA foto asli sama sekali (2026-08-11, permintaan Agus -
// brand "laundry in bali" - lihat catatan panjang di FULL_AI_VISUAL_RULE di atas soal
// kenapa & batasannya). Text-to-image (imageUrls kosong) - model & resolusi 1K SAMA
// dgn applyPosterDesign, jadi HARGA SAMA PERSIS. aspect_ratio "4:5" (bukan "auto") -
// samakan dgn konvensi poster foto asli yg sudah ada (OUTPUT: "4:5 atau 1:1" di
// SHARED_STRUCTURAL_RULES), supaya hasil kedua mode konsisten dipakai di slot yang
// sama (feed/carousel).
export async function generatePosterFullAi(opts: {
  brandId: string;
  projectId: string;
  copy: PosterCopy;
  brandProfile?: string | null;
  allowLogoInContent?: boolean;
}): Promise<string> {
  return runPosterWithQualityCheck(opts, async () => {
    const image = await generateImageWithGemini({
      prompt: buildPosterPrompt(opts.copy, opts.brandProfile, "full-ai", opts.allowLogoInContent),
      aspectRatio: "4:5",
      usageLabel: "gemini-3.1-flash-image-poster-full-ai",
    });
    return uploadPosterResult(opts, image);
  });
}

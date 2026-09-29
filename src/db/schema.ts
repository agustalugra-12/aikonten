import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// Single-admin auth (Agus only, no multi-provider/OAuth login) - see PRD discussion:
// this is a personal multi-brand tool, not a public multi-tenant SaaS. NOTE: actual
// login check is against ADMIN_PASSWORD_HASH_B64 in .env (see lib/auth.ts), NOT this
// table's password_hash column - this row exists only as the FK anchor for
// brands.user_id (one seeded row, id="user_admin", see scripts/seed-admin.mjs).
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  namaBisnis: text("nama_bisnis"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  // Langganan & kredit (Fase 1 - Alur A/B/C). 1 akun = 1 langganan aktif; riwayat di billingLog.
  planId: text("plan_id").references(() => plans.id),
  status: text("status").notNull().default("aktif"),
  periodeMulai: integer("periode_mulai", { mode: "timestamp" }),
  periodeBerakhir: integer("periode_berakhir", { mode: "timestamp" }),
  saldoKredit: integer("saldo_kredit").notNull().default(0),
  // Blokir manual admin (2026-09-30, T6) - TERPISAH dari `status` langganan (aktif/
  // masa_tenggang/terbatas yg dikelola cron check-expiry). true = admin men-suspend akun,
  // digerbangi di statusGate.pastikanAkunBolehGenerate. Jangan campur dgn `status`.
  diblokirAdmin: integer("diblokir_admin", { mode: "boolean" }).notNull().default(false),
});

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  nama: text("nama").notNull(),
  kreditBulanan: integer("kredit_bulanan").notNull(),
  hargaBulananIdr: integer("harga_bulanan_idr").notNull(),
  izinAutoPosting: integer("izin_auto_posting", { mode: "boolean" }).notNull().default(false),
  maxBrand: integer("max_brand").notNull().default(1),
  aktif: integer("aktif", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const creditTransactions = sqliteTable("credit_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  jumlah: integer("jumlah").notNull(),
  alasan: text("alasan").notNull(),
  saldoSetelah: integer("saldo_setelah").notNull(),
  refProjectId: text("ref_project_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const billingLog = sqliteTable("billing_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  planId: text("plan_id").notNull().references(() => plans.id),
  jumlahBayarIdr: integer("jumlah_bayar_idr").notNull(),
  status: text("status").notNull(),
  gatewayRef: text("gateway_ref"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Brand = a distinct business/identity (Pelangi, Harmoni, personal, etc.) that owns
// its own social accounts and content. Added on top of the original PRD schema after
// discussion - Agus manages multiple separate brands, not just multiple accounts under
// one identity.
export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  // Logo brand (2026-08-05, permintaan Agus) - dipakai lib/ai/logoOverlay.ts, di-crop
  // lingkaran & ditempel proporsional (bukan nutupin konten) di SETIAP foto & video
  // final. Nullable - brand tanpa logo tetap jalan normal, overlay cuma dilewati.
  logoUrl: text("logo_url"),
  // Volume konten harian PER TIPE (2026-08-05, permintaan Agus - awalnya "3 foto 7
  // video" [2 tipe], DIREVISI hari yg sama jadi 3 tipe terpisah: "4 foto, 4 vidio, 4
  // curasel artinya 12 konten" - total TIDAK LAGI wajib 10, sepenuhnya sejumlah yg
  // Agus set (bebas 0+ tiap tipe, validasi cuma total >= 1). dailyCarouselCount
  // SEBELUMNYA (nama sama, arti beda) dipakai utk "foto tunggal" (default map ke mode
  // "photo" di NewProjectDialog) krn saat itu cuma ada 2 tipe di planner - MIGRASI DATA
  // di migration 0012 memindahkan nilai lama field ini ke dailySinglePhotoCount (yg
  // baru) & reset field ini ke 0, supaya brand yg sudah ada (Pelangi) perilakunya PERSIS
  // sama spt sebelum migrasi (bukan tiba2 generate carousel multi-foto yg tidak diminta).
  dailyVideoCount: integer("daily_video_count").notNull().default(7),
  dailySinglePhotoCount: integer("daily_single_photo_count").notNull().default(3),
  dailyCarouselCount: integer("daily_carousel_count").notNull().default(0),
  // YT Shorts (2026-08-10, permintaan Agus - "aku mau ada pengaturan untuk yt short di
  // automation sehingga bisa buat vidio pendek untuk yt") - bucket harian TERPISAH dari
  // dailyVideoCount krn brand cuma py SATU videoOrientation/videoDurationTarget global
  // (dipakai SEMUA video "biasa") - kalau Agus mau video landscape panjang utk YouTube
  // reguler SEKALIGUS video vertical pendek utk YouTube Shorts di hari yg sama, itu 2
  // FORMAT beda yg tidak bisa diwakili 1 setting orientasi/durasi brand. Video dari
  // bucket ini SELALU dipaksa portrait + <=60dtk apa pun videoOrientation/
  // videoDurationTarget brand (lihat processProject.ts) - override PER PROJECT
  // (projects.contentFormat), bukan ubah setting global brand.
  dailyYoutubeShortsCount: integer("daily_youtube_shorts_count").notNull().default(0),
  // Durasi target video (2026-08-05, permintaan Agus - "durasi konten video misal video
  // 30 detik 60 detik dan 1.30") - dipakai processProject.ts (TARGET_VIDEO_CLIP_COUNT dkk,
  // sebelumnya hardcode target 30-60 detik) utk turunkan jumlah klip yg dikumpulkan.
  videoDurationTarget: integer("video_duration_target").notNull().default(60),
  // Sumber footage video (2026-08-21, permintaan Agus - "untuk pembuatan vidio untuk
  // harmoni hills gunakan footage asli jangan ambil pexels atau lainnya hanya gunakan
  // bank footage") - "mixed" = perilaku lama (rasio 7:3 asli:stok, lihat clipSelect.ts),
  // "internal" = 100% footage bank brand sendiri, NOL Pexels/Pixabay (stockBudget=0,
  // destinationBroll dilewati). Default "mixed" supaya brand lama (Pelangi) tidak berubah.
  footageSource: text("footage_source", { enum: ["mixed", "internal"] }).notNull().default("mixed"),
  // Berapa foto per POST carousel (2026-08-05, permintaan Agus - "carousel 3 foto,
  // carousel 5 foto dan 7 foto") - BEDA dari dailyCarouselCount (itu jumlah POST carousel/
  // hari, ini jumlah FOTO di DALAM 1 post carousel). Dipakai NewProjectDialog.tsx &
  // auto-content/route.ts (sebelumnya hardcode MAX_CAROUSEL_PHOTOS=5).
  carouselPhotosPerPost: integer("carousel_photos_per_post").notNull().default(5),
  // Orientasi video (2026-08-05, permintaan Agus - "vidio landscape atau potrait ini
  // utk kebutuhan YT") - render pipeline (ffmpeg.ts) sebelumnya hardcode portrait
  // 1080x1920 (IG/TikTok Reels) - landscape 1920x1080 utk YouTube, auto-thumbnail
  // (thumbnail.ts, sudah ada) baru relevan dipakai kalau orientasi ini "landscape".
  // "square" ditambahkan 2026-08-10 (PRD "AI Content Editing Engine" - Layout Landscape/
  // Vertical/Square) - utk feed IG/FB non-Reels yg masih umum pakai rasio 1:1, beda dari
  // portrait (Reels/Shorts/TikTok 9:16) & landscape (YouTube 16:9).
  videoOrientation: text("video_orientation", { enum: ["portrait", "landscape", "square"] }).notNull().default("portrait"),
  // Style Preset (2026-08-10, PRD "AI Content Editing Engine" Roadmap V3 - "AI Style
  // Preset") - SEBELUM ini cuma ADA SATU gaya editing (motion/transisi/overlay dipilih
  // AI Director TAPI selalu dari pool "energetic" yg sama, lihat stylePreset.ts) - brand
  // dgn niche beda (mis. dokumenter/edukasi vs Shorts cepat) butuh nuansa beda, bukan
  // 1 rasa utk semua. "energetic" = default (perilaku LAMA, brand yg sudah ada TIDAK
  // berubah tampilannya kalau tidak eksplisit ganti).
  stylePreset: text("style_preset", { enum: ["energetic", "documentary", "minimal"] }).notNull().default("energetic"),
  // Knowledge Base manual (2026-08-05, permintaan Agus - "setiap brand bisa mengisi
  // pengetahuan secara manual") - MELENGKAPI (bukan menggantikan) fakta otomatis dari
  // PMS/website (lihat knowledgeSite/pelangiKnowledge.ts) - utk hal yg tidak ada
  // sumbernya otomatis (mis. promo bulan ini, penekanan khusus, atau brand yg belum
  // terhubung PMS/website sama sekali). Nullable, kosong = tidak nambah apa-apa.
  manualKnowledge: text("manual_knowledge"),
  // Knowledge Base per-brand (2026-08-05, permintaan Agus - "sebaiknya ditambahkan di
  // setiap brand") - sebelumnya fetchPelangiKnowledge() (pelangiKnowledge.ts) HARDCODE
  // site="pelangi" di titik panggilnya (researchTopics.ts/generateContent.ts), tidak
  // masalah selama brand cuma 1 (Pelangi Homestay) tapi akan salah ambil fakta Pelangi
  // kalau brand Harmoni Hills ditambahkan nanti. Nullable + fallback "pelangi" di kode
  // pemanggil (bukan NOT NULL default di sini) - brand yang sudah ada (row lama) otomatis
  // tetap dapat perilaku SAMA PERSIS spt sebelumnya tanpa perlu migrasi data manual.
  knowledgeSite: text("knowledge_site"),
  // Draft vs Auto-Publish (2026-08-06, permintaan Agus - "aku juga ada fitur pilihan
  // draft atau langsung publis, jika langsung publis maka hasil generate vidio dan
  // poster langsung di kirim..., hasil generate akan diam di draft sampai jam yang di
  // tentukan tiba sistem auto publis") - default "draft" (perilaku SEKARANG, aman utk
  // brand lama tanpa migrasi data). "auto": konten TETAP digenerate/dirender sama
  // persis spt draft (lihat cron/auto-generate), CUMA beda di titik akhir - bukan
  // nunggu klik manual, publishProject() dipanggil otomatis begitu autoPublishTime
  // (WITA) tiba (lihat cron/auto-publish).
  publishMode: text("publish_mode", { enum: ["draft", "auto"] }).notNull().default("draft"),
  // JSON string[] "HH:MM" WITA, nullable - HANYA relevan kalau publishMode="auto"
  // (2026-08-06, revisi dari single autoPublishTime - permintaan Agus "auto publis mau
  // di publis jam brapa aja menyesuaikan dengan jumlah konten yang ada"). Beberapa jam
  // slot, BUKAN cuma satu - cron/auto-publish publish 1 konten "ready" per slot yg sudah
  // lewat & belum kepakai hari itu (lihat cron/auto-publish), jadi konten tersebar
  // sepanjang hari sesuai berapa banyak slot yg di-set, bukan numpuk di 1 jam. Validasi
  // format di route.ts PATCH.
  autoPublishTimes: text("auto_publish_times"),
  // Brand Design Profile (2026-08-06, permintaan Agus - "Brand Design System Prompt...
  // Master Prompt + Brand Profile terpisah per brand") - SEBELUM ini palet warna/font/
  // ikon/tone poster HARDCODE 1 gaya (hijau emerald, ikon hospitality "wifi/parking/
  // breakfast") di posterDesign.ts, dipakai SAMA utk SEMUA brand tanpa pandang bulu -
  // brand baru non-hospitality (mis. "laundry in bali") dapat poster bergaya resort
  // hijau yg sama sekali tidak relevan. Sekarang bagian yg BOLEH beda per brand (warna,
  // font, ikon relevan, tone, target audiens, aturan foto) dipisah ke sini - bagian
  // struktural/kualitas/keamanan (anti-mengarang harga/kontak/logo, aturan foto asli,
  // hierarki visual) TETAP di 1 MASTER_DESIGN_SYSTEM_PROMPT bersama (posterDesign.ts),
  // tidak diduplikasi per brand. Nullable - brand tanpa profil pakai fallback generik
  // (bukan warisan gaya Pelangi diam-diam, beda dari bug knowledgeSite yg baru
  // diperbaiki - pelajaran yg SAMA diterapkan di sini dari awal).
  posterBrandProfile: text("poster_brand_profile"),
  // Full AI-Generate Poster (2026-08-11, permintaan Agus - brand "laundry in bali":
  // "untuk konten foto laundry in bali bisa berikan sedikit kebebasan foto bisa full
  // generate ai juga, harganya sama saja") - SEBELUM ini SEMUA brand WAJIB foto ASLI
  // sbg dasar (posterDesign.ts MASTER_DESIGN_SYSTEM_PROMPT: "JANGAN membuat foto AI
  // atau memakai gambar stok" - larangan keras, ditulis sengaja utk brand hospitality
  // spy tidak menipu tamu dgn kamar palsu). Toggle ini per-brand, default FALSE (brand
  // lain/lama TIDAK berubah perilakunya sama sekali) - kalau TRUE, jalur foto/carousel
  // yang TIDAK menemukan foto asli relevan (mis. ide edukasi/tips yg tidak match Bank
  // Footage) boleh pakai poster full text-to-image (fal.ai, sama model/harga - lihat
  // generatePosterFullAi di posterDesign.ts) drpd gagal/paksa pakai foto asli yg tidak
  // relevan.
  allowAiGeneratedPhotos: integer("allow_ai_generated_photos", { mode: "boolean" }).notNull().default(false),
  // Izinkan Logo/Identitas di Konten AI (2026-09-06, permintaan Agus - "jangan berisi
  // logo kecuali owner minta logo dilampirkan") - DEFAULT semua brand: prompt poster
  // (posterDesign.ts, SHARED_STRUCTURAL_RULES bagian LOGO) MELARANG KERAS AI menaruh
  // elemen apa pun yang menyerupai identitas/logo/badge (termasuk ikon generik spt
  // Instagram/TikTok yang mengisi ZONA LOGO reserved) - ditemukan dari kasus nyata
  // poster AgustaP Studio (QC gagal krn ikon medsos di pojok kanan-atas, memicu 1x
  // auto-fix = 2x biaya generate gambar). Toggle ini per-brand, default FALSE (brand
  // lain TIDAK berubah perilakunya) - kalau TRUE, brand SECARA SADAR mengizinkan AI
  // menyertakan elemen logo/identitas di gambar yg di-generate (larangan LOGO di
  // prompt dilonggarkan utk brand ini), staf WAJIB isi `logoInContentNote` sbg bukti
  // brand sudah diberi tahu & setuju konsekuensi biaya (lihat catatan di sana).
  allowLogoInAiContent: integer("allow_logo_in_ai_content", { mode: "boolean" }).notNull().default(false),
  // Catatan wajib saat allowLogoInAiContent=true (2026-09-06) - bukan cuma checkbox
  // kosong, staf HARUS menuliskan alasan/konfirmasi (mis. "Owner AgustaP sudah setuju
  // biaya generate 2x krn butuh ikon medsos di desainnya") - jejak audit kenapa brand
  // ini boleh keluar dari default aman, & mengingatkan staf sendiri saat centang ini
  // konsekuensinya biaya kredit/token generate gambar bisa 2x lipat (auto-fix QC lebih
  // sering jalan kalau logo/identitas sengaja diizinkan tampil). Nullable - kosong
  // kalau toggle di atas FALSE (tidak relevan).
  logoInContentNote: text("logo_in_content_note"),
  // Content Pillar Override (2026-08-11, permintaan Agus - brand "laundry in bali":
  // "aku mau kembangkan jenis kontennya ada konten edukasi dan tips... aku mau juga
  // konsumen mendapat konten jualan") - SEBELUM ini pilar konten HANYA py 2 opsi:
  // PELANGI_PILLARS (hardcode, khusus knowledgeSite="pelangi") atau GENERIC_PILLARS
  // (4 pilar generik 25% rata utk SEMUA brand lain tanpa pandang bulu - laundry in
  // bali PUNYA target pilar sendiri yg SUDAH ditulis di manualKnowledge-nya, "40%
  // Edukasi/30% Aktivitas/20% Promosi/10% Testimoni", tapi kode TIDAK PERNAH
  // membacanya). Nullable JSON `{pillars: string[], targetPercent: Record<string,
  // number>}` - null/kosong = perilaku LAMA (generic/pelangi), brand lain TIDAK
  // terpengaruh. Field TERPISAH dari manualKnowledge (sama alasan posterBrandProfile
  // dipisah dari manualKnowledge - data terstruktur yg dibaca kode, bukan teks bebas
  // yg cuma jadi konteks prompt).
  contentPillars: text("content_pillars"),
  // Experiment Engine (2026-08-25, PRD "AI Konten Intelligence & Agency Upgrade" §24 -
  // "70% proven, 20% variation, 10% experiment... persentase harus configurable") -
  // Nullable JSON `{proven: number, variation: number, experiment: number}` (persen,
  // jumlah 100) - null = default 70/20/10 diterapkan DI KODE (lihat contentVariety.ts),
  // sama pola bootstrap-tanpa-UI-dulu dgn field lain di sini (mis. stylePreset sebelum
  // punya default eksplisit) - brand lama TIDAK berubah perilakunya sampai field ini
  // eksplisit diisi.
  experimentRatio: text("experiment_ratio"),
  // Content DNA (2026-08-26, PRD "AI Konten Intelligence & Agency Upgrade" §4) - 10 field
  // identitas brand yg SEBELUM ini tidak py kolom sendiri (cuma bisa nyempil sbg teks
  // bebas di manualKnowledge kalau Agus kebetulan nulisnya). Nullable & simple text (BUKAN
  // JSON terstruktur/enforced) - PRD §38 eksplisit "data adalah guidance, bukan aturan
  // mutlak", jadi field ini murni konteks tambahan yg dibaca prompt (buildKnowledgeGroundingBlock
  // di generateContent.ts & brandContext di contentIntelligence.ts's judgeCreativeQuality),
  // bukan nilai yg divalidasi/dihitung di kode. eduEntertainmentRatio SENGAJA teks bebas
  // (mis. "70% edukasi, 30% hiburan"), bukan 2 kolom integer terpisah - sama alasan.
  niche: text("niche"),
  targetAudience: text("target_audience"),
  positioning: text("positioning"),
  contentGoals: text("content_goals"),
  toneOfVoice: text("tone_of_voice"),
  preferredTopics: text("preferred_topics"),
  prohibitedTopics: text("prohibited_topics"),
  contentBoundaries: text("content_boundaries"),
  eduEntertainmentRatio: text("edu_entertainment_ratio"),
  ctaStyle: text("cta_style"),
  // Service Catalog (2026-09-02, PRD "Agustap Studio Content Clarity") - JSON:
  // {serviceDescription, packages: [{name, price, features}], commonFeatures, addOns}.
  // Source of truth WAJIB data nyata (repo agustalugra-12/webagustapstudio, halaman
  // Pricing.tsx) - TIDAK PERNAH dikarang AI. Nullable, brand lain (Pelangi/Laundry/
  // Animal Story) tidak pernah mengisi kolom ini, sama pola dgn kolom Agustap lain
  // (content_pillars, content_boundaries) - extend tabel existing, bukan tabel baru.
  serviceCatalog: text("service_catalog"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// publishVia distinguishes native API platforms (Instagram/Facebook/YouTube - work in
// developer/tester mode without full App Review since Agus only connects his own brand
// accounts) from Buffer-mediated platforms (TikTok - unaudited direct API only allows
// SELF_ONLY private posts, so Buffer's already-audited partner access is used instead).
export const socialAccounts = sqliteTable("social_accounts", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  platform: text("platform", {
    enum: ["instagram", "facebook", "tiktok", "youtube"],
  }).notNull(),
  publishVia: text("publish_via", { enum: ["native", "buffer"] }).notNull(),
  username: text("username").notNull(),
  // ID akun di platform (IG Business Account ID utk instagram, Page ID utk facebook,
  // channel ID utk youtube) - WAJIB per-akun, BUKAN env var global, krn app ini
  // multi-brand (lihat PRD diskusi): tiap brand kelola akun IG/FB/YouTube-nya SENDIRI,
  // bukan satu akun bersama utk semua brand.
  platformAccountId: text("platform_account_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: integer("token_expires_at", { mode: "timestamp" }),
  bufferChannelId: text("buffer_channel_id"),
  // Cache metrik analitik (2026-08-07, permintaan Agus - "analitik diperbaharui 2x
  // sehari saja, ini tidak berubah setiap saat datanya") - SEBELUM ini endpoint
  // analitik manggil Buffer API LANGSUNG tiap kali dashboard dibuka/refresh, TANPA
  // caching sama sekali (ikut jadi penyebab nyata kuota 250-request/hari Buffer abis -
  // buka dashboard berkali-kali = request berkali-kali, padahal komentar
  // performanceLearning.ts sendiri sudah bilang "metrik Buffer sendiri jg tidak
  // update real-time"). cachedMetricsAt null/lawas (>12 jam) -> baru fetch API asli.
  cachedMetrics: text("cached_metrics"),
  cachedMetricsAt: integer("cached_metrics_at", { mode: "timestamp" }),
  // Soft-disconnect (2026-08-09, permintaan Agus - channel Facebook "laundry in bali"
  // putus di sisi Buffer sendiri ["Channel not found" di tiap publish, dicek langsung
  // ke Buffer API - channel-nya beneran hilang dari daftar channel org itu], bukan
  // masalah kuota). connected=false (BUKAN row dihapus, pola sama persis dgn
  // platformPolicies.enabled di atas) - publishProject() (orchestrate.ts) skip akun
  // ini SEPENUHNYA (tidak masuk hitungan accounts.length), jadi IG/TikTok brand yg
  // sama bisa selesai "published" bersih tanpa nyangkut nunggu FB yg memang belum bisa
  // dicoba lagi sampai Agus reconnect manual di buffer.com. 49 publishLogs historis
  // akun ini (termasuk publish sukses sebelum putus) TETAP disimpan, tidak ikut
  // terhapus - riwayat audit tetap ada, cuma berhenti dijalankan.
  connected: integer("connected", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// One project = one piece of content (video or carousel) from raw footage through to
// published post. script is the brief/outline Agus provides that drives automatic clip
// selection + caption generation - NOT a manual editing step, just the creative input.
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  type: text("type", { enum: ["video", "carousel", "caption"] }).notNull(),
  // Format spesifik dalam tipe "video" (2026-08-10, fitur YT Shorts - lihat catatan
  // brands.dailyYoutubeShortsCount) - null = video biasa (pakai orientasi/durasi brand
  // apa adanya), "youtube_shorts" = processProject.ts PAKSA portrait + <=60dtk apa pun
  // setting brand, & publish ke YouTube disertai tanda #Shorts. Nullable, khusus video -
  // carousel/foto tidak relevan sama sekali dgn field ini.
  contentFormat: text("content_format"),
  // "partial" (2026-08-07, permintaan Agus - "yang berhasil di uploud ke tiktok saja
  // sedangkan fb dan ig gagal agar nanti di uploud ulang") - SEBELUM ini status cuma
  // "published" (kalau ADA SATU akun sukses, walau akun lain gagal) atau "failed" -
  // publish yg gagal sebagian jadi kelihatan "published" (dianggap selesai), platform
  // yg gagal TIDAK PERNAH dicoba ulang, walau publishLogs per-akun sudah benar mencatat
  // gagal/sukses-nya. "partial" = ada yg sukses TAPI belum SEMUA akun - dicoba ulang
  // otomatis (lihat orchestrate.ts + cron/auto-publish.ts), akun yg SUDAH sukses tidak
  // pernah dipublish ulang (idempotent per-akun, cek publishLogs yg sudah ada).
  // "scheduled" (2026-08-25, PRD §26 Manual Scheduling) - draft yg sudah "ready" TAPI
  // Agus pilih tanggal/jam tertentu di masa depan lewat scheduledFor (bukan publish
  // manual sekarang, bukan pula ikut slot brand.autoPublishTimes yg recurring) -
  // cron/auto-publish.ts cek status ini TERPISAH dari loop slot per-brand yg sudah ada,
  // apa pun brand.publishMode-nya (keputusan one-off staf, bukan preferensi brand).
  // Enum di sini TETAP cuma hint TypeScript (kolom DB TEXT polos, sama pola dgn
  // pillar/angle) - menambah nilai baru TIDAK butuh migrasi utk row lama.
  status: text("status", {
    enum: ["uploaded", "processing", "ready", "publishing", "published", "partial", "failed", "scheduled"],
  })
    .notNull()
    .default("uploaded"),
  // skipAutoPublish (2026-08-10, permintaan Agus - "regenerasi 5 video yang gagal,
  // diamkan di draft, jangan auto upload... untuk video yang di-generate nanti
  // biarkan lolos auto upload") - project INI TETAP status "ready" (tetap tampil di
  // Draft Review buat direview manual, publish MANUAL via tombol tetap jalan normal)
  // tapi DIKECUALIKAN dari seleksi cron/auto-publish.ts (lihat filter di situ) -
  // brand.publishMode="auto" TETAP jalan apa adanya utk project BARU lain (flag ini
  // per-project, bukan ubah setting brand yg akan mempengaruhi SEMUA project).
  // Dipakai scripts/regen-narration.ts utk tandai video hasil regenerasi batch lama.
  skipAutoPublish: integer("skip_auto_publish", { mode: "boolean" }).notNull().default(false),
  script: text("script"),
  transcript: text("transcript"), // JSON: Whisper segments [{start,end,text}]
  clipSelection: text("clip_selection"), // JSON: chosen segments + heuristic scores
  generatedCaption: text("generated_caption"),
  generatedHashtags: text("generated_hashtags"), // JSON array as text
  // Content Pillar & Duplicate Checker (2026-08-05, PRD "AI Content Brain" modul 6 & 11,
  // permintaan Agus) - diklasifikasi AI SEKALI saat caption/hashtag digenerate (bukan
  // panggilan terpisah, lihat generateContent.ts) - dipakai dailyContentPlanner.ts utk
  // liat distribusi ASLI konten yg SUDAH dibuat (bukan cuma teks skrip mentah), supaya
  // ide/pilar berikutnya benar2 diarahkan ke yg jarang dipakai, bukan cuma "kelihatan
  // beda" dari sisi kalimat. Nullable - project lama (sblm fitur ini) tetap null, tidak
  // retroaktif diklasifikasi.
  // Enum literal DIHAPUS (2026-08-10, bug pilar hardcode - lihat catatan pillarsForSite
  // di generateContent.ts) - daftar pillar yg valid sekarang beda per brand (Pelangi
  // vs generik), jadi enum TS-level tetap ke 5 nilai lama sudah tidak akurat. Kolom DB
  // sendiri TEXT polos, enum di sini SELALU cuma hint TypeScript (tidak pernah jadi
  // constraint DB sungguhan) - melebarkan ke string bebas TIDAK butuh migrasi.
  pillar: text("pillar"),
  angle: text("angle", {
    enum: ["harga", "lokasi", "fasilitas", "suasana", "target_tamu", "momen", "faq", "perbandingan"],
  }),
  // Hook Type & Structure Rotation (2026-08-14, PRD "AI Content Intelligence" Fase 1 -
  // lihat spec docs/superpowers/specs/2026-08-14-content-diversity-engine-design.md).
  // hookType: klasifikasi kategori hook/pembuka (11 nilai tetap, lihat HOOK_TYPES di
  // generateContent.ts) - TEXT polos sama pola dgn pillar/angle di atas, tracking-only,
  // tidak membatasi generation. structureTemplate: nama template narasi yg dipakai
  // (lihat VIDEO_STRUCTURE_TEMPLATES/LONG_FORM_STRUCTURE_TEMPLATES) - field ini SUDAH
  // digenerate sejak 2026-08-05 tapi TIDAK PERNAH disimpan sampai sekarang (dibuang
  // begitu processProject.ts selesai memakainya sekali) - kolom ini menutup gap itu,
  // dibutuhkan supaya contentVariety.ts bisa membaca histori pemakaian struktur.
  hookType: text("hook_type"),
  structureTemplate: text("structure_template"),
  // Content Brief (2026-08-26, PRD §12, Task Plan 6) - 4 field, semua nullable, dirakit
  // jadi 1 objek Content Brief di GET /api/projects/[id]/brief (TIDAK ada tabel/AI call
  // baru - lihat catatan lengkap di route itu). ideaScore/ideaReasoning dari
  // daily_ideas.score/reasoning yg SEBELUM ini dibuang begitu ide jadi project (lihat
  // autoContent.ts). visualDirection/ctaText BARU - diminta bareng generateCaptionAndHashtags/
  // generateCaptionForImages (generateContent.ts), 1 panggilan yg SAMA, bukan panggilan baru.
  ideaScore: integer("idea_score"),
  ideaReasoning: text("idea_reasoning"),
  visualDirection: text("visual_direction"),
  ctaText: text("cta_text"),
  // Retention Intelligence (2026-08-26, PRD §14, Task Plan 7) - JSON string[], nullable
  // (jalur foto/carousel/YouTube Editorial tidak relevan, lihat retentionIntelligence.ts).
  retentionRisks: text("retention_risks"),
  // Content Type Taxonomy (2026-08-14, PRD "AI Content Intelligence" Fase 1 - TIER 1,
  // lihat docs/TIER_0_VERIFICATION_REPORT.md & spec) - TERPISAH dari pillar (business
  // topic) & angle (content angle). Type = format/structure konten (Educational, How-to,
  // Listicle, dst) - dipakai diversity engine supaya tidak monoton (mis. 10 Educational
  // berturut walau pillar beda). Nullable - existing 210 projects tetap valid NULL, new
  // projects diklasifikasi GPT bareng pillar/angle/hookType (1 call, no extra cost).
  // FK ke content_types (extensible table, bukan enum hardcode - type baru bisa ditambah
  // tanpa code change, lihat seed-content-types.ts). normalizeContentType() fail-soft
  // (null kalau invalid) - TIDAK mengganggu pillar/angle/hookType classification lain.
  contentTypeId: text("content_type_id").references(() => contentTypes.id),
  // Keyword Priority & Search Intent Engine (2026-08-05, PRD modul 4 & 9, permintaan
  // Agus) - keyword TARGET SEO (dari daftar prioritas Level 1/2/3 persis PRD, lihat
  // keywordPriority.ts) yg paling didukung konten ini, diklasifikasi bareng
  // pillar/angle (1 panggilan GPT yg sama, tidak ada biaya tambahan). Nullable -
  // konten yg genuinely tidak menargetkan keyword spesifik apa pun (mis. cuma
  // suasana umum) boleh null, tidak dipaksa.
  targetKeyword: text("target_keyword"),
  keywordLevel: integer("keyword_level"), // 1, 2, atau 3 - null kalau targetKeyword null
  // AI Learning Engine (2026-08-05, PRD modul 13, permintaan Agus - "AI membaca View/
  // Like/Share/Comment/Watch Time/CTR, belajar konten mana yg paling disukai"). Diisi
  // performanceLearning.ts, SUM lintas semua publish_logs project ini (bisa >1 platform)
  // - fetch REAL dari Buffer GraphQL (Post.metrics, diverifikasi live via introspeksi
  // SEBELUM dibangun - views/reach/reactions/shares/engagementRate BENAR ada per-post,
  // bukan cuma agregat akun). Nullable - project blm published/blm disync tetap null.
  performanceViews: integer("performance_views"),
  performanceEngagementRate: integer("performance_engagement_rate"), // x100 (mis. 1.25% disimpan 125) - SQLite INTEGER, hindari float rounding
  performanceSyncedAt: integer("performance_synced_at", { mode: "timestamp" }),
  // Duplicate/Repetition Detector (2026-08-08, PRD "YouTube Content & Monetization
  // Safety System" Section 9-10 "Originality Engine" & "Duplicate/Repetition
  // Detector") - captionEmbedding (JSON number[] dari OpenAI text-embedding-3-small)
  // dihitung SEKALI begitu caption/naskah final digenerate (processProject.ts),
  // dibandingkan (cosine similarity) ke project VIDEO terakhir brand yg sama -
  // similarityScore (x100, sama pola dgn performanceEngagementRate di atas) & project
  // paling mirip disimpan utk visibilitas.
  //
  // SENGAJA WARNING-ONLY dulu (skor disimpan, TIDAK memblokir generate) - PRD minta
  // "BLOCK GENERATION" begitu similarity > threshold, TAPI belum ada data nyata sama
  // sekali utk kalibrasi angka threshold yang aman (lihat pola yang SAMA di
  // web-pelangi/backend/scripts/seo_agent.py: cannibalization check di sana perlu "3
  // revisi empiris" sebelum threshold-nya benar - flat threshold pertama SALAH-TOLAK
  // 88% keyword yang sebenarnya angle beda). Memblokir generate harian tanpa kalibrasi
  // beresiko menghentikan produksi konten Agus tanpa alasan nyata. Fase berikutnya
  // (setelah cukup data similarityScore riil terkumpul) baru dipertimbangkan jadi hard
  // block, bukan sekarang.
  captionEmbedding: text("caption_embedding"), // JSON number[], null kalau belum sempat dihitung (mis. API embedding gagal)
  similarityScore: integer("similarity_score"), // cosine similarity (0-1) x100 -> disimpan 0-100
  similarToProjectId: text("similar_to_project_id"),
  // Fact Check Engine (2026-08-08, PRD Section 12) - lihat factCheck.ts utk penjelasan
  // lengkap arsitektur (cross-check ke KB brand sendiri via GPT, bukan search API
  // berbayar - konsisten dgn filosofi app ini). null (bukan 100) kalau brand tidak
  // punya Knowledge Base sama sekali - tidak ada apa pun yang dicek, beda makna dari
  // "sudah dicek & lolos semua klaim". SENGAJA WARNING-ONLY sama alasan persis dgn
  // similarityScore di atas.
  factCheckConfidence: integer("fact_check_confidence"), // 0-100, null = tidak dicek (brand tanpa KB)
  factCheckFlags: text("fact_check_flags"), // JSON string[] kutipan klaim tak-didukung, null/[] kalau tidak ada masalah
  // YouTube Editorial Engine (2026-08-10, PRD Agus "YouTube Long Form Content Engine" +
  // "YouTube Shorts Engine", dibuat REUSABLE - "siapa tau aku mau buat channel lain",
  // bukan hardcode Animal Story & Co) - Nullable, HANYA diisi utk project yg lewat
  // youtubeEditorial.ts (channel yg py channelProfiles dikonfigurasi, lihat
  // dailyContentPlanner.ts) - project IG/TikTok/brand tanpa channel YouTube TIDAK
  // PERNAH menyentuh 2 kolom ini, tetap null spt sekarang.
  youtubeSeriesId: text("youtube_series_id").references(() => youtubeSeries.id),
  // JSON: {titles: string[], selectedTitleIndex: number, thumbnailConcepts: [{subject,
  // expression, text, background, trigger}], seoDescription: string, seoKeywords:
  // {primary, secondary: string[], related: string[], longtail: string[]}, hashtags:
  // string[], tags: string[], chapters: [{time: string, label: string}], parentProjectId
  // (nullable, Shorts hasil repurpose dari long-form ini menunjuk balik ke induknya)}.
  // 1 kolom JSON (bukan 10+ kolom baru) - konsisten dgn pola generatedHashtags/
  // manualKnowledge/channelProfiles.contentPillars di app ini, field2 ini SEMUA cuma
  // relevan utk video YouTube (bukan bagian universal projects spt pillar/angle).
  youtubeMetadata: text("youtube_metadata"),
  errorMessage: text("error_message"),
  // Auto-Fix Ladder (2026-08-12, Fase 2b PRD Animal Story & Co section 9/10/21/22/42 -
  // "jangan reject, coba perbaiki dulu") - tiap kali sebuah reject-point mencoba
  // strategi degradasi (broaden keyword B-roll, turunkan target durasi, dst) SEBELUM
  // benar2 gagal, dicatat di sini. autoFixAttempts = hitungan sederhana utk dashboard
  // ("X dari Y video hari ini butuh auto-fix"), autoFixLog = JSON array
  // [{step, action, result}] utk detail/audit. Nullable (BUKAN notNull+default - SQLite
  // ALTER TABLE ADD COLUMN NOT NULL di tabel 164 baris memicu drizzle-kit rebuild
  // penuh & sempat gagal FK constraint saat dicoba - nullable = ALTER simpel, kode baca
  // `?? 0` di titik pakai) - project lama tanpa auto-fix apa pun tetap null, bukan
  // regresi.
  autoFixAttempts: integer("auto_fix_attempts"),
  autoFixLog: text("auto_fix_log"), // JSON array: [{step, action, result}]
  // Manual Per-Post Scheduling (2026-08-25, PRD §26) - diisi lewat POST
  // /api/projects/[id]/schedule (lihat DraftReview.tsx tombol "Jadwalkan"), dibaca
  // cron/auto-publish.ts. Nullable - hanya terisi utk project yg SENGAJA dijadwalkan
  // manual, mayoritas project (draft/auto-publish-mode biasa) tetap null selamanya.
  scheduledFor: integer("scheduled_for", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  type: text("type", {
    // "thumbnail" - foto sampul custom utk YouTube saja (satu2nya platform yg punya
    // slot thumbnail terpisah dari videonya) - lihat lib/ai/thumbnail.ts.
    // "broll_used" - CATATAN historis klip Pexels/Pixabay yg sudah dipakai project ini
    // (2026-08-05, permintaan Agus - "footage pexels jangan monoton, TikTok anggap
    // konten berulang") - dibaca lib/ai/footageVariety.ts utk MENGHINDARI klip B-roll
    // yg sama dipakai berulang di video berikutnya. Bukan aset yg ditampilkan di UI,
    // murni riwayat internal.
    // "thumbnail_candidate" (2026-08-26, PRD §15, Task Plan 7) - kandidat frame thumbnail
    // dari bagian hook video, SEMUANYA disimpan (bukan cuma yg terpilih) supaya Agus bisa
    // override manual di Draft Review - lihat thumbnailScoring.ts. Kolom TS-hint saja
    // (TEXT polos di DB), aman ditambah tanpa migrasi data lama.
    enum: ["raw_footage", "final_video", "final_image", "subtitle_file", "thumbnail", "broll_used", "thumbnail_candidate"],
  }).notNull(),
  fileUrl: text("file_url").notNull(),
  durationSeconds: integer("duration_seconds"),
  // Thumbnail Scoring (2026-08-26, PRD §15, Task Plan 7) - nullable, HANYA diisi utk
  // type="thumbnail_candidate" (skor AI 0-100 + alasan singkat, lihat thumbnailScoring.ts).
  score: integer("score"),
  scoreReasoning: text("score_reasoning"),
  // Lisensi/asal aset (2026-08-08, PRD "YouTube Content & Monetization Safety System"
  // Section 16 "Footage License Tracking") - SEBELUM ini fileUrl broll_used tersimpan
  // TANPA jejak sumber/lisensi/kreator sama sekali (dicek langsung ke kode, kosong) -
  // kalau suatu saat ada sengketa copyright/audit monetisasi YouTube, tidak ada cara
  // menelusuri dari mana & lisensi apa suatu klip berasal. Nullable - SEMUA aset lama
  // (raw_footage/final_video/dst, dan broll_used sebelum kolom ini ada) tetap null,
  // tidak retroaktif. Cuma diisi utk broll_used ke depannya (lihat broll.ts).
  source: text("source", { enum: ["pexels", "pixabay"] }),
  sourceCreator: text("source_creator"), // nama fotografer/kreator asli dari API sumber
  sourceUrl: text("source_url"), // link halaman asal video di situs sumber (bukan CDN file url)
  sourceQuery: text("source_query"), // keyword pencarian yg menghasilkan aset ini - jejak audit
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Separate from analytics (below) - this tracks WHETHER/WHEN a project got published to
// a given account. Publish is now a manual step triggered from draft review (see
// DraftReview.tsx / processProject.ts, changed 2026-08-04) - this table is written by
// publishProject() regardless of whether it was triggered manually or (previously)
// automatically. Telegram notification is sent per row here after every publish attempt
// so Agus can react fast even without watching the dashboard.
export const publishLogs = sqliteTable("publish_logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  socialAccountId: text("social_account_id").notNull().references(() => socialAccounts.id),
  status: text("status", { enum: ["pending", "success", "failed"] })
    .notNull()
    .default("pending"),
  platformPostId: text("platform_post_id"),
  errorMessage: text("error_message"),
  telegramNotifiedAt: integer("telegram_notified_at", { mode: "timestamp" }),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  // Platform Normalization (2026-08-26, PRD §18, Task Plan 3) - metrik PER-PLATFORM,
  // nullable. SEBELUM ini performanceLearning.ts's syncProjectPerformance() sudah fetch
  // metrik ini PER LOG (per akun/platform) tapi cuma dijumlah ke projects.performanceViews
  // (total gabungan semua platform) lalu dibuang - baseline-per-platform BUTUH angka
  // per-platform asli, bukan total gabungan (1 project bisa tayang ke 2+ platform
  // sekaligus dgn skala views yg beda jauh, tidak bisa di-baseline dari angka gabungan).
  views: integer("views"),
  engagementRate: integer("engagement_rate"), // x100 spt projects.performanceEngagementRate
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Daily performance snapshot per connected account (followers/views/likes) - separate
// from publish_logs since this is periodic polling, not tied to a single publish event.
export const analytics = sqliteTable("analytics", {
  id: text("id").primaryKey(),
  socialAccountId: text("social_account_id").notNull().references(() => socialAccounts.id),
  followers: integer("followers"),
  views: integer("views"),
  likes: integer("likes"),
  dateRecorded: text("date_recorded").notNull(), // YYYY-MM-DD
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// "Storyboard Engine" - shot list PRA-produksi (dibaca Agus SEBELUM syuting, lihat
// memory proyek) - BUKAN bagian dari pipeline upload->process yg sudah ada, ini
// langkah terpisah sebelumnya. Disimpan (bukan sekali-pakai) biar bisa dibuka lagi
// pas syuting.
export const storyboards = sqliteTable("storyboards", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  script: text("script").notNull(),
  scenes: text("scenes").notNull(), // JSON: StoryboardScene[] (lihat lib/ai/storyboard.ts)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Kategori Footage Bank (2026-08-06, permintaan Agus - "aku mau ada folder katagori
// didalamnya sehingga ada pengelompokan yang jelas seperti taman halaman, kamar, dapur,
// dan lainnya") - manual, per BRAND (bukan global, krn tipe kamar Pelangi vs Harmoni
// beda). SEBAB langsung permintaan ini: matchFootageForScript (lihat matchFootageBank.ts)
// SELAMA INI murni cocokkan teks deskripsi/tag AI vs skrip - deskripsi "kamar tidur,
// sprei putih" utk Room Standard & Cottage bisa terlihat MIRIP di teks meski beda kamar
// fisik, jadi skrip "Day Use Room Standard" bisa kepilih foto Cottage tanpa sinyal
// struktural apa pun yg membedakan - kategori manual ini jadi sinyal ground-truth yg
// tidak bisa disalahartikan AI.
export const footageCategories = sqliteTable("footage_categories", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// "Footage Bank" - beda dari media_assets (yg terikat ke SATU project) - ini milik
// BRAND, dipakai ULANG lintas banyak konten (lihat memory proyek: Agus syuting sekali
// - kamar, pemandangan, dll - lalu AI pilih sendiri yg cocok per skrip baru, bukan
// upload baru tiap kali). description/tags di-generate AI otomatis via vision saat
// upload (lihat lib/ai/describeFootage.ts) - Agus tidak perlu ketik apa pun.
export const footageBank = sqliteTable("footage_bank", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  mediaType: text("media_type", { enum: ["video", "image"] }).notNull(),
  fileUrl: text("file_url").notNull(),
  description: text("description").notNull(),
  tags: text("tags").notNull(), // JSON string[]
  durationSeconds: integer("duration_seconds"),
  // Kategori manual owner (2026-08-06) - NULLABLE sengaja (44 footage lama Pelangi belum
  // dikategorikan, tidak boleh dipaksa migrasi/nebak otomatis - Agus assign manual lewat
  // UI Bank Footage, lihat FootageBankDialog.tsx). null = "belum dikategorikan", tetap
  // ikut proses matching biasa (fallback penuh ke deskripsi/tag spt sebelumnya).
  categoryId: text("category_id").references(() => footageCategories.id),
  // Thumbnail statis utk video (2026-08-06, laporan Agus - "vidio berputar terus" di
  // Bank Footage) - akar masalah: dialog render SEMUA <video> sekaligus dgn
  // preload="metadata" TANPA poster, file footage asli sering 40-90MB - browser coba
  // fetch metadata BANYAK video besar bersamaan, terlihat spinner tanpa henti (bukan
  // hang beneran, cuma antrian bandwidth). Fix: frame JPG statis (extractVideoFrame,
  // SUDAH dihitung skalian saat upload utk analisis AI vision - dulu dibuang stlh
  // dipakai sekali, sekarang disimpan biar dipakai ulang sbg <video poster>) + dialog
  // ganti preload="none" (video BENERAN cuma di-load kalau user klik play). NULL utk
  // foto (tidak relevan) & video lama sblm fix ini (backfill terpisah).
  posterUrl: text("poster_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// "Music Bank" (2026-08-10, PRD "AI Content Editing Engine" - permintaan Agus) - musik
// latar utk AI Director. Pexels/Pixabay TIDAK PUNYA API musik sama sekali (dicek
// langsung ke docs resmi keduanya sebelum desain ini - cuma API foto/video), jadi BEDA
// dari footageBank yg diisi otomatis dari search API eksternal - Music Bank ini SELALU
// upload manual Agus (mirip pola lama footage lokal sebelum ada footage-bank search).
// mood BUKAN AI-generated (beda dari description/tags footageBank via vision) - Agus
// pilih sendiri saat upload (dropdown terbatas, lihat MusicMood di aiDirector.ts),
// krn mood musik itu penilaian subjektif/selera, bukan sesuatu yg bisa diturunkan
// akurat dari analisis audio otomatis dgn biaya proporsional utk skala app ini.
export const musicBank = sqliteTable("music_bank", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  fileUrl: text("file_url").notNull(),
  title: text("title").notNull(),
  mood: text("mood", { enum: ["calm", "mysterious", "upbeat", "dramatic", "neutral"] }).notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// AI Content Planner (2026-08-05, permintaan Agus, PRD "AI Content Brain" modul 10 -
// "setiap pagi AI membuat 10 ide") - batch 10 ide/hari, DIGENERATE SEKALI per hari
// (bukan tiap kali dashboard dibuka spt fitur "Ide Konten" lama yg tetap ada terpisah)
// & DIPERSIST di sini supaya konsisten sepanjang hari itu. "date" pakai zona WITA
// (lihat researchTopics.ts todayDateWita()) - hari ganti jam 00:00 WITA, bukan UTC,
// biar cocok dgn kalender hari yg dialami Agus.
export const dailyIdeas = sqliteTable("daily_ideas", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  date: text("date").notNull(), // "YYYY-MM-DD" WITA
  idea: text("idea").notNull(),
  used: integer("used", { mode: "boolean" }).notNull().default(false),
  // Opportunity Finder (2026-08-05, PRD Agus - fitur "senjata": skor tiap ide berdasar
  // relevansi/potensi menarik/variasi/dukungan keyword prioritas, lihat
  // researchTopics.ts suggestScoredContentIdeas). Nullable - batch lama (sblm fitur
  // ini) tetap null.
  score: integer("score"), // 0-100
  reasoning: text("reasoning"),
  // Tipe konten yg disarankan (2026-08-05, permintaan Agus - "3 dibuat foto 7 dibuat
  // video") - diklasifikasi AI SEKALI bareng score/reasoning (lihat
  // suggestScoredContentIdeas), dgn jumlah persis sesuai brands.dailyVideoCount/
  // dailyCarouselCount. Dipakai isi otomatis pilihan tipe di NewProjectDialog.tsx
  // saat ide ini diklik, Agus tetap BOLEH ganti manual kalau mau.
  // Diperluas ke 3 tipe (2026-08-05, revisi Agus - "foto" [poster tunggal] dipisah
  // eksplisit dari "carousel" [BENERAN multi-foto], sebelumnya "carousel" dipakai utk
  // keduanya). Baris lama (sblm migrasi) tetap valid - nilainya cuma "video"/"carousel",
  // tidak ada yg otomatis jadi "foto" tanpa sengaja.
  contentType: text("content_type", { enum: ["video", "foto", "carousel"] }),
  // Nullable, khusus contentType="video" (2026-08-10, fitur YT Shorts) - "youtube_shorts"
  // kalau ide ini dipilih dari bucket brands.dailyYoutubeShortsCount (lihat
  // dailyContentPlanner.ts getOrGenerateDailyIdeas), diteruskan ke projects.contentFormat
  // saat cron/auto-generate memproses ide ini jadi project sungguhan.
  contentFormat: text("content_format"),
  // YouTube Editorial Engine (2026-08-10) - diisi HANYA kalau ide ini datang dari
  // youtubeEditorial.ts (brand py channel YouTube dgn Editorial Policy dikonfigurasi,
  // lihat dailyContentPlanner.ts) - diteruskan apa adanya ke projects.youtubeSeriesId/
  // youtubeMetadata saat cron/auto-generate memproses ide ini jadi project sungguhan
  // (pola SAMA PERSIS dgn contentFormat di atas).
  youtubeSeriesId: text("youtube_series_id"),
  youtubeMetadata: text("youtube_metadata"),
  // Pillar/kategori (2026-08-12, Fase 1b - lihat catatan lengkap di youtubeSeries.category)
  // - diisi HANYA utk ide dari youtubeEditorial.ts (jalur generik tetap null di sini,
  // pillar-nya baru diklasifikasi belakangan saat processProject.ts memanggil
  // generateCaptionAndHashtags - beda dari jalur YouTube yg kategorinya SUDAH diketahui
  // dari awal saat idea dibuat, tidak perlu diklasifikasi ulang).
  pillar: text("pillar"),
  // Platform Fit Score (2026-08-26, PRD §19, Task Plan 5) - JSON string Record<platform,
  // 0-100>, nullable (batch lama sebelum fitur ini, atau brand tanpa akun terhubung, tetap
  // null). OBSERVATIONAL SAJA - lihat catatan lengkap di researchTopics.ts's ScoredIdea.
  platformFitScores: text("platform_fit_scores"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Bank Ide Manual (2026-08-06, permintaan Agus - "owner juga bisa menambahkan ide
// konten secara manual dsini dalam bentuk excel maupun pdf jadi akan otomatis
// disimpan dan diambil sebagai bahan konten jika sudah habis otomatis masuk ke ide
// konten yang disediakan ai setiap hari") - dikonsumsi FIFO (createdAt terlama dulu)
// SEBELUM AI generate ide baru tiap hari (lihat dailyContentPlanner.ts), bukan
// tergantikan - AI cuma isi kekurangan kalau bank ini belum cukup utk target
// harian.
export const manualIdeas = sqliteTable("manual_ideas", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  idea: text("idea").notNull(),
  source: text("source").notNull(), // nama file asal (mis. "ide-agustus.xlsx") - jejak audit, bukan dipakai logika
  used: integer("used", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  // Saved Content Inspiration (PRD Agustap Studio Content Intelligence §2.1.B, §2.16,
  // 2026-09-01) - REUSE tabel existing (`idea`=ringkasan konsep, `used`=sudah dipakai
  // generate atau belum - semantik SAMA PERSIS dgn "dapat dipilih kembali" §2.1.B).
  // Kolom NULLABLE, source="manual_excel_import" existing TIDAK terpengaruh.
  sourceUrl: text("source_url"), // link video/konten yang dianalisis (§2.13)
  inspirationPrinciples: text("inspiration_principles"), // JSON InspirationPrinciples (Phase 2 inspirationAnalyzer.ts)
  creatorName: text("creator_name"), // opsional, nama creator sumber (bukan dipakai identitas - §14/§2.21)
});

// Pencatatan token/biaya AI (2026-08-06, permintaan Agus - "cek ai blok dan ai konten
// juga agar transparan") - sama semangat dgn ai-chat-bot/db.llm_usage_log & web-pelangi
// (Mongo, sistem lain) - versi SQLite krn KontenPilot pakai drizzle/SQLite. Diisi dari
// openaiClient.ts (chat/vision, via fetch wrapper) + langsung di transcribe.ts (Whisper,
// harga per-menit bukan token) & dubbing.ts (TTS, harga per-karakter bukan token) -
// provider beda2 caranya, kolom di sini disatukan (tokens null kalau bukan model
// token-based, costUsd tetap SELALU terisi apa pun jenis pricing-nya).
export const llmUsageLog = sqliteTable("llm_usage_log", {
  id: text("id").primaryKey(),
  ts: integer("ts", { mode: "timestamp" }).notNull(),
  provider: text("provider").notNull(), // "openai" | "fal"
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  costUsd: real("cost_usd"),
  // Atribusi biaya per-brand/per-video (2026-08-12, Fase 1a PRD Animal Story & Co "100
  // video/30 hari" - prasyarat cost dashboard per-brand & budget protection, section
  // 25/38 PRD). Nullable krn (1) baris historis genuinely tidak bisa diatribusikan
  // retroaktif (tidak backfill), (2) sebagian panggilan (mis. brand-level maintenance
  // task) mungkin tidak punya projectId yang relevan. Diisi via
  // src/lib/ai/usageContext.ts (AsyncLocalStorage) di openaiClient.ts, bukan
  // diteruskan manual ke ~20 titik panggil model yang sudah ada - lihat komentar
  // lengkap di usageContext.ts.
  brandId: text("brand_id").references(() => brands.id),
  projectId: text("project_id").references(() => projects.id),
});

// Platform Policy (2026-08-08, permintaan Agus - PRD "YouTube Content & Monetization
// Safety System") - PRINSIP ARSITEKTUR INTI dari PRD ini: aturan safety/monetization
// khusus platform (BUKAN cuma YouTube - dirancang generic per platform, walau baru
// YouTube yang punya profile konkret sekarang) TIDAK PERNAH jadi toggle global
// ("Enable Monetization Safe Mode = ON" di 1 tempat) - harus otomatis AKTIF per
// brand+platform begitu brand itu connect akun platform tsb, dan TIDAK PERNAH
// memengaruhi platform lain milik brand yang sama. Baris ini di-upsert otomatis oleh
// hook di social-accounts route (lihat komentar di sana) - user TIDAK PERNAH set field
// ini manual dari UI. `enabled=false` (bukan row dihapus) saat akun didisconnect -
// riwayat kapan pernah aktif tetap ada utk audit, cuma berhenti dijalankan.
//
// PENTING: belum ada channel YouTube yang benar-benar connect di sistem ini per
// 2026-08-08 (dicek langsung ke social_accounts, kosong) - tabel ini FONDASI yang
// disiapkan LEBIH DULU (permintaan eksplisit Agus "kita siapkan dulu"), bukan reaksi
// atas bug yang sudah terjadi. Wiring penuh ke pipeline publish (gating youtube_ready)
// menyusul di fase berikutnya setelah channel beneran connect & ada data nyata utk
// diuji.
export const platformPolicies = sqliteTable("platform_policies", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  platform: text("platform", {
    enum: ["instagram", "facebook", "tiktok", "youtube"],
  }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  // Nama profile aturan yang berlaku (mis. "youtube_monetization_safe") - string bebas,
  // BUKAN enum kaku, supaya platform baru/varian profile baru tidak perlu migrasi
  // schema, cukup baris data baru.
  profile: text("profile"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Channel Profile (2026-08-08, sama PRD di atas, Section 6-8 "YouTube Content Profile"
// & "Niche System") - SENGAJA terpisah per socialAccountId (bukan per brand) krn 1
// brand bisa punya BEBERAPA channel YouTube dgn niche/audiens beda2 (PRD Section 39
// "Multiple YouTube Channels" - contoh: "YouTube Animal English" vs "YouTube Animal
// Shorts" di brand yang sama, histori/niche TIDAK BOLEH tercampur). SENGAJA TIDAK
// menyentuh/menggantikan `projects.pillar` (enum lama, khusus Pelangi Homestay,
// hardcoded 5 nilai) - itu punya sistem sendiri yang sudah jalan & teruji utk
// IG/TikTok, generalisasinya adalah kerja terpisah kalau memang dibutuhkan nanti,
// bukan bagian dari fondasi YouTube ini.
export const channelProfiles = sqliteTable("channel_profiles", {
  id: text("id").primaryKey(),
  socialAccountId: text("social_account_id").notNull().references(() => socialAccounts.id).unique(),
  primaryNiche: text("primary_niche"),
  contentPillars: text("content_pillars"), // JSON string[]
  forbiddenTopics: text("forbidden_topics"), // JSON string[]
  preferredTopics: text("preferred_topics"), // JSON string[]
  language: text("language"),
  targetCountry: text("target_country"),
  targetAudience: text("target_audience"),
  // YouTube Category ID (2026-08-10, ditemukan lewat INTROSPEKSI GraphQL Buffer -
  // metadata.youtube.categoryId "Required on create" - TANPA ini publish ke YouTube
  // lewat Buffer akan DITOLAK. String bebas (bukan enum) - Buffer sendiri cuma terima
  // ID numerik sbg string ("15"=Pets & Animals, "27"=Education, dst, daftar lengkap di
  // ChannelProfileDialog.tsx) - nullable, fallback "22" (People & Blogs, default aman
  // generik) di titik publish (lihat orchestrate.ts) kalau channel belum eksplisit pilih.
  youtubeCategoryId: text("youtube_category_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// YouTube Series (2026-08-10, PRD Agus "YouTube Long Form Content Engine" + "YouTube
// Shorts Engine" - "jangan hanya memberi tahu Claude 'buat video YouTube'... buat dia
// memiliki editorial policy dan YouTube growth strategy"). REUSABLE dari awal
// (permintaan eksplisit Agus - "reusable aja siapa tau aku mau buat channel lain"),
// BUKAN hardcode utk 1 channel/brand - jadi dikaitkan ke socialAccountId (sama pola
// scoping dgn channelProfiles di atas, 1 baris = 1 channel YouTube, brand APAPUN yg
// punya channel bisa punya seri sendiri-sendiri).
//
// Konsep "series" BARU sama sekali di app ini (beda dari CONTENT_PILLARS/keyword
// priority di web-pelangi yang cuma label kategori longgar) - PRD minta video-video
// terkait dikelompokkan sbg episode berurutan (mis. "Animal Mysteries Ep.1: Why Dogs
// Tilt Their Heads", Ep.2, dst) supaya penonton yang selesai 1 episode terdorong lanjut
// ke episode berikut (topical authority + session duration, alasan eksplisit dari PRD).
// `topics` (JSON string[]) - daftar topik/judul episode YANG DIRENCANAKAN, diisi AI saat
// series dibuat (lihat youtubeEditorial.ts) - progres "sudah sampai episode berapa"
// DIHITUNG dari COUNT projects.youtubeSeriesId = seri ini (bukan kolom counter
// terpisah yang bisa in bisa nyimpang dari kenyataan).
// Content Type Taxonomy (2026-08-14, TIER 1 - PRD "AI Content Intelligence" Fase 1)
// EXTENSIBLE table, bukan enum hardcode - type baru bisa ditambah tanpa code change
// (INSERT row baru). Seeded dgn 16 system types (Educational, How-to, Listicle, dst),
// tapi architecture support custom/additional types ke depan. Metadata fields support
// future Content Planning Engine & Performance Analytics (TIER 2/3) - field boleh null
// kalau belum digunakan, schema extensible.
export const contentTypes = sqliteTable("content_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  
  // Strategic metadata (future Content Planning Engine - TIER 2+)
  objective: text("objective"), // "educate", "convert", "engage", "entertain", "support"
  funnelStage: text("funnel_stage"), // "awareness", "consideration", "decision", "retention"
  audienceIntent: text("audience_intent"), // "learn", "compare", "decide", "explore", "solve"
  
  // Platform & format guidance
  suitablePlatforms: text("suitable_platforms"), // JSON array: ["instagram", "tiktok", "youtube"]
  
  // Content characteristics (future integration with Content Diversity Engine)
  recommendedHookFamilies: text("recommended_hook_families"), // JSON: ["curiosity", "problem", "question"]
  compatibleStructures: text("compatible_structures"), // JSON: structure template names
  ctaTendencies: text("cta_tendencies"), // "soft", "medium", "hard"
  promotionalIntensity: integer("promotional_intensity"), // 0-100
  
  // Lifecycle characteristics
  evergreenSuitability: integer("evergreen_suitability", { mode: "boolean" }).default(true),
  trendSuitability: integer("trend_suitability", { mode: "boolean" }).default(false),
  
  // Catalog metadata
  category: text("category"), // "informational", "promotional", "engagement", "support"
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const youtubeSeries = sqliteTable("youtube_series", {
  id: text("id").primaryKey(),
  socialAccountId: text("social_account_id").notNull().references(() => socialAccounts.id),
  name: text("name").notNull(),
  format: text("format", { enum: ["long", "short"] }).notNull(),
  topics: text("topics").notNull(), // JSON string[] - daftar topik episode yg direncanakan
  status: text("status", { enum: ["active", "completed", "paused"] }).notNull().default("active"),
  // Kategori/pillar yg dipakai saat seri ini dibuat (2026-08-12, Fase 1b PRD Animal
  // Story & Co - bug nyata ditemukan: pickNextCategory() MEMILIH kategori tapi TIDAK
  // PERNAH menyimpannya, jadi projects.pillar SELALU null utk jalur YouTube Editorial
  // [27/27 project nyata Animal Story & Co dicek langsung, semuanya null] - performance
  // learning yg group-by projects.pillar TIDAK PERNAH bisa hasilkan insight utk brand
  // ini apa pun datanya). Nullable - seri yg dibuat SEBELUM kolom ini ada tetap null,
  // tidak direkonstruksi retroaktif (sama prinsip dgn projects.pillar lama).
  category: text("category"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Competitor Intelligence (2026-08-19, PRD §5-8, permintaan Agus - "kerjakan tanpa API
// berbayar"). TIDAK ADA API kompetitor apa pun di sini (bukan sekadar belum diintegrasi -
// SENGAJA tidak ada, sesuai keputusan Agus soal biaya) - staf yang input observasi
// KOMPETITOR SENDIRI secara manual (nama, catatan bebas: frekuensi posting yg diamati,
// jenis konten, kira-kira followers, kekuatan/kelemahan yg terlihat). AI TIDAK PERNAH
// diminta mengarang angka/fakta kompetitor - AI cuma menganalisis/merangkum catatan staf
// ini + data performa brand sendiri jadi Content Gap & SWOT (lihat
// lib/ai/competitorAnalysis.ts) - prinsip sama dgn seluruh laporan lain di app ini: AI
// merangkum data ASLI, tidak pernah jadi sumber fakta.
export const competitors = sqliteTable("competitors", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  name: text("name").notNull(),
  notes: text("notes"), // catatan bebas staf - platform, frekuensi posting, tipe konten, dst
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  // Creator Benchmark (PRD Agustap Studio Content Intelligence §2.1.A, 2026-09-01) -
  // kolom NULLABLE, extend tabel existing (docs/REUSE_MAP.md) - brand lain yang cuma
  // pakai `notes` (SWOT/content-gap manual, competitorAnalysis.ts) TIDAK terpengaruh
  // sama sekali, kolom ini tetap null utk mereka.
  accountUrl: text("account_url"), // link akun creator (§2.11), beda dari `notes` bebas
  benchmarkProfile: text("benchmark_profile"), // JSON: {hookPattern, storytellingPattern, contentAngle, pacing, ctaPattern, visualPattern, audiencePattern} (§2.1.A)
  role: text("role"), // strength/peran creator (§2.10) - mis. "hook/attention/problem framing"
  benchmarkActive: integer("benchmark_active", { mode: "boolean" }).notNull().default(false), // Active/Inactive (§2.9, §2.16) - default false, HARUS diaktifkan eksplisit
  analyzedContentCount: integer("analyzed_content_count"), // berapa konten dianalisis saat benchmark dibuat (§2.11, target 10-20)
});

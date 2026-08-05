import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Single-admin auth (Agus only, no multi-provider/OAuth login) - see PRD discussion:
// this is a personal multi-brand tool, not a public multi-tenant SaaS. NOTE: actual
// login check is against ADMIN_PASSWORD_HASH_B64 in .env (see lib/auth.ts), NOT this
// table's password_hash column - this row exists only as the FK anchor for
// brands.user_id (one seeded row, id="user_admin", see scripts/seed-admin.mjs).
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
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
  // Durasi target video (2026-08-05, permintaan Agus - "durasi konten video misal video
  // 30 detik 60 detik dan 1.30") - dipakai processProject.ts (TARGET_VIDEO_CLIP_COUNT dkk,
  // sebelumnya hardcode target 30-60 detik) utk turunkan jumlah klip yg dikumpulkan.
  videoDurationTarget: integer("video_duration_target").notNull().default(60),
  // Berapa foto per POST carousel (2026-08-05, permintaan Agus - "carousel 3 foto,
  // carousel 5 foto dan 7 foto") - BEDA dari dailyCarouselCount (itu jumlah POST carousel/
  // hari, ini jumlah FOTO di DALAM 1 post carousel). Dipakai NewProjectDialog.tsx &
  // auto-content/route.ts (sebelumnya hardcode MAX_CAROUSEL_PHOTOS=5).
  carouselPhotosPerPost: integer("carousel_photos_per_post").notNull().default(5),
  // Orientasi video (2026-08-05, permintaan Agus - "vidio landscape atau potrait ini
  // utk kebutuhan YT") - render pipeline (ffmpeg.ts) sebelumnya hardcode portrait
  // 1080x1920 (IG/TikTok Reels) - landscape 1920x1080 utk YouTube, auto-thumbnail
  // (thumbnail.ts, sudah ada) baru relevan dipakai kalau orientasi ini "landscape".
  videoOrientation: text("video_orientation", { enum: ["portrait", "landscape"] }).notNull().default("portrait"),
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
  // "HH:MM" WITA, nullable - HANYA relevan kalau publishMode="auto". Validasi format di
  // route.ts PATCH.
  autoPublishTime: text("auto_publish_time"),
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
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// One project = one piece of content (video or carousel) from raw footage through to
// published post. script is the brief/outline Agus provides that drives automatic clip
// selection + caption generation - NOT a manual editing step, just the creative input.
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  brandId: text("brand_id").notNull().references(() => brands.id),
  type: text("type", { enum: ["video", "carousel"] }).notNull(),
  status: text("status", {
    enum: ["uploaded", "processing", "ready", "publishing", "published", "failed"],
  })
    .notNull()
    .default("uploaded"),
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
  pillar: text("pillar", {
    enum: ["Pelangi Homestay", "Wisata Sekitar", "Tips Liburan Bedugul", "Kuliner Sekitar", "Travel Tips"],
  }),
  angle: text("angle", {
    enum: ["harga", "lokasi", "fasilitas", "suasana", "target_tamu", "momen", "faq", "perbandingan"],
  }),
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
  errorMessage: text("error_message"),
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
    enum: ["raw_footage", "final_video", "final_image", "subtitle_file", "thumbnail", "broll_used"],
  }).notNull(),
  fileUrl: text("file_url").notNull(),
  durationSeconds: integer("duration_seconds"),
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
});

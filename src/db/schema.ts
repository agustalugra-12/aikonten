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
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

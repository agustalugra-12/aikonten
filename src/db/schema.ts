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
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  type: text("type", {
    enum: ["raw_footage", "final_video", "final_image", "subtitle_file"],
  }).notNull(),
  fileUrl: text("file_url").notNull(),
  durationSeconds: integer("duration_seconds"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Separate from analytics (below) - this tracks WHETHER/WHEN a project got published to
// a given account, since publish is fully automatic with no approval gate. Telegram
// notification is sent per row here (see PRD discussion: full auto, no pre-publish
// review, Telegram alert after every publish attempt so Agus can react fast).
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

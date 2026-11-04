CREATE TABLE `analytics` (
	`id` text PRIMARY KEY NOT NULL,
	`social_account_id` text NOT NULL,
	`followers` integer,
	`views` integer,
	`likes` integer,
	`date_recorded` text NOT NULL,
	`created_at` integer NOT NULL, reach integer, shares integer, engagement_rate real,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`logo_url` text,
	`daily_video_count` integer DEFAULT 7 NOT NULL,
	`daily_single_photo_count` integer DEFAULT 3 NOT NULL,
	`daily_carousel_count` integer DEFAULT 0 NOT NULL,
	`daily_youtube_shorts_count` integer DEFAULT 0 NOT NULL,
	`video_duration_target` integer DEFAULT 60 NOT NULL,
	`footage_source` text DEFAULT 'mixed' NOT NULL,
	`carousel_photos_per_post` integer DEFAULT 5 NOT NULL,
	`video_orientation` text DEFAULT 'portrait' NOT NULL,
	`style_preset` text DEFAULT 'energetic' NOT NULL,
	`manual_knowledge` text,
	`knowledge_site` text,
	`publish_mode` text DEFAULT 'draft' NOT NULL,
	`auto_publish_times` text,
	`poster_brand_profile` text,
	`allow_ai_generated_photos` integer DEFAULT false NOT NULL,
	`allow_logo_in_ai_content` integer DEFAULT false NOT NULL,
	`logo_in_content_note` text,
	`content_pillars` text,
	`experiment_ratio` text,
	`niche` text,
	`target_audience` text,
	`positioning` text,
	`content_goals` text,
	`tone_of_voice` text,
	`preferred_topics` text,
	`prohibited_topics` text,
	`content_boundaries` text,
	`edu_entertainment_ratio` text,
	`cta_style` text,
	`service_catalog` text,
	`created_at` integer NOT NULL, brand_kit text, automation_paused INTEGER NOT NULL DEFAULT 0, swot_analysis text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `channel_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`social_account_id` text NOT NULL,
	`primary_niche` text,
	`content_pillars` text,
	`forbidden_topics` text,
	`preferred_topics` text,
	`language` text,
	`target_country` text,
	`target_audience` text,
	`youtube_category_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX `channel_profiles_social_account_id_unique` ON `channel_profiles` (`social_account_id`);
CREATE TABLE `competitors` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`account_url` text,
	`benchmark_profile` text,
	`role` text,
	`benchmark_active` integer DEFAULT false NOT NULL,
	`analyzed_content_count` integer,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `content_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`objective` text,
	`funnel_stage` text,
	`audience_intent` text,
	`suitable_platforms` text,
	`recommended_hook_families` text,
	`compatible_structures` text,
	`cta_tendencies` text,
	`promotional_intensity` integer,
	`evergreen_suitability` integer DEFAULT true,
	`trend_suitability` integer DEFAULT false,
	`category` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
CREATE TABLE `credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`jumlah` integer NOT NULL,
	`alasan` text NOT NULL,
	`saldo_setelah` integer NOT NULL,
	`ref_project_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `daily_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`date` text NOT NULL,
	`idea` text NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`score` integer,
	`reasoning` text,
	`content_type` text,
	`content_format` text,
	`youtube_series_id` text,
	`youtube_metadata` text,
	`pillar` text,
	`platform_fit_scores` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `footage_bank` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`media_type` text NOT NULL,
	`file_url` text NOT NULL,
	`description` text NOT NULL,
	`tags` text NOT NULL,
	`duration_seconds` integer,
	`category_id` text,
	`poster_url` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `footage_categories`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `footage_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `llm_usage_log` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`cost_usd` real,
	`brand_id` text,
	`project_id` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `manual_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`idea` text NOT NULL,
	`source` text NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`source_url` text,
	`inspiration_principles` text,
	`creator_name` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`file_url` text NOT NULL,
	`duration_seconds` integer,
	`score` integer,
	`score_reasoning` text,
	`source` text,
	`source_creator` text,
	`source_url` text,
	`source_query` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `music_bank` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`file_url` text NOT NULL,
	`title` text NOT NULL,
	`mood` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`nama` text NOT NULL,
	`kredit_bulanan` integer NOT NULL,
	`harga_bulanan_idr` integer NOT NULL,
	`izin_auto_posting` integer DEFAULT false NOT NULL,
	`max_brand` integer DEFAULT 1 NOT NULL,
	`aktif` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
CREATE TABLE `platform_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`platform` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`profile` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`type` text NOT NULL,
	`content_format` text,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`skip_auto_publish` integer DEFAULT false NOT NULL,
	`script` text,
	`transcript` text,
	`clip_selection` text,
	`generated_caption` text,
	`generated_hashtags` text,
	`pillar` text,
	`angle` text,
	`hook_type` text,
	`structure_template` text,
	`idea_score` integer,
	`idea_reasoning` text,
	`visual_direction` text,
	`cta_text` text,
	`retention_risks` text,
	`content_type_id` text,
	`target_keyword` text,
	`keyword_level` integer,
	`performance_views` integer,
	`performance_engagement_rate` integer,
	`performance_synced_at` integer,
	`caption_embedding` text,
	`similarity_score` integer,
	`similar_to_project_id` text,
	`fact_check_confidence` integer,
	`fact_check_flags` text,
	`youtube_series_id` text,
	`youtube_metadata` text,
	`error_message` text,
	`auto_fix_attempts` integer,
	`auto_fix_log` text,
	`scheduled_for` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL, scene_manifest text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_type_id`) REFERENCES `content_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`youtube_series_id`) REFERENCES `youtube_series`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `publish_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`social_account_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`platform_post_id` text,
	`error_message` text,
	`telegram_notified_at` integer,
	`published_at` integer,
	`views` integer,
	`engagement_rate` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `social_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`platform` text NOT NULL,
	`publish_via` text NOT NULL,
	`username` text NOT NULL,
	`platform_account_id` text,
	`access_token` text,
	`refresh_token` text,
	`token_expires_at` integer,
	`buffer_channel_id` text,
	`cached_metrics` text,
	`cached_metrics_at` integer,
	`connected` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `storyboards` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`script` text NOT NULL,
	`scenes` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`nama_bisnis` text,
	`created_at` integer NOT NULL,
	`plan_id` text,
	`status` text DEFAULT 'aktif' NOT NULL,
	`periode_mulai` integer,
	`periode_berakhir` integer,
	`saldo_kredit` integer DEFAULT 0 NOT NULL, `diblokir_admin` integer DEFAULT false NOT NULL, unlimited INTEGER NOT NULL DEFAULT 0, langganan_dibatalkan INTEGER NOT NULL DEFAULT 0, nama text, nomor_wa text, setuju_at integer, dihapus_at integer, totp_secret text, totp_enabled integer NOT NULL DEFAULT 0,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
CREATE TABLE `youtube_series` (
	`id` text PRIMARY KEY NOT NULL,
	`social_account_id` text NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`topics` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`category` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE `__new_billing_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text,
	`jenis` text DEFAULT 'paket' NOT NULL,
	`kredit_topup` integer,
	`jumlah_bayar_idr` integer NOT NULL,
	`status` text NOT NULL,
	`gateway_ref` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE TABLE billing_log (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  plan_id TEXT REFERENCES plans(id),
  jenis TEXT NOT NULL DEFAULT 'paket',
  kredit_topup INTEGER,
  jumlah_bayar_idr INTEGER NOT NULL,
  status TEXT NOT NULL,
  gateway_ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE content_plan (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  date TEXT NOT NULL,
  slot_index INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL DEFAULT 'carousel',
  orientation TEXT,
  carousel_count INTEGER,
  carousel_visual TEXT,
  footage_source TEXT,
  pillar TEXT,
  hook TEXT,
  topic TEXT,
  script_brief TEXT,
  draft_caption TEXT,
  draft_hashtags TEXT,
  status TEXT NOT NULL DEFAULT 'direncanakan',
  project_id TEXT,
  scheduled_for INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, auto_mode TEXT NOT NULL DEFAULT 'manual', video_duration INTEGER);
CREATE TABLE llm_balances (id text PRIMARY KEY NOT NULL, provider text NOT NULL, amount_usd real NOT NULL, note text, created_at integer NOT NULL);
CREATE TABLE audit_log (id text PRIMARY KEY, admin_email text NOT NULL, aksi text NOT NULL, target_user_id text, detail text, created_at integer NOT NULL);

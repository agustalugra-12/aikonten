CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_email` text NOT NULL,
	`aksi` text NOT NULL,
	`target_user_id` text,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `billing_log` (
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
--> statement-breakpoint
CREATE TABLE `buffer_call_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`token_fp` text NOT NULL,
	`brand_id` text,
	`channel_id` text,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `buffer_token_state` (
	`token_fp` text PRIMARY KEY NOT NULL,
	`cooldown_until` integer,
	`reason` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`date` text NOT NULL,
	`slot_index` integer DEFAULT 0 NOT NULL,
	`content_type` text DEFAULT 'carousel' NOT NULL,
	`orientation` text,
	`carousel_count` integer,
	`video_duration` integer,
	`carousel_visual` text,
	`footage_source` text,
	`pillar` text,
	`hook` text,
	`topic` text,
	`script_brief` text,
	`draft_caption` text,
	`draft_hashtags` text,
	`status` text DEFAULT 'direncanakan' NOT NULL,
	`auto_mode` text DEFAULT 'manual' NOT NULL,
	`project_id` text,
	`scheduled_for` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `llm_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`amount_usd` real NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE `analytics` ADD `reach` integer;--> statement-breakpoint
ALTER TABLE `analytics` ADD `shares` integer;--> statement-breakpoint
ALTER TABLE `analytics` ADD `engagement_rate` real;--> statement-breakpoint
ALTER TABLE `brands` ADD `automation_paused` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `brands` ADD `brand_kit` text;--> statement-breakpoint
ALTER TABLE `brands` ADD `swot_analysis` text;--> statement-breakpoint
ALTER TABLE `users` ADD `nama` text;--> statement-breakpoint
ALTER TABLE `users` ADD `nomor_wa` text;--> statement-breakpoint
ALTER TABLE `users` ADD `setuju_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `dihapus_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `nama_bisnis` text;--> statement-breakpoint
ALTER TABLE `users` ADD `plan_id` text REFERENCES plans(id);--> statement-breakpoint
ALTER TABLE `users` ADD `status` text DEFAULT 'aktif' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `periode_mulai` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `periode_berakhir` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `saldo_kredit` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `diblokir_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `langganan_dibatalkan` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `unlimited` integer DEFAULT false NOT NULL;
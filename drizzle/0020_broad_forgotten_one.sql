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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profiles_social_account_id_unique` ON `channel_profiles` (`social_account_id`);--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE `media_assets` ADD `source` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `source_creator` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `source_query` text;
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
--> statement-breakpoint
ALTER TABLE `brands` ADD `style_preset` text DEFAULT 'energetic' NOT NULL;--> statement-breakpoint
ALTER TABLE `brands` ADD `allow_ai_generated_photos` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `brands` ADD `content_pillars` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `skip_auto_publish` integer DEFAULT false NOT NULL;
ALTER TABLE `brands` ADD `daily_youtube_shorts_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_ideas` ADD `content_format` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `content_format` text;
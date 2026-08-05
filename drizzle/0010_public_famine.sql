ALTER TABLE `brands` ADD `daily_video_count` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `brands` ADD `daily_carousel_count` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_ideas` ADD `content_type` text;
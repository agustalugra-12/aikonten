ALTER TABLE `competitors` ADD `account_url` text;--> statement-breakpoint
ALTER TABLE `competitors` ADD `benchmark_profile` text;--> statement-breakpoint
ALTER TABLE `competitors` ADD `role` text;--> statement-breakpoint
ALTER TABLE `competitors` ADD `benchmark_active` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `competitors` ADD `analyzed_content_count` integer;--> statement-breakpoint
ALTER TABLE `manual_ideas` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `manual_ideas` ADD `inspiration_principles` text;--> statement-breakpoint
ALTER TABLE `manual_ideas` ADD `creator_name` text;
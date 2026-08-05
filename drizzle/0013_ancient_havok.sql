CREATE TABLE `manual_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`idea` text NOT NULL,
	`source` text NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `brands` ADD `publish_mode` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `brands` ADD `auto_publish_time` text;
CREATE TABLE `daily_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`date` text NOT NULL,
	`idea` text NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `footage_bank` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`media_type` text NOT NULL,
	`file_url` text NOT NULL,
	`description` text NOT NULL,
	`tags` text NOT NULL,
	`duration_seconds` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `storyboards` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`script` text NOT NULL,
	`scenes` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);

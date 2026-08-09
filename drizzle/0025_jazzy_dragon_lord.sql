CREATE TABLE `youtube_series` (
	`id` text PRIMARY KEY NOT NULL,
	`social_account_id` text NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`topics` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `youtube_series_id` text REFERENCES youtube_series(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `youtube_metadata` text;
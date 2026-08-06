ALTER TABLE `brands` DROP COLUMN `auto_publish_time`;--> statement-breakpoint
ALTER TABLE `brands` ADD `auto_publish_times` text;

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_brands` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`logo_url` text,
	`daily_video_count` integer DEFAULT 7 NOT NULL,
	`daily_single_photo_count` integer DEFAULT 3 NOT NULL,
	`daily_carousel_count` integer DEFAULT 0 NOT NULL,
	`video_duration_target` integer DEFAULT 60 NOT NULL,
	`carousel_photos_per_post` integer DEFAULT 5 NOT NULL,
	`video_orientation` text DEFAULT 'portrait' NOT NULL,
	`manual_knowledge` text,
	`knowledge_site` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_brands`("id", "user_id", "name", "description", "logo_url", "daily_video_count", "daily_carousel_count", "knowledge_site", "created_at") SELECT "id", "user_id", "name", "description", "logo_url", "daily_video_count", "daily_carousel_count", "knowledge_site", "created_at" FROM `brands`;--> statement-breakpoint
DROP TABLE `brands`;--> statement-breakpoint
ALTER TABLE `__new_brands` RENAME TO `brands`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Migrasi data (2026-08-05): daily_carousel_count LAMA sebenarnya berfungsi sbg "foto
-- tunggal" (NewProjectDialog map default ke mode "photo") krn planner cuma py 2 tipe
-- saat itu. Pindahkan nilainya ke daily_single_photo_count (kolom baru) yg baru dibuat
-- di atas dgn default 3 (bukan nilai lama) - lalu timpa dgn nilai lama yg sebenarnya,
-- baru reset daily_carousel_count ke 0 (arti baru: carousel BENERAN multi-foto, belum
-- pernah dipakai brand manapun sebelum migrasi ini) - brand lama (Pelangi) perilakunya
-- PERSIS sama spt sebelum migrasi.
UPDATE `brands` SET `daily_single_photo_count` = `daily_carousel_count`, `daily_carousel_count` = 0;

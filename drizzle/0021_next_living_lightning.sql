ALTER TABLE `projects` ADD `caption_embedding` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `similarity_score` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `similar_to_project_id` text;
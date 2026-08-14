CREATE TABLE `content_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`objective` text,
	`funnel_stage` text,
	`audience_intent` text,
	`suitable_platforms` text,
	`recommended_hook_families` text,
	`compatible_structures` text,
	`cta_tendencies` text,
	`promotional_intensity` integer,
	`evergreen_suitability` integer DEFAULT true,
	`trend_suitability` integer DEFAULT false,
	`category` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `content_type_id` text REFERENCES content_types(id);
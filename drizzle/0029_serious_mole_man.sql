ALTER TABLE `llm_usage_log` ADD `brand_id` text REFERENCES brands(id);--> statement-breakpoint
ALTER TABLE `llm_usage_log` ADD `project_id` text REFERENCES projects(id);
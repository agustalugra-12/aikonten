CREATE TABLE `llm_usage_log` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`cost_usd` real
);

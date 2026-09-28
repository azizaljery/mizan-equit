CREATE TABLE `settings_history` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_status` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`last_attempt` text NOT NULL,
	`last_success` text NOT NULL,
	`detail` text NOT NULL
);

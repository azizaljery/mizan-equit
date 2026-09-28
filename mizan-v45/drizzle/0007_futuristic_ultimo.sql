CREATE TABLE `gold_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gold_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`until_ms` integer DEFAULT 0 NOT NULL,
	`token` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gold_state` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);

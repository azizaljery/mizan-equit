CREATE TABLE `accuracy_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`symbol` text NOT NULL,
	`company` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`forecast` text,
	`inputs` text,
	`outcome` text,
	`error` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	`lease_token` text DEFAULT '' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_accuracy_rows_run_ordinal` ON `accuracy_rows` (`run_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `accuracy_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_accuracy_runs_created` ON `accuracy_runs` (`created_at`);
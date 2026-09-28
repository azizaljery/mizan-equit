CREATE TABLE `admin_access` (
	`id` integer PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_started` integer DEFAULT 0 NOT NULL,
	`session_hash` text DEFAULT '' NOT NULL,
	`expires_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);

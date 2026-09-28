CREATE TABLE `recommendation_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT '' NOT NULL,
	`pin_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_started` integer DEFAULT 0 NOT NULL
);

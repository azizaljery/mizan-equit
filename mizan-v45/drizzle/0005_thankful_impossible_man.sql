CREATE TABLE `admin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`action` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_admin_audit_date` ON `admin_audit` (`created_at`);
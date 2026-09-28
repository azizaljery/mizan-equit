CREATE TABLE `paper_cash_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`cash_type` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cash_portfolio_currency` ON `paper_cash_entries` (`portfolio_id`,`currency`);--> statement-breakpoint
CREATE TABLE `paper_portfolio_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_sessions_expiry` ON `paper_portfolio_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `paper_portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`pin_hash` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_started` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_portfolios_name` ON `paper_portfolios` (`name`);--> statement-breakpoint
INSERT OR IGNORE INTO `paper_portfolios` (`id`,`name`,`currency`,`pin_hash`,`attempts`,`window_started`,`created_at`,`updated_at`,`data`) VALUES ('legacy','المحفظة السابقة','MULTI','',0,0,datetime('now'),datetime('now'),'{"id":"legacy","name":"المحفظة السابقة","currency":"MULTI"}');--> statement-breakpoint
ALTER TABLE `paper_trades` ADD `portfolio_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_trades_portfolio_currency` ON `paper_trades` (`portfolio_id`,`currency`);

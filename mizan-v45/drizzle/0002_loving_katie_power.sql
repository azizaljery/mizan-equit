CREATE TABLE `analysis_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backtest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `forecast_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`evaluated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `forecast_records` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`symbol` text NOT NULL,
	`created_at` text NOT NULL,
	`horizon` integer NOT NULL,
	`model` text NOT NULL,
	`market` text NOT NULL,
	`sector` text NOT NULL,
	`confidence` text NOT NULL,
	`available` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_forecast_symbol_date` ON `forecast_records` (`symbol`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_forecast_date` ON `forecast_records` (`created_at`);--> statement-breakpoint
CREATE TABLE `paper_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`quantity` text NOT NULL,
	`price` text NOT NULL,
	`currency` text NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_trades_symbol_currency` ON `paper_trades` (`symbol`,`currency`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`symbol` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);

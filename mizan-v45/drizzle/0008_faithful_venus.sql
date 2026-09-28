CREATE TABLE `evaluation_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`forecast_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`fingerprint` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_evaluation_forecast_revision` ON `evaluation_revisions` (`forecast_id`,`revision`);--> statement-breakpoint
CREATE TABLE `forecast_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`forecast_id` text NOT NULL,
	`group_id` text NOT NULL,
	`symbol` text NOT NULL,
	`created_at` text NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`policy` text NOT NULL,
	`selection` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tests_owner_date` ON `forecast_tests` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `recovery_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recovery_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`checkpoint` text NOT NULL,
	`table_name` text NOT NULL,
	`row_data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`reported` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`until_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_research_symbol_date` ON `research_runs` (`symbol`,`created_at`);--> statement-breakpoint
CREATE TABLE `research_state` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);

--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','accuracy_rows',json_object('__rowid',rowid,'id',"id",'run_id',"run_id",'ordinal',"ordinal",'symbol',"symbol",'company',"company",'state',"state",'forecast',"forecast",'inputs',"inputs",'outcome',"outcome",'error',"error",'updated_at',"updated_at",'lease_token',"lease_token",'lease_until',"lease_until") FROM "accuracy_rows";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','accuracy_runs',json_object('__rowid',rowid,'id',"id",'created_at',"created_at",'data',"data") FROM "accuracy_runs";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','admin_access',json_object('__rowid',rowid,'id',"id",'attempts',"attempts",'window_started',"window_started",'session_hash',"session_hash",'expires_at',"expires_at") FROM "admin_access";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','admin_audit',json_object('__rowid',rowid,'id',"id",'created_at',"created_at",'action',"action",'data',"data") FROM "admin_audit";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','analysis_snapshots',json_object('__rowid',rowid,'id',"id",'symbol',"symbol",'created_at',"created_at",'data',"data") FROM "analysis_snapshots";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','backtest_runs',json_object('__rowid',rowid,'id',"id",'symbol',"symbol",'created_at',"created_at",'data',"data") FROM "backtest_runs";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','forecast_outcomes',json_object('__rowid',rowid,'id',"id",'evaluated_at',"evaluated_at",'data',"data") FROM "forecast_outcomes";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','forecast_records',json_object('__rowid',rowid,'id',"id",'snapshot_id',"snapshot_id",'symbol',"symbol",'created_at',"created_at",'horizon',"horizon",'model',"model",'market',"market",'sector',"sector",'confidence',"confidence",'available',"available",'data',"data") FROM "forecast_records";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','gold_budgets',json_object('__rowid',rowid,'id',"id",'requests',"requests") FROM "gold_budgets";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','gold_locks',json_object('__rowid',rowid,'id',"id",'until_ms',"until_ms",'token',"token") FROM "gold_locks";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','gold_state',json_object('__rowid',rowid,'id',"id",'data',"data",'updated_at',"updated_at") FROM "gold_state";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','paper_cash_entries',json_object('__rowid',rowid,'id',"id",'portfolio_id',"portfolio_id",'cash_type',"cash_type",'amount',"amount",'currency',"currency",'created_at',"created_at",'data',"data") FROM "paper_cash_entries";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','paper_portfolio_sessions',json_object('__rowid',rowid,'token_hash',"token_hash",'portfolio_id',"portfolio_id",'expires_at',"expires_at",'created_at',"created_at") FROM "paper_portfolio_sessions";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','paper_portfolios',json_object('__rowid',rowid,'id',"id",'name',"name",'currency',"currency",'pin_hash',"pin_hash",'attempts',"attempts",'window_started',"window_started",'created_at',"created_at",'updated_at',"updated_at",'data',"data") FROM "paper_portfolios";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','paper_trades',json_object('__rowid',rowid,'id',"id",'symbol',"symbol",'side',"side",'quantity',"quantity",'price',"price",'currency',"currency",'created_at',"created_at",'data',"data",'portfolio_id',"portfolio_id") FROM "paper_trades";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','recommendation_lock',json_object('__rowid',rowid,'id',"id",'owner_id',"owner_id",'pin_hash',"pin_hash",'attempts',"attempts",'window_started',"window_started") FROM "recommendation_lock";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','settings_history',json_object('__rowid',rowid,'id',"id",'created_at',"created_at",'data',"data") FROM "settings_history";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','site_settings',json_object('__rowid',rowid,'id',"id",'value',"value") FROM "site_settings";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','source_status',json_object('__rowid',rowid,'id',"id",'status',"status",'last_attempt',"last_attempt",'last_success',"last_success",'detail',"detail") FROM "source_status";
--> statement-breakpoint
INSERT INTO recovery_rows(checkpoint,table_name,row_data) SELECT 'before-unified-2026-09-11','watchlist',json_object('__rowid',rowid,'symbol',"symbol",'created_at',"created_at",'data',"data") FROM "watchlist";
--> statement-breakpoint
INSERT INTO recovery_manifests(id,created_at,data) VALUES('before-unified-2026-09-11',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'{"checkpoint":"before-unified-2026-09-11","sourceCommit":"b175c55f502080d59849e67dc0915fd8000cb47a","tables":[{"table":"accuracy_rows","columns":["id","run_id","ordinal","symbol","company","state","forecast","inputs","outcome","error","updated_at","lease_token","lease_until"],"createSql":"CREATE TABLE `accuracy_rows` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`run_id` text NOT NULL,\n\t`ordinal` integer NOT NULL,\n\t`symbol` text NOT NULL,\n\t`company` text NOT NULL,\n\t`state` text DEFAULT ''pending'' NOT NULL,\n\t`forecast` text,\n\t`inputs` text,\n\t`outcome` text,\n\t`error` text DEFAULT '''' NOT NULL,\n\t`updated_at` text NOT NULL,\n\t`lease_token` text DEFAULT '''' NOT NULL,\n\t`lease_until` integer DEFAULT 0 NOT NULL\n)"},{"table":"accuracy_runs","columns":["id","created_at","data"],"createSql":"CREATE TABLE `accuracy_runs` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`created_at` text NOT NULL,\n\t`data` text NOT NULL\n)"},{"table":"admin_access","columns":["id","attempts","window_started","session_hash","expires_at"],"createSql":"CREATE TABLE `admin_access` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`attempts` integer DEFAULT 0 NOT NULL,\n\t`window_started` integer DEFAULT 0 NOT NULL,\n\t`session_hash` text DEFAULT '''' NOT NULL,\n\t`expires_at` integer DEFAULT 0 NOT NULL\n)"},{"table":"admin_audit","columns":["id","created_at","action","data"],"createSql":"CREATE TABLE `admin_audit` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`created_at` text NOT NULL,\n\t`action` text NOT NULL,\n\t`data` text NOT NULL\n)"},{"table":"analysis_snapshots","columns":["id","symbol","created_at","data"],"createSql":"CREATE TABLE `analysis_snapshots` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`symbol` text NOT NULL,\n\t`created_at` text NOT NULL,\n\t`data` text NOT NULL\n)"},{"table":"backtest_runs","columns":["id","symbol","created_at","data"],"createSql":"CREATE TABLE `backtest_runs` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`symbol` text NOT NULL,\n\t`created_at` text NOT NULL,\n\t`data` text NOT NULL\n)"},{"table":"forecast_outcomes","columns":["id","evaluated_at","data"],"createSql":"CREATE TABLE `forecast_outcomes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`evaluated_at` text NOT NULL,\n\t`data` text NOT NULL\n)"},{"table":"forecast_records","columns":["id","snapshot_id","symbol","created_at","horizon","model","market","sector","confidence","available","data"],"createSql":"CREATE TABLE `forecast_records` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`snapshot_id` text NOT NULL,\n\t`symbol` text NOT NULL,\n\t`created_at` text NOT NULL,\n\t`horizon` integer NOT NULL,\n\t`model` text NOT NULL,\n\t`market` text NOT NULL,\n\t`sector` text NOT NULL,\n\t`confidence` text NOT NULL,\n\t`available` integer NOT NULL,\n\t`data` text NOT NULL\n)"},{"table":"gold_budgets","columns":["id","requests"],"createSql":"CREATE TABLE `gold_budgets` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`requests` integer DEFAULT 0 NOT NULL\n)"},{"table":"gold_locks","columns":["id","until_ms","token"],"createSql":"CREATE TABLE `gold_locks` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`until_ms` integer DEFAULT 0 NOT NULL,\n\t`token` text DEFAULT '''' NOT NULL\n)"},{"table":"gold_state","columns":["id","data","updated_at"],"createSql":"CREATE TABLE `gold_state` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`data` text NOT NULL,\n\t`updated_at` text NOT NULL\n)"},{"table":"paper_cash_entries","columns":["id","portfolio_id","cash_type","amount","currency","created_at","data"],"createSql":"CREATE TABLE `paper_cash_entries` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`portfolio_id` text NOT NULL,\n\t`cash_type` text NOT NULL,\n\t`amount` text NOT NULL,\n\t`currency` text NOT NULL,\n\t`created_at` text NOT NULL,\n\t`data` text NOT NULL\n)"},{"table":"paper_portfolio_sessions","columns":["token_hash","portfolio_id","expires_at","created_at"],"createSql":"CREATE TABLE `paper_portfolio_sessions` (\n\t`token_hash` text PRIMARY KEY NOT NULL,\n\t`portfolio_id` text NOT NULL,\n\t`expires_at` integer NOT NULL,\n\t`created_at` text NOT NULL\n)"},{"table":"paper_portfolios","columns":["id","name","currency","pin_hash","attempts","window_started","created_at","updated_at","data"],"createSql":"CREATE TABLE `paper_portfolios` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`currency` text NOT NULL,\n\t`pin_hash` text DEFAULT '''' NOT NULL,\n\t`attempts` integer DEFAULT 0 NOT NULL,\n\t`window_started` integer DEFAULT 0 NOT NULL,\n\t`created_at` text NOT NULL,\n\t`updated_at` text NOT NULL,\n\t`data` text NOT NULL\n)"},{"table":"paper_trades","columns":["id","symbol","side","quantity","price","currency","created_at","data","portfolio_id"],"createSql":"CREATE TABLE `paper_trades` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`symbol` text NOT NULL,\n\t`side` text NOT NULL,\n\t`quantity` text NOT NULL,\n\t`price` text NOT NULL,\n\t`currency` text NOT NULL,\n\t`created_at` text NOT NULL,\n\t`data` text NOT NULL\n, `portfolio_id` text DEFAULT ''legacy'' NOT NULL)"},{"table":"recommendation_lock","columns":["id","owner_id","pin_hash","attempts","window_started"],"createSql":"CREATE TABLE `recommendation_lock` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`owner_id` text DEFAULT '''' NOT NULL,\n\t`pin_hash` text NOT NULL,\n\t`attempts` integer DEFAULT 0 NOT NULL,\n\t`window_started` integer DEFAULT 0 NOT NULL\n)"},{"table":"settings_history","columns":["id","created_at","data"],"createSql":"CREATE TABLE `settings_history` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`created_at` text NOT NULL,\n\t`data` text NOT NULL\n)"},{"table":"site_settings","columns":["id","value"],"createSql":"CREATE TABLE `site_settings` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`value` text NOT NULL\n)"},{"table":"source_status","columns":["id","status","last_attempt","last_success","detail"],"createSql":"CREATE TABLE `source_status` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`status` text NOT NULL,\n\t`last_attempt` text NOT NULL,\n\t`last_success` text NOT NULL,\n\t`detail` text NOT NULL\n)"},{"table":"watchlist","columns":["symbol","created_at","data"],"createSql":"CREATE TABLE `watchlist` (\n\t`symbol` text PRIMARY KEY NOT NULL,\n\t`created_at` text NOT NULL,\n\t`data` text NOT NULL\n)"}]}');
--> statement-breakpoint
CREATE UNIQUE INDEX idx_tests_unique ON forecast_tests(owner,forecast_id,policy);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_evaluation_unique ON evaluation_revisions(forecast_id,revision);
--> statement-breakpoint


CREATE TABLE `backtest_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`horizon` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `backtest_runs`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
-- Derived copies only. Originals stay in backtest_runs; no fabricated metrics.
INSERT OR IGNORE INTO backtest_results(id,run_id,horizon,data,created_at)
SELECT r.id || ':' || json_extract(j.value,'$.horizon'),r.id,json_extract(j.value,'$.horizon'),j.value,r.created_at
 FROM backtest_runs r, json_each(CASE WHEN json_valid(r.data) THEN CASE json_extract(r.data,'$.kind') WHEN 'mizan-issued-forecast-audit-v1' THEN CASE WHEN json_type(r.data,'$.byHorizon')='array' THEN json_extract(r.data,'$.byHorizon') ELSE '[]' END WHEN 'mizan-issued-forecast-windows-v1' THEN CASE WHEN json_type(r.data,'$.aggregate.byHorizon')='array' THEN json_extract(r.data,'$.aggregate.byHorizon') ELSE '[]' END ELSE '[]' END ELSE '[]' END) j
 WHERE j.type='object' AND json_type(j.value,'$.horizon')='integer' AND json_extract(j.value,'$.horizon') IN (1,5,21,63,126,252);
--> statement-breakpoint
CREATE TRIGGER backtest_results_after_insert AFTER INSERT ON backtest_runs BEGIN
 INSERT OR IGNORE INTO backtest_results(id,run_id,horizon,data,created_at)
 SELECT NEW.id || ':' || json_extract(j.value,'$.horizon'),NEW.id,json_extract(j.value,'$.horizon'),j.value,NEW.created_at
 FROM json_each(CASE WHEN json_valid(NEW.data) THEN CASE json_extract(NEW.data,'$.kind') WHEN 'mizan-issued-forecast-audit-v1' THEN CASE WHEN json_type(NEW.data,'$.byHorizon')='array' THEN json_extract(NEW.data,'$.byHorizon') ELSE '[]' END WHEN 'mizan-issued-forecast-windows-v1' THEN CASE WHEN json_type(NEW.data,'$.aggregate.byHorizon')='array' THEN json_extract(NEW.data,'$.aggregate.byHorizon') ELSE '[]' END ELSE '[]' END ELSE '[]' END) j
 WHERE j.type='object' AND json_type(j.value,'$.horizon')='integer' AND json_extract(j.value,'$.horizon') IN (1,5,21,63,126,252);
END;
--> statement-breakpoint
CREATE TRIGGER backtest_results_after_update AFTER UPDATE OF data ON backtest_runs BEGIN
 DELETE FROM backtest_results WHERE run_id=NEW.id;
 INSERT OR IGNORE INTO backtest_results(id,run_id,horizon,data,created_at)
 SELECT NEW.id || ':' || json_extract(j.value,'$.horizon'),NEW.id,json_extract(j.value,'$.horizon'),j.value,NEW.created_at
 FROM json_each(CASE WHEN json_valid(NEW.data) THEN CASE json_extract(NEW.data,'$.kind') WHEN 'mizan-issued-forecast-audit-v1' THEN CASE WHEN json_type(NEW.data,'$.byHorizon')='array' THEN json_extract(NEW.data,'$.byHorizon') ELSE '[]' END WHEN 'mizan-issued-forecast-windows-v1' THEN CASE WHEN json_type(NEW.data,'$.aggregate.byHorizon')='array' THEN json_extract(NEW.data,'$.aggregate.byHorizon') ELSE '[]' END ELSE '[]' END ELSE '[]' END) j
 WHERE j.type='object' AND json_type(j.value,'$.horizon')='integer' AND json_extract(j.value,'$.horizon') IN (1,5,21,63,126,252);
END;
--> statement-breakpoint
CREATE INDEX `idx_backtest_results_run` ON `backtest_results` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_backtest_results_run_horizon` ON `backtest_results` (`run_id`,`horizon`);--> statement-breakpoint
CREATE TABLE `source_health` (
	`source_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'unknown' NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`avg_latency_ms` real,
	`last_success_at` text,
	`last_failure_at` text,
	`last_error` text,
	`updated_at` text NOT NULL
);

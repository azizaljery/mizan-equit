CREATE INDEX `idx_backtest_runs_created` ON `backtest_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_forecast_outcomes_eval` ON `forecast_outcomes` (`evaluated_at`);--> statement-breakpoint
CREATE INDEX `idx_forecast_symbol_horizon` ON `forecast_records` (`symbol`,`horizon`);
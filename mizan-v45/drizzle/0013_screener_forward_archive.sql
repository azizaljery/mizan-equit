-- Additive cohort membership only. Forecasts/outcomes remain in the canonical journal.
CREATE TABLE IF NOT EXISTS screener_runs (
 id TEXT PRIMARY KEY NOT NULL,
 token_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 completed_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('scanning','complete')),
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 fingerprint TEXT
);
CREATE TABLE IF NOT EXISTS screener_batches (
 run_id TEXT NOT NULL REFERENCES screener_runs(id),
 batch_index INTEGER NOT NULL CHECK(batch_index >= 0),
 created_at TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 PRIMARY KEY(run_id,batch_index)
);
CREATE TABLE IF NOT EXISTS screener_picks (
 run_id TEXT NOT NULL REFERENCES screener_runs(id),
 market TEXT NOT NULL CHECK(market IN ('sa','us')),
 rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 10),
 forecast_id TEXT NOT NULL REFERENCES forecast_records(id),
 PRIMARY KEY(run_id,market,rank),
 UNIQUE(run_id,forecast_id)
);
CREATE INDEX IF NOT EXISTS screener_runs_created ON screener_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS screener_picks_forecast ON screener_picks(forecast_id);
-- Original cohorts and issued input are append-only through the application.
CREATE TRIGGER IF NOT EXISTS screener_run_sealed BEFORE UPDATE ON screener_runs WHEN OLD.status='complete' BEGIN SELECT RAISE(ABORT,'screener_run_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS screener_run_keep BEFORE DELETE ON screener_runs BEGIN SELECT RAISE(ABORT,'screener_run_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS screener_batch_fixed BEFORE UPDATE ON screener_batches BEGIN SELECT RAISE(ABORT,'screener_batch_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS screener_batch_keep BEFORE DELETE ON screener_batches BEGIN SELECT RAISE(ABORT,'screener_batch_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS screener_pick_fixed BEFORE UPDATE ON screener_picks BEGIN SELECT RAISE(ABORT,'screener_pick_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS screener_pick_keep BEFORE DELETE ON screener_picks BEGIN SELECT RAISE(ABORT,'screener_pick_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS screener_forecast_fixed BEFORE UPDATE ON forecast_records WHEN OLD.snapshot_id LIKE 'screener:%' BEGIN SELECT RAISE(ABORT,'issued_screener_forecast_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS screener_forecast_keep BEFORE DELETE ON forecast_records WHEN OLD.snapshot_id LIKE 'screener:%' BEGIN SELECT RAISE(ABORT,'issued_screener_forecast_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS screener_input_fixed BEFORE UPDATE ON analysis_snapshots WHEN OLD.id LIKE 'screener:%' BEGIN SELECT RAISE(ABORT,'issued_screener_input_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS screener_input_keep BEFORE DELETE ON analysis_snapshots WHEN OLD.id LIKE 'screener:%' BEGIN SELECT RAISE(ABORT,'issued_screener_input_is_immutable'); END;

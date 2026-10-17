-- Additive, idempotent read-path indexes. No table or data changes.
-- analysis_snapshots: temporal lab / archive lookups by symbol and time (WHERE symbol=? AND created_at<=? ORDER BY created_at).
CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_symbol_date ON analysis_snapshots(symbol, created_at);
-- forecast_records: rows of one snapshot (daily archive recovery, journal reads).
CREATE INDEX IF NOT EXISTS idx_forecast_snapshot ON forecast_records(snapshot_id);
-- forecast_records: calibration / performance slices by model and market over time.
CREATE INDEX IF NOT EXISTS idx_forecast_model_market_date ON forecast_records(model, market, created_at);

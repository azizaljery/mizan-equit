-- Macro-economic observations (book Part I: rates, inflation, curve, dollar, oil, labour). Append-only and point-in-time:
-- a revised value is a NEW row (same series/date, different value) and the earlier row stays. The public sources used
-- (FRED CSV, World Bank) give no publication timestamp, so availability is the retrieval time only (availability_basis).
CREATE TABLE IF NOT EXISTS macro_observations (
 id TEXT PRIMARY KEY NOT NULL,
 series_id TEXT NOT NULL,
 obs_date TEXT NOT NULL,
 value REAL NOT NULL CHECK(value = value),
 source TEXT NOT NULL,
 source_url TEXT NOT NULL,
 retrieved_at TEXT NOT NULL,
 availability_basis TEXT NOT NULL DEFAULT 'retrieval_time_only' CHECK(availability_basis IN ('retrieval_time_only','provider_published_time')),
 UNIQUE(series_id, obs_date, value)
);
CREATE INDEX IF NOT EXISTS macro_observations_series_idx ON macro_observations(series_id, obs_date, retrieved_at);
CREATE TRIGGER IF NOT EXISTS macro_observations_keep BEFORE DELETE ON macro_observations BEGIN SELECT RAISE(ABORT,'macro_observations_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS macro_observations_fixed BEFORE UPDATE ON macro_observations BEGIN SELECT RAISE(ABORT,'macro_observations_is_immutable'); END;

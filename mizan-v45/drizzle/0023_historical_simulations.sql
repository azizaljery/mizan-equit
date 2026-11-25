-- «محاكاة تاريخية»: stored apart from forecasts the live engine actually issued. Append-only; one row per run, tied to a spec version and its fingerprint.
CREATE TABLE IF NOT EXISTS historical_simulations (
 id TEXT PRIMARY KEY NOT NULL,
 label TEXT NOT NULL CHECK(label = 'محاكاة تاريخية'),
 spec_version TEXT NOT NULL,
 spec_fingerprint TEXT NOT NULL,
 payload TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS historical_simulations_keep BEFORE DELETE ON historical_simulations BEGIN SELECT RAISE(ABORT,'historical_simulations_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS historical_simulations_fixed BEFORE UPDATE ON historical_simulations BEGIN SELECT RAISE(ABORT,'historical_simulations_is_immutable'); END;

-- DRAFT — NOT A MIGRATION. Lives outside mizan-v45/drizzle/ on purpose: `wrangler d1 migrations apply` never sees it.
-- Becomes mizan-v45/drizzle/0017_aziz_issue_ledger.sql only after the owner approves this file AND the merge that moves it.
-- Spec 2026-10-21 phases 1 and 4. Additive only: three new tables, no ALTER/DROP, no change to existing tables.
--
-- Knowledge-time rule (as-of): what the system "knew" at time t is decided ONLY by received_at (and published_at when the
-- provider documents it). session_date is the date the price belongs to, never the time it was known. A price imported today
-- for a 2021 session has received_at = today, so an as-of query for any t before today returns nothing for it.

-- A. Forecast issues: written once, never updated or deleted.
CREATE TABLE IF NOT EXISTS aziz_forecast_issues (
 id TEXT PRIMARY KEY NOT NULL,
 parent_forecast_id TEXT REFERENCES aziz_forecast_issues(id),
 issue_type TEXT NOT NULL CHECK(issue_type IN ('direct','bridge_5_to_21')),
 market TEXT NOT NULL CHECK(market IN ('sa','us')),
 symbol TEXT NOT NULL,
 instrument_id TEXT NOT NULL,
 currency TEXT NOT NULL,
 price_basis TEXT NOT NULL CHECK(price_basis IN ('split_adjusted','total_return','unadjusted')),
 issued_at TEXT NOT NULL,
 target_session TEXT NOT NULL,
 initial_horizon INTEGER NOT NULL CHECK(initial_horizon IN (5,21)),
 elapsed_sessions INTEGER NOT NULL CHECK(elapsed_sessions >= 0),
 remaining_sessions INTEGER NOT NULL CHECK(remaining_sessions >= 1),
 calendar_id TEXT NOT NULL,
 calendar_version TEXT NOT NULL,
 input_hash TEXT NOT NULL,
 artifact_id TEXT NOT NULL,
 artifact_hash TEXT NOT NULL,
 policy_hash TEXT NOT NULL,
 feature_schema_version TEXT NOT NULL,
 model_version TEXT NOT NULL,
 original_forecast_id TEXT,
 original_point REAL,
 ref_price REAL CHECK(ref_price IS NULL OR ref_price > 0),
 ref_price_session TEXT,
 source_id TEXT NOT NULL,
 data_revision INTEGER NOT NULL,
 data_as_of TEXT NOT NULL,                       -- knowledge time used for every input (received_at bound)
 predicted_log_return REAL,
 point_price REAL CHECK(point_price IS NULL OR point_price > 0),
 probability_up REAL CHECK(probability_up IS NULL OR (probability_up > 0 AND probability_up < 1)),
 interval_low REAL,
 interval_high REAL,
 calibration_version TEXT,
 monitor_state_version TEXT,
 eligibility_json TEXT NOT NULL DEFAULT '{}',
 risk_json TEXT NOT NULL DEFAULT '{}',
 mode TEXT NOT NULL CHECK(mode IN ('REPLAY','SHADOW')),
 recorded INTEGER NOT NULL CHECK(recorded IN (0,1)),
 abstention_code TEXT,
 abstention_message TEXT,
 created_at TEXT NOT NULL,
 -- an issued forecast has a point; an abstention has a code and no point (never both, never neither)
 CHECK((recorded=1 AND predicted_log_return IS NOT NULL AND point_price IS NOT NULL AND abstention_code IS NULL)
    OR (recorded=0 AND predicted_log_return IS NULL AND point_price IS NULL AND probability_up IS NULL AND interval_low IS NULL AND abstention_code IS NOT NULL)),
 CHECK((interval_low IS NULL AND interval_high IS NULL) OR (interval_low < interval_high)),
 CHECK(data_as_of <= issued_at),
 UNIQUE(symbol, market, issue_type, initial_horizon, target_session, model_version, artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_aziz_issues_slot ON aziz_forecast_issues(market, issue_type, initial_horizon, issued_at);
CREATE INDEX IF NOT EXISTS idx_aziz_issues_symbol ON aziz_forecast_issues(symbol, market, issued_at);
CREATE TRIGGER IF NOT EXISTS trg_aziz_issues_no_update BEFORE UPDATE ON aziz_forecast_issues
 BEGIN SELECT RAISE(ABORT,'aziz_forecast_issues is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_aziz_issues_no_delete BEFORE DELETE ON aziz_forecast_issues
 BEGIN SELECT RAISE(ABORT,'aziz_forecast_issues is append-only'); END;

-- B. Outcomes: one row per (forecast, revision). A source correction is a new revision, never an overwrite.
CREATE TABLE IF NOT EXISTS aziz_forecast_outcomes (
 id TEXT PRIMARY KEY NOT NULL,
 forecast_id TEXT NOT NULL REFERENCES aziz_forecast_issues(id),
 outcome_revision INTEGER NOT NULL CHECK(outcome_revision >= 1),
 event_key TEXT NOT NULL UNIQUE,                 -- forecast_id || ':' || target_session || ':' || outcome_revision
 observed_at TEXT NOT NULL,                      -- the target session
 available_at TEXT NOT NULL,                     -- when the price became known to the system (received_at)
 evaluated_at TEXT NOT NULL,
 actual_price REAL NOT NULL CHECK(actual_price > 0),
 price_basis TEXT NOT NULL,
 source_id TEXT NOT NULL,
 data_revision INTEGER NOT NULL,
 point_loss REAL,
 direction_outcome INTEGER CHECK(direction_outcome IS NULL OR direction_outcome IN (0,1)),
 brier REAL,
 interval_hit INTEGER CHECK(interval_hit IS NULL OR interval_hit IN (0,1)),
 interval_score REAL,
 supersedes_revision INTEGER,
 correction_reason TEXT,
 created_at TEXT NOT NULL,
 CHECK(available_at >= observed_at),
 CHECK(evaluated_at >= available_at),
 CHECK((outcome_revision = 1 AND supersedes_revision IS NULL) OR (outcome_revision > 1 AND supersedes_revision = outcome_revision - 1 AND correction_reason IS NOT NULL)),
 UNIQUE(forecast_id, outcome_revision)
);
CREATE INDEX IF NOT EXISTS idx_aziz_outcomes_forecast ON aziz_forecast_outcomes(forecast_id, outcome_revision);
CREATE TRIGGER IF NOT EXISTS trg_aziz_outcomes_no_update BEFORE UPDATE ON aziz_forecast_outcomes
 BEGIN SELECT RAISE(ABORT,'aziz_forecast_outcomes is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_aziz_outcomes_no_delete BEFORE DELETE ON aziz_forecast_outcomes
 BEGIN SELECT RAISE(ABORT,'aziz_forecast_outcomes is append-only'); END;
-- an outcome may only attach to a recorded forecast (abstentions have no outcome and never enter accuracy)
CREATE TRIGGER IF NOT EXISTS trg_aziz_outcomes_recorded_only BEFORE INSERT ON aziz_forecast_outcomes
 WHEN (SELECT recorded FROM aziz_forecast_issues WHERE id=NEW.forecast_id) IS NOT 1
 BEGIN SELECT RAISE(ABORT,'outcome requires a recorded (non-abstained) forecast'); END;
-- metrics that need a probability/interval may only be set when the issue carried one
CREATE TRIGGER IF NOT EXISTS trg_aziz_outcomes_metric_scope BEFORE INSERT ON aziz_forecast_outcomes
 WHEN (NEW.brier IS NOT NULL AND (SELECT probability_up FROM aziz_forecast_issues WHERE id=NEW.forecast_id) IS NULL)
   OR (NEW.interval_hit IS NOT NULL AND (SELECT interval_low FROM aziz_forecast_issues WHERE id=NEW.forecast_id) IS NULL)
 BEGIN SELECT RAISE(ABORT,'metric without the corresponding issued output'); END;

-- C. Price revisions: every received version is kept; nothing is overwritten.
CREATE TABLE IF NOT EXISTS aziz_price_revisions (
 id TEXT PRIMARY KEY NOT NULL,
 symbol_id TEXT NOT NULL REFERENCES aziz_symbols(id),
 provider TEXT NOT NULL,
 session_date TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision >= 1),
 opened REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, closed REAL NOT NULL CHECK(closed > 0),
 adjusted_close REAL, volume REAL,
 price_basis TEXT NOT NULL CHECK(price_basis IN ('split_adjusted','total_return','unadjusted')),
 observed_at TEXT NOT NULL,                      -- session end (market calendar)
 published_at TEXT,                              -- provider publication time, NULL when the provider does not state it
 received_at TEXT NOT NULL,                      -- when this system received this version (the as-of bound)
 availability_basis TEXT NOT NULL CHECK(availability_basis IN ('retrieval_time_only','provider_published_time')),
 dataset_id TEXT NOT NULL REFERENCES aziz_market_datasets(id),
 raw_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 CHECK(received_at >= observed_at),
 CHECK((availability_basis='provider_published_time' AND published_at IS NOT NULL) OR (availability_basis='retrieval_time_only' AND published_at IS NULL)),
 UNIQUE(symbol_id, provider, session_date, revision)
);
CREATE INDEX IF NOT EXISTS idx_aziz_price_rev_asof ON aziz_price_revisions(symbol_id, session_date, received_at);
CREATE TRIGGER IF NOT EXISTS trg_aziz_price_rev_no_update BEFORE UPDATE ON aziz_price_revisions
 BEGIN SELECT RAISE(ABORT,'aziz_price_revisions is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_aziz_price_rev_no_delete BEFORE DELETE ON aziz_price_revisions
 BEGIN SELECT RAISE(ABORT,'aziz_price_revisions is append-only'); END;

-- As-of read (reference query; implemented in code, shown here as the contract):
--   SELECT closed FROM aziz_price_revisions
--    WHERE symbol_id=? AND session_date=? AND received_at <= :t
--    ORDER BY revision DESC LIMIT 1;
-- Accuracy sample (reference): only recorded issues, latest outcome revision per forecast:
--   SELECT i.id, o.* FROM aziz_forecast_issues i
--     JOIN aziz_forecast_outcomes o ON o.forecast_id=i.id
--    WHERE i.recorded=1 AND o.outcome_revision=(SELECT MAX(outcome_revision) FROM aziz_forecast_outcomes WHERE forecast_id=i.id);
-- Issue rate (reference): COUNT(recorded=1) / COUNT(*) over the same slot and period.

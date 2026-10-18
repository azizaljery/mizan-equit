-- PROTOCOL-DIR-0002 «سجل الترشيحات اليومي» (frozen at c831eb62ae8e1058803e20be089498306d45ba62). Additive only.
-- One row per (pick_date, market, horizon, symbol, model_version). Reference fields are append-only; outcome fields
-- (target_date .. evaluated_at) are written exactly once, moving outcome_state from 'pending' to 'complete'|'unavailable'.
CREATE TABLE IF NOT EXISTS daily_picks (
 id TEXT PRIMARY KEY NOT NULL,
 pick_date TEXT NOT NULL,
 market TEXT NOT NULL CHECK(market IN ('sa','us')),
 horizon INTEGER NOT NULL CHECK(horizon IN (5,21)),
 symbol TEXT NOT NULL,
 rank INTEGER NOT NULL CHECK(rank >= 1),
 universe_size INTEGER NOT NULL CHECK(universe_size >= rank),
 percentile REAL NOT NULL,
 mom126_5 REAL NOT NULL,
 in_top INTEGER NOT NULL CHECK(in_top IN (0,1)),
 ref_price REAL NOT NULL CHECK(ref_price > 0),
 ref_price_date TEXT NOT NULL,
 currency TEXT NOT NULL,
 mizan_predicted_price REAL,
 mizan_forecast_id TEXT,
 model_version TEXT NOT NULL,
 protocol_commit TEXT NOT NULL,
 created_at TEXT NOT NULL,
 target_date TEXT,
 actual_price REAL,
 actual_change_pct REAL,
 went_up INTEGER CHECK(went_up IS NULL OR went_up IN (0,1)),
 outcome_state TEXT NOT NULL DEFAULT 'pending' CHECK(outcome_state IN ('pending','complete','unavailable')),
 evaluated_at TEXT,
 UNIQUE(pick_date, market, horizon, symbol, model_version)
);
CREATE INDEX IF NOT EXISTS idx_daily_picks_market_horizon_date ON daily_picks(market, horizon, pick_date);
CREATE INDEX IF NOT EXISTS idx_daily_picks_outcome_market ON daily_picks(outcome_state, market);
CREATE TABLE IF NOT EXISTS daily_pick_runs (
 id TEXT PRIMARY KEY NOT NULL,
 market TEXT NOT NULL CHECK(market IN ('sa','us')),
 pick_date TEXT NOT NULL,
 model_version TEXT NOT NULL,
 created_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('recorded','gap')),
 universe_ok INTEGER NOT NULL,
 universe_failed INTEGER NOT NULL,
 failures_json TEXT NOT NULL CHECK(json_valid(failures_json))
);
CREATE INDEX IF NOT EXISTS idx_daily_pick_runs_market_date ON daily_pick_runs(market, pick_date);
-- Append-only guarantees (same convention as 0013): no deletes; reference fields frozen; outcome written once.
CREATE TRIGGER IF NOT EXISTS daily_pick_keep BEFORE DELETE ON daily_picks BEGIN SELECT RAISE(ABORT,'daily_pick_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS daily_pick_reference_fixed BEFORE UPDATE ON daily_picks WHEN NEW.id IS NOT OLD.id OR NEW.pick_date IS NOT OLD.pick_date OR NEW.market IS NOT OLD.market OR NEW.horizon IS NOT OLD.horizon OR NEW.symbol IS NOT OLD.symbol OR NEW.rank IS NOT OLD.rank OR NEW.universe_size IS NOT OLD.universe_size OR NEW.percentile IS NOT OLD.percentile OR NEW.mom126_5 IS NOT OLD.mom126_5 OR NEW.in_top IS NOT OLD.in_top OR NEW.ref_price IS NOT OLD.ref_price OR NEW.ref_price_date IS NOT OLD.ref_price_date OR NEW.currency IS NOT OLD.currency OR NEW.mizan_predicted_price IS NOT OLD.mizan_predicted_price OR NEW.mizan_forecast_id IS NOT OLD.mizan_forecast_id OR NEW.model_version IS NOT OLD.model_version OR NEW.protocol_commit IS NOT OLD.protocol_commit OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT,'daily_pick_reference_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS daily_pick_outcome_once BEFORE UPDATE ON daily_picks WHEN OLD.outcome_state <> 'pending' BEGIN SELECT RAISE(ABORT,'daily_pick_outcome_is_final'); END;
CREATE TRIGGER IF NOT EXISTS daily_pick_run_keep BEFORE DELETE ON daily_pick_runs BEGIN SELECT RAISE(ABORT,'daily_pick_run_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS daily_pick_run_sealed BEFORE UPDATE ON daily_pick_runs WHEN OLD.status = 'recorded' BEGIN SELECT RAISE(ABORT,'daily_pick_run_is_immutable'); END;

-- BOT-0001 phase 2: every nomination/forecast the bot may act on is recorded per source BEFORE any decision, append-only.
-- Outcomes are separate append-only rows written once the horizon has passed; nothing is ever edited or deleted.
CREATE TABLE IF NOT EXISTS bot_signals (
 id TEXT PRIMARY KEY NOT NULL,
 signal_key TEXT NOT NULL UNIQUE,
 source TEXT NOT NULL,
 source_version TEXT NOT NULL,
 market TEXT NOT NULL CHECK(market IN ('sa','us')),
 symbol TEXT NOT NULL,
 horizon INTEGER NOT NULL CHECK(horizon IN (1,5,21)),
 direction TEXT NOT NULL CHECK(direction IN ('up','down','neutral')),
 confidence TEXT,
 strength INTEGER,
 issued_at TEXT NOT NULL,
 forecast_id TEXT,
 basis_json TEXT NOT NULL CHECK(json_valid(basis_json)),
 recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_signals_lookup_idx ON bot_signals(market, symbol, horizon, issued_at);
CREATE INDEX IF NOT EXISTS bot_signals_source_idx ON bot_signals(source, source_version, market, issued_at);
CREATE TABLE IF NOT EXISTS bot_signal_outcomes (
 signal_id TEXT NOT NULL UNIQUE REFERENCES bot_signals(id),
 resolved_at TEXT NOT NULL,
 start_price REAL NOT NULL CHECK(start_price > 0),
 end_price REAL NOT NULL CHECK(end_price > 0),
 up INTEGER NOT NULL CHECK(up IN (0,1)),
 horizon_sessions INTEGER NOT NULL CHECK(horizon_sessions >= 1)
);
CREATE TABLE IF NOT EXISTS bot_decision_signals (
 decision_id TEXT NOT NULL REFERENCES bot_decisions(id),
 signal_id TEXT NOT NULL REFERENCES bot_signals(id),
 agreement TEXT NOT NULL CHECK(agreement IN ('single','agree','disagree')),
 PRIMARY KEY(decision_id, signal_id)
);
CREATE TRIGGER IF NOT EXISTS bot_signal_keep BEFORE DELETE ON bot_signals BEGIN SELECT RAISE(ABORT,'bot_signal_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS bot_signal_fixed BEFORE UPDATE ON bot_signals BEGIN SELECT RAISE(ABORT,'bot_signal_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS bot_signal_outcome_keep BEFORE DELETE ON bot_signal_outcomes BEGIN SELECT RAISE(ABORT,'bot_signal_outcome_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS bot_signal_outcome_fixed BEFORE UPDATE ON bot_signal_outcomes BEGIN SELECT RAISE(ABORT,'bot_signal_outcome_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS bot_decision_signal_keep BEFORE DELETE ON bot_decision_signals BEGIN SELECT RAISE(ABORT,'bot_decision_signal_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS bot_decision_signal_fixed BEFORE UPDATE ON bot_decision_signals BEGIN SELECT RAISE(ABORT,'bot_decision_signal_is_immutable'); END;

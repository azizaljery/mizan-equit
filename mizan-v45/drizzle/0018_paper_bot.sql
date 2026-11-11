-- BOT-0001 virtual trading bot (paper money only; no broker link). Additive only. Every table is append-only except the
-- single documented state transition per table (experiment status; order pending -> filled|cancelled|expired).
CREATE TABLE IF NOT EXISTS bot_strategies (
 id TEXT PRIMARY KEY NOT NULL,
 version TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 fingerprint TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS bot_experiments (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL UNIQUE,
 market TEXT NOT NULL CHECK(market IN ('sa','us')),
 currency TEXT NOT NULL CHECK(currency IN ('SAR','USD')),
 initial_cash REAL NOT NULL CHECK(initial_cash > 0),
 strategy_id TEXT NOT NULL REFERENCES bot_strategies(id),
 mode TEXT NOT NULL CHECK(mode IN ('dry_run','paper')),
 status TEXT NOT NULL CHECK(status IN ('running','paused','stopped')),
 created_at TEXT NOT NULL,
 started_at TEXT NOT NULL,
 stopped_at TEXT,
 status_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(status_json))
);
CREATE TABLE IF NOT EXISTS bot_decisions (
 id TEXT PRIMARY KEY NOT NULL,
 experiment_id TEXT NOT NULL REFERENCES bot_experiments(id),
 decision_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 symbol TEXT NOT NULL,
 horizon INTEGER NOT NULL CHECK(horizon IN (1,5,21)),
 action TEXT NOT NULL CHECK(action IN ('buy','sell','hold','abstain','suspend')),
 reason TEXT NOT NULL,
 forecast_id TEXT,
 forecast_created_at TEXT,
 model_version TEXT,
 strategy_version TEXT NOT NULL,
 data_json TEXT NOT NULL CHECK(json_valid(data_json))
);
CREATE INDEX IF NOT EXISTS bot_decisions_experiment_idx ON bot_decisions(experiment_id, created_at);
CREATE INDEX IF NOT EXISTS bot_decisions_forecast_idx ON bot_decisions(forecast_id);
CREATE TABLE IF NOT EXISTS bot_orders (
 id TEXT PRIMARY KEY NOT NULL,
 experiment_id TEXT NOT NULL REFERENCES bot_experiments(id),
 decision_id TEXT NOT NULL UNIQUE REFERENCES bot_decisions(id),
 order_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 symbol TEXT NOT NULL,
 horizon INTEGER NOT NULL CHECK(horizon IN (1,5,21)),
 side TEXT NOT NULL CHECK(side IN ('buy','sell')),
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 status TEXT NOT NULL CHECK(status IN ('pending','filled','cancelled','expired')),
 status_reason TEXT NOT NULL DEFAULT '',
 status_at TEXT NOT NULL,
 forecast_id TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 last_attempt_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(last_attempt_json))
);
CREATE INDEX IF NOT EXISTS bot_orders_experiment_status_idx ON bot_orders(experiment_id, status);
CREATE TABLE IF NOT EXISTS bot_fills (
 id TEXT PRIMARY KEY NOT NULL,
 experiment_id TEXT NOT NULL REFERENCES bot_experiments(id),
 order_id TEXT NOT NULL UNIQUE REFERENCES bot_orders(id),
 created_at TEXT NOT NULL,
 symbol TEXT NOT NULL,
 horizon INTEGER NOT NULL CHECK(horizon IN (1,5,21)),
 side TEXT NOT NULL CHECK(side IN ('buy','sell')),
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 quote_price REAL NOT NULL CHECK(quote_price > 0),
 fill_price REAL NOT NULL CHECK(fill_price > 0),
 commission REAL NOT NULL CHECK(commission >= 0),
 spread_cost REAL NOT NULL CHECK(spread_cost >= 0),
 slippage_cost REAL NOT NULL CHECK(slippage_cost >= 0),
 currency TEXT NOT NULL,
 quote_time TEXT NOT NULL,
 quote_age_seconds REAL NOT NULL,
 price_source TEXT NOT NULL,
 forecast_id TEXT,
 data_json TEXT NOT NULL CHECK(json_valid(data_json))
);
CREATE INDEX IF NOT EXISTS bot_fills_experiment_idx ON bot_fills(experiment_id, created_at);
CREATE TABLE IF NOT EXISTS bot_equity_snapshots (
 experiment_id TEXT NOT NULL REFERENCES bot_experiments(id),
 snapshot_date TEXT NOT NULL,
 created_at TEXT NOT NULL,
 cash REAL NOT NULL,
 positions_value REAL NOT NULL,
 equity REAL NOT NULL,
 benchmark_value REAL,
 benchmark_name TEXT NOT NULL DEFAULT '',
 data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 PRIMARY KEY(experiment_id, snapshot_date)
);
CREATE TRIGGER IF NOT EXISTS bot_strategy_keep BEFORE DELETE ON bot_strategies BEGIN SELECT RAISE(ABORT,'bot_strategy_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS bot_strategy_fixed BEFORE UPDATE ON bot_strategies BEGIN SELECT RAISE(ABORT,'bot_strategy_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS bot_experiment_keep BEFORE DELETE ON bot_experiments BEGIN SELECT RAISE(ABORT,'bot_experiment_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS bot_experiment_fixed BEFORE UPDATE ON bot_experiments WHEN NEW.id IS NOT OLD.id OR NEW.name IS NOT OLD.name OR NEW.market IS NOT OLD.market OR NEW.currency IS NOT OLD.currency OR NEW.initial_cash IS NOT OLD.initial_cash OR NEW.strategy_id IS NOT OLD.strategy_id OR NEW.created_at IS NOT OLD.created_at OR NEW.started_at IS NOT OLD.started_at OR OLD.status = 'stopped' BEGIN SELECT RAISE(ABORT,'bot_experiment_identity_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS bot_decision_keep BEFORE DELETE ON bot_decisions BEGIN SELECT RAISE(ABORT,'bot_decision_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS bot_decision_fixed BEFORE UPDATE ON bot_decisions BEGIN SELECT RAISE(ABORT,'bot_decision_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS bot_order_keep BEFORE DELETE ON bot_orders BEGIN SELECT RAISE(ABORT,'bot_order_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS bot_order_fixed BEFORE UPDATE ON bot_orders WHEN OLD.status <> 'pending' OR NEW.id IS NOT OLD.id OR NEW.experiment_id IS NOT OLD.experiment_id OR NEW.decision_id IS NOT OLD.decision_id OR NEW.order_key IS NOT OLD.order_key OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.symbol IS NOT OLD.symbol OR NEW.horizon IS NOT OLD.horizon OR NEW.side IS NOT OLD.side OR NEW.quantity IS NOT OLD.quantity OR NEW.forecast_id IS NOT OLD.forecast_id BEGIN SELECT RAISE(ABORT,'bot_order_is_final_or_identity_changed'); END;
CREATE TRIGGER IF NOT EXISTS bot_fill_keep BEFORE DELETE ON bot_fills BEGIN SELECT RAISE(ABORT,'bot_fill_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS bot_fill_fixed BEFORE UPDATE ON bot_fills BEGIN SELECT RAISE(ABORT,'bot_fill_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS bot_equity_keep BEFORE DELETE ON bot_equity_snapshots BEGIN SELECT RAISE(ABORT,'bot_equity_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS bot_equity_fixed BEFORE UPDATE ON bot_equity_snapshots BEGIN SELECT RAISE(ABORT,'bot_equity_is_immutable'); END;

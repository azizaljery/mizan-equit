-- Forward shadow log of the /audit decision state (research only). One row per symbol and as-of session; never edited or deleted.
-- Outcomes are separate append-only rows resolved later from real closes. Feeds no forecast, score or bot.
CREATE TABLE IF NOT EXISTS audit_shadow (
 id TEXT PRIMARY KEY NOT NULL,
 symbol TEXT NOT NULL,
 asof TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('UP','DOWN','ABSTAIN','CONTRADICTION','VETO')),
 support REAL,
 opposition REAL,
 price REAL NOT NULL CHECK(price > 0),
 logged_at TEXT NOT NULL,
 UNIQUE(symbol, asof)
);
CREATE TABLE IF NOT EXISTS audit_shadow_outcomes (
 shadow_id TEXT NOT NULL,
 horizon INTEGER NOT NULL CHECK(horizon IN (5,21)),
 end_date TEXT NOT NULL,
 end_price REAL NOT NULL CHECK(end_price > 0),
 up INTEGER NOT NULL CHECK(up IN (0,1)),
 resolved_at TEXT NOT NULL,
 PRIMARY KEY(shadow_id, horizon)
);
CREATE TRIGGER IF NOT EXISTS audit_shadow_keep BEFORE DELETE ON audit_shadow BEGIN SELECT RAISE(ABORT,'audit_shadow_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS audit_shadow_fixed BEFORE UPDATE ON audit_shadow BEGIN SELECT RAISE(ABORT,'audit_shadow_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_shadow_outcomes_keep BEFORE DELETE ON audit_shadow_outcomes BEGIN SELECT RAISE(ABORT,'audit_shadow_outcomes_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS audit_shadow_outcomes_fixed BEFORE UPDATE ON audit_shadow_outcomes BEGIN SELECT RAISE(ABORT,'audit_shadow_outcomes_is_immutable'); END;

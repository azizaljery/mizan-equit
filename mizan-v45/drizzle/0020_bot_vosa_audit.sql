-- VOSA shadow mode (BOT-0001): the veto gates run beside the bot's own decision and only RECORD their verdict. They never change a decision.
-- Append-only; one row per experiment x forecast x day x pipeline version. Used later to measure what silence would have saved or cost.
CREATE TABLE IF NOT EXISTS bot_vosa_audit (
 id TEXT PRIMARY KEY NOT NULL,
 experiment_id TEXT NOT NULL REFERENCES bot_experiments(id),
 audit_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 symbol TEXT NOT NULL,
 horizon INTEGER NOT NULL,
 forecast_id TEXT,
 pipeline_version TEXT NOT NULL,
 candidate_hash TEXT NOT NULL,
 vosa_status TEXT NOT NULL CHECK(vosa_status IN ('PASS','KILL','SUSPEND')),
 bot_action TEXT NOT NULL,
 bot_reason TEXT NOT NULL,
 relation TEXT NOT NULL CHECK(relation IN ('same','vosa_stricter','vosa_looser')),
 blocking_gates TEXT NOT NULL,
 gate_results_json TEXT NOT NULL CHECK(json_valid(gate_results_json)),
 audit_json TEXT NOT NULL CHECK(json_valid(audit_json))
);
CREATE INDEX IF NOT EXISTS bot_vosa_audit_exp_idx ON bot_vosa_audit(experiment_id, created_at);
CREATE TRIGGER IF NOT EXISTS bot_vosa_audit_keep BEFORE DELETE ON bot_vosa_audit BEGIN SELECT RAISE(ABORT,'bot_vosa_audit_is_append_only'); END;
CREATE TRIGGER IF NOT EXISTS bot_vosa_audit_fixed BEFORE UPDATE ON bot_vosa_audit BEGIN SELECT RAISE(ABORT,'bot_vosa_audit_is_immutable'); END;

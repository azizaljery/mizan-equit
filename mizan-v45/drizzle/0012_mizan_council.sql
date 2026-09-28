CREATE TABLE IF NOT EXISTS council_runs (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  task TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS council_runs_created_idx
  ON council_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS council_runs_status_idx
  ON council_runs(status, created_at DESC);

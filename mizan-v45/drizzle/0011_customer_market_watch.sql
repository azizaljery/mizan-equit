CREATE TABLE IF NOT EXISTS customer_market_watch (
  account_key TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (account_key, symbol)
);
CREATE INDEX IF NOT EXISTS idx_customer_market_watch_symbol ON customer_market_watch(symbol);
CREATE TABLE IF NOT EXISTS market_observations (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_observations_dedupe ON market_observations(symbol, observed_at, source);
CREATE INDEX IF NOT EXISTS idx_market_observations_symbol_time ON market_observations(symbol, observed_at);
CREATE TABLE IF NOT EXISTS aziz_import_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  requested_batch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','completed_with_errors','failed')),
  provider TEXT NOT NULL,
  requested_symbols_json TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aziz_symbols (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL CHECK(market IN ('sa','us')),
  symbol TEXT NOT NULL,
  provider_symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  replacement_for TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(market, symbol)
);

CREATE TABLE IF NOT EXISTS aziz_market_datasets (
  id TEXT PRIMARY KEY,
  import_run_id TEXT NOT NULL REFERENCES aziz_import_runs(id),
  symbol_id TEXT NOT NULL REFERENCES aziz_symbols(id),
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  availability_basis TEXT NOT NULL CHECK(availability_basis IN ('retrieval_time_only','provider_published_time')),
  raw_sha256 TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  source_status TEXT NOT NULL,
  source_message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aziz_market_bars (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES aziz_market_datasets(id),
  symbol_id TEXT NOT NULL REFERENCES aziz_symbols(id),
  provider TEXT NOT NULL,
  session_date TEXT NOT NULL,
  opened REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  closed REAL NOT NULL,
  adjusted_close REAL,
  volume REAL,
  retrieved_at TEXT NOT NULL,
  available_at TEXT,
  availability_basis TEXT NOT NULL CHECK(availability_basis IN ('retrieval_time_only','provider_published_time')),
  quality_flags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(symbol_id, provider, session_date)
);

CREATE TABLE IF NOT EXISTS aziz_corporate_events (
  id TEXT PRIMARY KEY,
  symbol_id TEXT NOT NULL REFERENCES aziz_symbols(id),
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_date TEXT,
  announced_at TEXT,
  available_at TEXT,
  source_url TEXT,
  source_payload TEXT,
  retrieved_at TEXT NOT NULL,
  availability_basis TEXT NOT NULL CHECK(availability_basis IN ('unknown','provider_published_time')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS aziz_bars_symbol_session_idx ON aziz_market_bars(symbol_id, session_date);
CREATE INDEX IF NOT EXISTS aziz_datasets_symbol_retrieved_idx ON aziz_market_datasets(symbol_id, retrieved_at);
CREATE INDEX IF NOT EXISTS aziz_events_symbol_available_idx ON aziz_corporate_events(symbol_id, available_at);

INSERT OR IGNORE INTO aziz_symbols (id,market,symbol,provider_symbol,name,sector,created_at,updated_at) VALUES
 ('aziz-sa-2222','sa','2222.SR','2222','أرامكو','الطاقة',datetime('now'),datetime('now')),
 ('aziz-sa-1120','sa','1120.SR','1120','مصرف الراجحي','البنوك',datetime('now'),datetime('now')),
 ('aziz-sa-2010','sa','2010.SR','2010','سابك','الصناعات والمواد',datetime('now'),datetime('now')),
 ('aziz-sa-7010','sa','7010.SR','7010','stc','الاتصالات',datetime('now'),datetime('now')),
 ('aziz-sa-2082','sa','2082.SR','2082','أكوا باور','المرافق والطاقة',datetime('now'),datetime('now')),
 ('aziz-sa-4013','sa','4013.SR','4013','د. سليمان الحبيب','الرعاية الصحية',datetime('now'),datetime('now')),
 ('aziz-us-aapl','us','AAPL','AAPL','Apple','التقنية',datetime('now'),datetime('now')),
 ('aziz-us-msft','us','MSFT','MSFT','Microsoft','البرمجيات والسحابة',datetime('now'),datetime('now')),
 ('aziz-us-nvda','us','NVDA','NVDA','NVIDIA','أشباه الموصلات',datetime('now'),datetime('now')),
 ('aziz-us-xom','us','XOM','XOM','Exxon Mobil','الطاقة',datetime('now'),datetime('now')),
 ('aziz-us-jpm','us','JPM','JPM','JPMorgan','البنوك',datetime('now'),datetime('now')),
 ('aziz-us-jnj','us','JNJ','JNJ','Johnson & Johnson','الرعاية الصحية',datetime('now'),datetime('now'));

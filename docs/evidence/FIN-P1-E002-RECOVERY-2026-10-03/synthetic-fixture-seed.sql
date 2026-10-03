-- Synthetic test-only rows for E-002. The database is a fresh local D1 instance.
INSERT INTO site_settings (id,value) VALUES (90261003,'{"fixture":"E002","source":"synthetic-local"}');
INSERT INTO paper_portfolios (id,name,currency,pin_hash,attempts,window_started,created_at,updated_at,data)
VALUES ('e002-synthetic-portfolio-001','E002 synthetic fixture portfolio','USD','',0,0,'2026-10-03T00:00:00.000Z','2026-10-03T00:00:00.000Z','{"id":"e002-synthetic-portfolio-001","fixture":"E002"}');
INSERT INTO paper_trades (id,portfolio_id,symbol,side,quantity,price,currency,created_at,data)
VALUES ('e002-synthetic-trade-001','legacy','SYNTH','buy','2','25.00','USD','2026-10-03T00:00:00.000Z','{"fixture":"E002","source":"synthetic-local"}');
INSERT INTO paper_cash_entries (id,portfolio_id,cash_type,amount,currency,created_at,data)
VALUES ('e002-synthetic-cash-001','legacy','deposit','10000.00','USD','2026-10-03T00:00:00.000Z','{"fixture":"E002","source":"synthetic-local"}');
INSERT INTO analysis_snapshots (id,symbol,created_at,data)
VALUES ('e002-synthetic-snapshot-001','SYNTH','2026-10-03T00:00:00.000Z','{"fixture":"E002","source":"synthetic-local"}');
INSERT INTO forecast_records (id,snapshot_id,symbol,created_at,horizon,model,market,sector,confidence,available,data)
VALUES ('e002-synthetic-forecast-001','e002-synthetic-snapshot-001','SYNTH','2026-10-03T00:00:00.000Z',5,'E002 synthetic model','us','synthetic-fixture','low',1,'{"fixture":"E002","source":"synthetic-local"}');

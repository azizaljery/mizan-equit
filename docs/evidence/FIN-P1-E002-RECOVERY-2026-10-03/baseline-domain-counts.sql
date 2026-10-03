SELECT 'site_settings' AS table_name, COUNT(*) AS row_count FROM site_settings
UNION ALL SELECT 'paper_portfolios', COUNT(*) FROM paper_portfolios
UNION ALL SELECT 'paper_trades', COUNT(*) FROM paper_trades
UNION ALL SELECT 'paper_cash_entries', COUNT(*) FROM paper_cash_entries
UNION ALL SELECT 'analysis_snapshots', COUNT(*) FROM analysis_snapshots
UNION ALL SELECT 'forecast_records', COUNT(*) FROM forecast_records;

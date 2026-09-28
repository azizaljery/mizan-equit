type D1Like = {
  prepare(sql: string): {
    all(): Promise<{results?: unknown[]}>;
    first(): Promise<unknown>;
  };
};

type ArchiveRow = {
  id: string;
  market: 'sa' | 'us';
  symbol: string;
  name: string;
  bars: number;
  first_session: string | null;
  last_session: string | null;
  last_retrieved_at: string | null;
  datasets: number;
  events: number;
};

export async function readAzizArchiveStatus(db: D1Like) {
  const rows = await db.prepare(`
    SELECT s.id, s.market, s.symbol, s.name,
      COUNT(b.id) AS bars,
      MIN(b.session_date) AS first_session,
      MAX(b.session_date) AS last_session,
      MAX(b.retrieved_at) AS last_retrieved_at,
      (SELECT COUNT(*) FROM aziz_market_datasets d WHERE d.symbol_id=s.id) AS datasets,
      (SELECT COUNT(*) FROM aziz_corporate_events e WHERE e.symbol_id=s.id) AS events
    FROM aziz_symbols s
    LEFT JOIN aziz_market_bars b ON b.symbol_id=s.id
    WHERE s.active=1
    GROUP BY s.id, s.market, s.symbol, s.name
    ORDER BY s.market, s.symbol
  `).all();
  const symbols = ((rows.results || []) as ArchiveRow[]).map(row => ({
    ...row,
    bars: Number(row.bars) || 0,
    datasets: Number(row.datasets) || 0,
    events: Number(row.events) || 0,
  }));
  const latestRun = await db.prepare(
    'SELECT id, started_at, finished_at, requested_batch, status, provider, result_json FROM aziz_import_runs ORDER BY started_at DESC LIMIT 1'
  ).first();
  return {
    scope: 'aziz_archive',
    symbols,
    totalBars: symbols.reduce((sum, row) => sum + row.bars, 0),
    withBars: symbols.filter(row => row.bars > 0).length,
    expectedSymbols: symbols.length,
    latestRun,
    // Stored bars alone do not establish five-year completeness or point-in-time validity.
    historicalCompleteness: 'not_verified',
  };
}

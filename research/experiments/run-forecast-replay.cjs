#!/usr/bin/env node
/**
 * Point-in-time replay of the REAL forecasts() engine on historical prices (price-only, context omitted — same
 * honesty rule as lib/backtest/forecast-walk-forward.ts: no market/sector/peer/news/fact data is invented).
 *
 * usage: node run-forecast-replay.cjs <built-lib-dir> <prices-dir> <out.json> [stepSessions=5]
 * <built-lib-dir> = tsc CJS output of mizan-v45 (contains ./lib/research-model.js).
 * Output rows: [symbol, market, issuedDate, horizonSessions, available, direction, expectedChangePct, neutralThresholdPct, confidence, actualReturnPct, sigmaPct]
 */
const fs = require('fs'), path = require('path');
const [, , libDir, priceDir, outFile, stepArg] = process.argv;
const step = Number(stepArg || 5);
const {forecasts} = require(path.resolve(libDir, 'lib/research-model'));
const {DEFAULT_SETTINGS} = require(path.resolve(libDir, 'lib/site-settings'));
const HORIZONS = [{name: 'يوم', sessions: 1}, {name: 'أسبوع', sessions: 5}, {name: 'شهر', sessions: 21}, {name: '3 أشهر', sessions: 63}];
const WARMUP = 504;
const rows = [];
for (const file of fs.readdirSync(priceDir).filter((f) => f.endsWith('.json')).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(priceDir, file), 'utf8'));
  const prices = d.rows.map((r) => ({date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5]}));
  const market = d.symbol.endsWith('.SR') ? 'sa' : 'us';
  for (const h of HORIZONS) {
    for (let o = WARMUP - 1; o + h.sessions < prices.length; o += step) {
      const asOf = prices[o].date;
      const slice = {company: {symbol: d.symbol, name: d.symbol, exchange: market === 'sa' ? 'SAU' : 'NMS', instrument: 'EQUITY'}, asOf,
        retrievedAt: new Date(asOf + 'T20:00:00Z').toISOString(), prices: prices.slice(0, o + 1), priceSource: 'backtest-replay', quoteTime: null,
        currency: d.currency || (market === 'sa' ? 'SAR' : 'USD'), facts: [], official: null, news: [], peers: [], checks: [], warnings: [], mode: 'historical',
        context: {market: null, sector: null}};
      let r;
      try { r = forecasts(slice, null, Date.parse(asOf + 'T20:00:00Z'), DEFAULT_SETTINGS, [h]).rows[0]; } catch (e) { continue; }
      const ref = prices[o].close, actual = 100 * (prices[o + h.sessions].close / ref - 1);
      // realized daily sigma over 63 sessions up to the origin (PIT) for horizon scaling
      const rets = []; for (let i = Math.max(1, o - 62); i <= o; i++) rets.push(Math.log(prices[i].close / prices[i - 1].close));
      const m = rets.reduce((a, b) => a + b, 0) / rets.length, sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1));
      rows.push([d.symbol, market, asOf, h.sessions, r.available ? 1 : 0, r.direction, r.expectedChangePct ?? null, r.neutralThresholdPct ?? null, r.confidence,
        +actual.toFixed(4), +(100 * sd).toFixed(4)]);
    }
  }
  process.stderr.write(`${d.symbol} done, rows=${rows.length}\n`);
}
fs.writeFileSync(outFile, JSON.stringify(rows));
console.log('rows', rows.length);

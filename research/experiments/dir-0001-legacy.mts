/**
 * DIR-0001 — "old metric beside the new one" (PROTOCOL-DIR-0001 §2.4 / §5).
 *   usage: tsx research/experiments/dir-0001-legacy.mts <prices-dir> [results.json=research/results/DIR-0001-dev.json]
 *
 * Replays the CURRENT forecasts() (mizan-v45/lib/research-model.ts, read-only) point-in-time on exactly the (symbol, date) pairs of
 * the DIR-0001 test dates (same holdout cut, same universe, same non-overlapping dates, evaluable folds only), price-only with no
 * market / sector / news / facts context (same honesty rule as run-forecast-replay.cjs). Writes `legacy_metric` into the results JSON.
 * Old metric = hit rate of forecasts() on its NON-NEUTRAL calls (direction صاعد/هابط vs sign of the h-session return) + coverage.
 */
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const NS = require(path.join(here, 'negsel-0002.cjs'));
const D = require(path.join(here, 'dir-0001.cjs'));
const {forecasts} = await import(path.join(here, '..', '..', 'mizan-v45', 'lib', 'research-model.ts'));
const {DEFAULT_SETTINGS} = await import(path.join(here, '..', '..', 'mizan-v45', 'lib', 'site-settings.ts'));

const [, , dir, resArg] = process.argv;
if (!dir) { console.error('usage: tsx dir-0001-legacy.mts <prices-dir> [results.json]'); process.exit(2); }
const resPath = resArg || path.join(here, '..', 'results', 'DIR-0001-dev.json');
const res = JSON.parse(fs.readFileSync(resPath, 'utf8'));
const series = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const {cutoff, cut} = NS.applyDevCut(series.slice().sort((a: any, b: any) => (a.symbol < b.symbol ? -1 : 1)));
NS.assertNoHoldout(cut, cutoff);
if (cutoff !== res.dev_cutoff.date) throw new Error('cutoff mismatch with results file');
const raw = new Map<string, any>(cut.map((s: any) => [s.symbol, s]));
const UP = 'صاعد', DOWN = 'هابط', NEUTRAL = 'محايد';
const out: Record<string, any> = {};
for (const m of ['sa', 'us']) {
  const ctx = D.buildContext(m, cut.filter((s: any) => (m === 'sa') === /\.SR$/.test(s.symbol)));
  for (const h of [5, 21]) {
    const folds = res.data.markets[m].horizons[`h${h}`].folds;
    const evalYears = new Set(folds.filter((f: any) => f.evaluable).map((f: any) => f.year));
    const panel = D.buildPanel(ctx, h);
    const years = D.testYearsOf(ctx.cal);
    const recs = D.selectTestRecords(panel, h, years[0]).filter((r: any) => evalYears.has(r.year));
    let n = 0, avail = 0, nonNeutral = 0, hit = 0, up = 0, nnUpCalls = 0, unavailableErr = 0;
    for (const r of recs) for (let j = 0; j < r.ids.length; j++) {
      n++; up += r.y[j];
      const s = raw.get(r.ids[j]);
      const rows = s.rows.filter((x: any) => Array.isArray(x) && x[0] <= r.date && Number.isFinite(x[4]) && x[4] > 0);
      const prices = rows.map((x: any) => ({date: x[0], open: x[1], high: x[2], low: x[3], close: x[4], volume: Number.isFinite(x[5]) ? x[5] : 0}));
      const slice = {company: {symbol: s.symbol, name: s.symbol, exchange: m === 'sa' ? 'SAU' : 'NMS', instrument: 'EQUITY'}, asOf: r.date,
        retrievedAt: new Date(r.date + 'T20:00:00Z').toISOString(), prices, priceSource: 'backtest-replay', quoteTime: null,
        currency: s.currency || (m === 'sa' ? 'SAR' : 'USD'), facts: [], official: null, news: [], peers: [], checks: [], warnings: [], mode: 'historical',
        context: {market: null, sector: null}};
      let row: any;
      try { row = forecasts(slice as any, null, Date.parse(r.date + 'T20:00:00Z'), DEFAULT_SETTINGS, [{name: `h${h}`, sessions: h}]).rows[0]; } catch { unavailableErr++; continue; }
      if (!row.available) continue;
      avail++;
      if (row.direction === NEUTRAL) continue;
      if (row.direction !== UP && row.direction !== DOWN) continue;
      nonNeutral++;
      if (row.direction === UP) nnUpCalls++;
      if ((row.direction === UP) === (r.y[j] === 1)) hit++;
    }
    out[`${m}|h${h}`] = {n_pairs: n, available_share_pct: n ? +(100 * avail / n).toFixed(3) : null, non_neutral_coverage_pct: n ? +(100 * nonNeutral / n).toFixed(3) : null,
      n_non_neutral: nonNeutral, hit_on_non_neutral_pct: nonNeutral ? +(100 * hit / nonNeutral).toFixed(3) : null, up_calls_share_of_non_neutral_pct: nonNeutral ? +(100 * nnUpCalls / nonNeutral).toFixed(3) : null,
      base_up_rate_same_pairs_pct: n ? +(100 * up / n).toFixed(3) : null, errors: unavailableErr,
      note: nonNeutral ? 'hit = direction matches sign of close[t+h]/close[t]-1 (> 0 = up)' : 'no non-neutral calls: hit rate undefined (غير معرّف)'};
    console.error(m, h, JSON.stringify(out[`${m}|h${h}`]));
  }
}
res.legacy_metric = {engine: 'mizan-v45/lib/research-model.ts forecasts() (read-only), DEFAULT_SETTINGS, price-only, context omitted', pairs: 'same (symbol, date) pairs as the DIR-0001 test dates of evaluable folds', results: out};
fs.writeFileSync(resPath, JSON.stringify(res, null, 1) + '\n');
console.log(JSON.stringify(res.legacy_metric, null, 1));

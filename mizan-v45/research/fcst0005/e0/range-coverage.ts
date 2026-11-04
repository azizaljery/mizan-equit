// FCST-0005 E0-a: DESCRIPTIVE range diagnostics on the guarded, cut, hashed development input (<= 2024-09-04). Not a test.
// Two quantities are kept apart on purpose:
//   A. IN-SAMPLE CONSTRUCTION COVERAGE: share of the historical h-session returns that were used to BUILD the range which fall inside it.
//   B. ROLLING-ORIGIN COVERAGE ON THE EXPOSED WINDOW: the range at origin t (built from data <= t) against the realised close at t+h.
//      B is still NOT an out-of-sample coverage test: the window is exposed, the design constants (q10/q90, 1.28155 sigma floor,
//      penalty, 504-session window) were not frozen against it by a pre-registered protocol, and the stocks were chosen with hindsight.
// The range comes from the PRODUCTION function `forecasts` (imported, not copied) on price-only historical reports.
// usage: FCST_REPO=<git repo root> bun range-coverage.ts <out.json>
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {loadTruncated, toSeries, CUTOFF} from '../dev-input-guard.mjs';
import {blockBootstrapCI} from '../candidate.mjs';
import {forecasts} from '../../../lib/research-model';
import {DEFAULT_SETTINGS} from '../../../lib/site-settings';

const GRID = 5, WINDOW = 504, H = [1, 5, 21], B = 2000, SEED = 20261103;
const REPO = process.env.FCST_REPO!, REF = process.env.FCST_REF || 'origin/research-data';
const run = (a: string[]) => execFileSync('git', ['-C', REPO, ...a], {maxBuffer: 1 << 28}).toString('utf8');
const files = run(['ls-tree', '-r', '--name-only', REF]).split('\n').filter(f => /prices\/[^/]+\.json$/.test(f)).sort();
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const HZ = H.map(s => ({name: 'h' + s, sessions: s}));

type Row = {m: string; sym: string; h: number; date: string; year: number; avail: boolean; reason: string; inSample: number | null; covered: boolean | null; below: boolean | null; above: boolean | null; neutral: boolean | null; dir: string; sample: number | null; halfWidthLog: number | null};
const rows: Row[] = [], manifest: any[] = [];
for (const f of files) {
  const L = loadTruncated(run(['show', `${REF}:${f}`]), CUTOFF), S: any = toSeries(L);
  manifest.push({file: f.split('/').pop(), digest: L.digest, rows: L.rows.length});
  if (S.close.length < 252 + 63 + 60) continue;
  const sym = L.symbol || f.split('/').pop()!.replace('.json', ''), m = sym.endsWith('.SR') ? 'sa' : 'us', cur = m === 'sa' ? 'SAR' : 'USD', n = S.close.length;
  for (let t = 252; t < n; t += GRID) {
    const from = Math.max(0, t - WINDOW + 1), prices: any[] = [];
    for (let i = from; i <= t; i++) prices.push({date: S.dates[i], open: S.open[i], high: S.high[i], low: S.low[i], close: S.close[i], volume: S.volume[i]});
    const last = prices[prices.length - 1], now = Date.parse(last.date + 'T20:00:00Z');
    const report: any = {company: {symbol: sym, name: sym, exchange: 'RESEARCH', sector: 'x', industry: 'x', source: 'research://truncated'}, currency: cur, asOf: last.date, retrievedAt: last.date + 'T20:00:00.000Z',
      quoteTime: null, priceSource: 'research://truncated', prices, facts: [], official: null, news: [], peers: [], checks: [], warnings: [], mode: 'historical'};
    let out: any; try { out = forecasts(report, null, now, DEFAULT_SETTINGS, HZ); } catch { continue; }
    for (const r of out.rows) {
      const h = r.sessions, tgt = t + h;
      const base: any = {m, sym, h, date: S.dates[t], year: +S.dates[t].slice(0, 4), avail: !!r.available, reason: r.available ? '' : String((r as any).reasons?.[0] ?? 'unknown').slice(0, 60), inSample: null, covered: null, below: null, above: null, neutral: null, dir: r.direction, sample: r.sample ?? null, halfWidthLog: null};
      if (r.available && r.range) {
        const [lo, hi] = r.range as [number, number], p0 = S.close[t];
        // A: historical h-returns inside the window the range was built from (same prices <= t), expressed against the origin price
        const rets: number[] = []; for (let i = h; i < prices.length; i++) rets.push(Math.log(prices[i].close / prices[i - h].close));
        const a = Math.log(lo / p0), b = Math.log(hi / p0);
        base.inSample = rets.length ? rets.filter(v => v >= a && v <= b).length / rets.length : null;
        base.halfWidthLog = (b - a) / 2; base.neutral = r.direction === 'محايد';
        if (tgt < n) { const c = S.close[tgt]; base.covered = c >= lo && c <= hi; base.below = c < lo; base.above = c > hi; }
      }
      rows.push(base);
    }
  }
}
// ---- aggregation: origin-date level, then circular block bootstrap over dates (block = max(1, ceil(h / GRID)))
const agg = (xs: Row[], pick: (r: Row) => number | null, h: number) => {
  const byDate = new Map<string, number[]>(); for (const r of xs) { const v = pick(r); if (v === null) continue; (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(v); }
  const d = [...byDate.entries()].sort((x, y) => x[0] < y[0] ? -1 : 1).map(([, v]) => mean(v)); if (d.length < 10) return {n: d.length};
  const ci = blockBootstrapCI(d, Math.max(1, Math.ceil(h / GRID)), B, SEED); return {n: d.length, mean: ci.mean, lo: ci.lo, hi: ci.hi, block: Math.max(1, Math.ceil(h / GRID))};
};
const cells: any[] = [];
for (const m of ['sa', 'us']) for (const h of H) {
  const xs = rows.filter(r => r.m === m && r.h === h), av = xs.filter(r => r.avail);
  const withY = av.filter(r => r.covered !== null);
  const years = [...new Set(withY.map(r => r.year))].sort();
  const nonNeutral = av.filter(r => r.neutral === false);
  cells.push({market: m, h, originRows: xs.length, availableShare: xs.length ? av.length / xs.length : null,
    unavailableReasons: Object.entries(xs.filter(r => !r.avail).reduce((o: any, r) => (o[r.reason] = (o[r.reason] || 0) + 1, o), {})).sort((a: any, b: any) => b[1] - a[1]).slice(0, 5),
    A_inSampleConstruction: agg(av, r => r.inSample, h),
    B_rollingOrigin_exposed: agg(withY, r => r.covered ? 1 : 0, h),
    B_belowShare: agg(withY, r => r.below ? 1 : 0, h), B_aboveShare: agg(withY, r => r.above ? 1 : 0, h),
    B_byYear: years.map(y => ({year: y, ...agg(withY.filter(r => r.year === y), r => r.covered ? 1 : 0, h)})),
    medianHalfWidthLogPct: (() => { const w = av.map(r => r.halfWidthLog!).filter(Number.isFinite).sort((a, b) => a - b); return w.length ? 100 * w[Math.floor(w.length / 2)] : null; })(),
    neutralShare: av.length ? av.filter(r => r.neutral).length / av.length : null, exitShareUp: av.length ? av.filter(r => r.dir === 'صاعد').length / av.length : null, exitShareDown: av.length ? av.filter(r => r.dir === 'هابط').length / av.length : null,
    nonNeutralRows: nonNeutral.length});
}
const result = {experiment: 'FCST-0005-E0a', kind: 'descriptive, exposed development window, no accuracy claim', cutoff: CUTOFF, productionFunction: 'forecasts() from lib/research-model.ts',
  settings: 'DEFAULT_SETTINGS', conformalCalibrationEnabled: false, parameters: {grid: GRID, engineWindow: WINDOW, horizons: H, B, seed: SEED}, manifest, cells,
  labels: {A: 'in-sample construction coverage (property of how the range is built; not a test)', B: 'rolling-origin coverage on an EXPOSED window (descriptive; not out-of-sample validation)'}};
writeFileSync(process.argv[2], JSON.stringify(result, null, 1));
console.log(cells.map(c => `${c.market}/h${c.h} avail=${(100 * c.availableShare).toFixed(1)}% A=${(100 * c.A_inSampleConstruction.mean).toFixed(1)}% B=${(100 * c.B_rollingOrigin_exposed.mean).toFixed(1)}% [${(100 * c.B_rollingOrigin_exposed.lo).toFixed(1)},${(100 * c.B_rollingOrigin_exposed.hi).toFixed(1)}] n=${c.B_rollingOrigin_exposed.n}`).join('\n'));

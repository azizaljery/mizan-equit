// FCST-0006: range experiment on the EXPOSED development window C (<= 2024-09-04), through dev-input-guard only. Descriptive development evidence; no production approval.
// usage: FCST_REPO=<git repo root> bun range-run.ts <out.json>
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {loadTruncated, toSeries, CUTOFF} from '../fcst0005/dev-input-guard.mjs';
import {sigma63, blockBootstrapMeans, bootstrapP, holmAdjust} from '../fcst0005/candidate.mjs';
import * as R from './range-core.mjs';
import {forecasts} from '../../lib/research-model';
import {DEFAULT_SETTINGS} from '../../lib/site-settings';

const WINDOW = 504, CANDS = ['R1', 'R2', 'R3'] as const, ALL = ['P', 'R1', 'R2', 'R3'] as const;
const REPO = process.env.FCST_REPO!, REF = process.env.FCST_REF || 'origin/research-data';
const run = (a: string[]) => execFileSync('git', ['-C', REPO, ...a], {maxBuffer: 1 << 28}).toString('utf8');
const files = run(['ls-tree', '-r', '--name-only', REF]).split('\n').filter(f => /prices\/[^/]+\.json$/.test(f)).sort();
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const HZ = R.H.map(s => ({name: 'h' + s, sessions: s}));
type Rng = [number, number] | null;
type Row = {m: string; h: number; date: string; year: number; y: number; S: number; P: Rng; R1: Rng; R2: Rng; R3: Rng};
const rows: Row[] = [], manifest: any[] = [], calendar: Record<string, Set<string>> = {sa: new Set(), us: new Set()};
for (const f of files) {
  const L = loadTruncated(run(['show', `${REF}:${f}`]), CUTOFF), S: any = toSeries(L);
  manifest.push({file: f.split('/').pop(), digest: L.digest, rows: L.rows.length});
  const n = S.close.length; if (n < 252 + 63 + 60) continue;
  const sym = L.symbol || f.split('/').pop()!.replace('.json', ''), m = sym.endsWith('.SR') ? 'sa' : 'us', cur = m === 'sa' ? 'SAR' : 'USD';
  for (const d of S.dates) calendar[m].add(d);
  const pk: number[] = S.high.map((hi: number, i: number) => R.parkinson(hi, S.low[i]));
  const har: any = Object.fromEntries(R.H.map(h => [h, R.harForecaster(pk, h)]));
  const hist: any = Object.fromEntries(R.H.map(h => [h, {P: [] as any[], R1: [] as any[]}]));   // entries {t, lo, mid, hi, y|null}
  for (let t = 252; t < n; t += R.GRID) {
    const from = Math.max(0, t - WINDOW + 1), prices: any[] = [];
    for (let i = from; i <= t; i++) prices.push({date: S.dates[i], open: S.open[i], high: S.high[i], low: S.low[i], close: S.close[i], volume: S.volume[i]});
    const last = prices[prices.length - 1], now = Date.parse(last.date + 'T20:00:00Z');
    const report: any = {company: {symbol: sym, name: sym, exchange: 'RESEARCH', sector: 'x', industry: 'x', source: 'research://truncated'}, currency: cur, asOf: last.date, retrievedAt: last.date + 'T20:00:00.000Z',
      quoteTime: null, priceSource: 'research://truncated', prices, facts: [], official: null, news: [], peers: [], checks: [], warnings: [], mode: 'historical'};
    let out: any; try { out = forecasts(report, null, now, DEFAULT_SETTINGS, HZ); } catch { continue; }
    const p0 = S.close[t], s63 = sigma63(S.close, t);
    for (const r of out.rows) {
      const h = r.sessions as number, hf = har[h](t);                                   // always advance HAR state, in order
      if (!r.available || !r.range || !(r.predictedPrice > 0)) continue;
      const lo = Math.log(r.range[0] / p0), mid = Math.log(r.predictedPrice / p0), hi = Math.log(r.range[1] / p0);
      if (!(lo < mid && mid < hi)) continue;
      const y = t + h < n ? Math.log(S.close[t + h] / p0) : null, H0 = hist[h];
      const past = (list: any[]) => list.filter(e => e.t + h <= t && e.y !== null).map(e => R.confScore(e.lo, e.mid, e.hi, e.y));   // only targets resolved by t
      const r1: Rng = hf ? [mid - R.Z80 * hf.sigma, mid + R.Z80 * hf.sigma] : null;
      const r2: Rng = r1 ? R.confAdjust(r1[0], mid, r1[1], past(H0.R1)) as Rng : null;
      const r3: Rng = R.confAdjust(lo, mid, hi, past(H0.P)) as Rng;
      H0.P.push({t, lo, mid, hi, y}); if (r1) H0.R1.push({t, lo: r1[0], mid, hi: r1[1], y});
      if (y !== null && Number.isFinite(s63) && s63 > 0) rows.push({m, h, date: S.dates[t], year: +S.dates[t].slice(0, 4), y, S: s63 * Math.sqrt(h), P: [lo, hi], R1: r1, R2: r2, R3: r3});
    }
  }
}
// ---- aggregation on the COMMON set (all four ranges available), date level, circular block bootstrap
const cells: any[] = [], tests: {key: string; p: number}[] = [];
for (const m of ['sa', 'us']) for (const h of R.H) {
  const xs = rows.filter(r => r.m === m && r.h === h), common = xs.filter(r => r.R1 && r.R2 && r.R3);
  const dates = [...new Set(common.map(r => r.date))].sort();
  // CORRECTION after run 1 (disclosed in FCST-0006-RANGE-RESULTS): origin grids are per stock, so distinct dates are NOT spaced GRID sessions apart when calendars differ.
  // Span is now counted in market trading sessions between the first and last common date; this can only make testability and the block length stricter.
  const spanSessions = dates.length ? [...calendar[m]].filter(d => d >= dates[0] && d <= dates[dates.length - 1]).length : 0;
  const perSession = spanSessions ? dates.length / spanSessions : 0, block = Math.max(1, Math.ceil(h * perSession)), nonOverlap = Math.floor(spanSessions / h);
  const testable = nonOverlap >= R.MIN_NONOVERLAP && dates.length >= 30;
  const byDate = (pick: (r: Row) => number) => { const g = new Map<string, number[]>(); for (const r of common) (g.get(r.date) ?? g.set(r.date, []).get(r.date)!).push(pick(r)); return dates.map(d => mean(g.get(d)!)); };
  const stat = (k: typeof ALL[number]) => {
    const score = byDate(r => R.intervalScore(r[k]![0], r[k]![1], r.y) / r.S), cov = byDate(r => r.y >= r[k]![0] && r.y <= r[k]![1] ? 1 : 0);
    const years = [...new Set(common.map(r => r.year))].sort().map(yr => { const ds = [...new Set(common.filter(r => r.year === yr).map(r => r.date))]; const c = common.filter(r => r.year === yr); return {year: yr, dates: ds.length, coverage: mean(c.map(r => r.y >= r[k]![0] && r.y <= r[k]![1] ? 1 : 0))}; }).filter(y => y.dates >= R.YEAR_MIN_DATES);
    const w = common.map(r => (r[k]![1] - r[k]![0]) / r.S).sort((a, b) => a - b);
    return {score, meanScore: mean(score), coverage: mean(cov), below: mean(byDate(r => r.y < r[k]![0] ? 1 : 0)), above: mean(byDate(r => r.y > r[k]![1] ? 1 : 0)), years,
      yearSpread: years.length ? Math.max(...years.map(y => y.coverage)) - Math.min(...years.map(y => y.coverage)) : null, medianWidthNorm: w.length ? w[Math.floor(w.length / 2)] : null};
  };
  if (dates.length < 10) { cells.push({market: m, h, originRows: xs.length, commonRows: common.length, dates: dates.length, nonOverlap, testable: false, note: 'too few common dates'}); for (const c of CANDS) tests.push({key: `${m}/${h}/${c}`, p: 1}); continue; }
  const P = stat('P'), cand: any = {};
  for (const c of CANDS) {
    const s = stat(c), d = s.score.map((v, i) => v - P.score[i]), means = blockBootstrapMeans(d, block, R.B, R.SEED), p = testable ? bootstrapP(means) : 1;
    const sorted = [...means].sort((a, b) => a - b), relOf = (v: number) => -v / P.meanScore;
    cand[c] = {meanScore: s.meanScore, relImprovement: relOf(mean(d)), relCI95: [relOf(sorted[Math.floor(0.975 * sorted.length)]), relOf(sorted[Math.floor(0.025 * sorted.length)])], rawP: p,
      coverage: s.coverage, below: s.below, above: s.above, years: s.years, yearSpread: s.yearSpread, medianWidthNorm: s.medianWidthNorm};
    tests.push({key: `${m}/${h}/${c}`, p});
  }
  cells.push({market: m, h, originRows: xs.length, commonRows: common.length, dates: dates.length, firstDate: dates[0], lastDate: dates[dates.length - 1], spanSessions, block, nonOverlap, testable,
    P: {meanScore: P.meanScore, coverage: P.coverage, below: P.below, above: P.above, years: P.years, yearSpread: P.yearSpread, medianWidthNorm: P.medianWidthNorm}, candidates: cand});
}
const adj = holmAdjust(tests.map(t => t.p)); tests.forEach((t, i) => { const [m, h, c] = t.key.split('/'); const cell = cells.find(x => x.market === m && String(x.h) === h); if (cell?.candidates) cell.candidates[c].holmP = adj[i]; });
for (const cell of cells) if (cell.candidates) for (const c of CANDS) {
  const k = cell.candidates[c], yearsOk = k.years.every((y: any) => y.coverage >= R.YEAR_FLOOR), spreadOk = k.yearSpread === null || cell.P.yearSpread === null || k.yearSpread <= cell.P.yearSpread + 1e-12;
  k.checks = {improvement: k.relImprovement >= R.DELTA_R, holm: k.holmP <= 0.05, coverageFloor: k.coverage >= R.COVER_FLOOR, yearFloor: yearsOk, yearSpreadNotWider: spreadOk};
  k.verdict = !cell.testable ? 'غير محسوم (غير قابلة للاختبار)' : Object.values(k.checks).every(Boolean) ? 'واعد للأمامي' : (k.relImprovement < R.DELTA_R || !k.checks.coverageFloor || !k.checks.yearFloor) ? 'لم يحقق معيار القبول' : 'غير محسوم';
}
const result = {experiment: 'FCST-0006', kind: 'development evidence on the EXPOSED window C; descriptive; no production approval; no coverage guarantee', cutoff: CUTOFF,
  parameters: {alpha: R.ALPHA, z80: R.Z80, deltaR: R.DELTA_R, coverFloor: R.COVER_FLOOR, yearFloor: R.YEAR_FLOOR, harMinTrain: R.HAR_MIN_TRAIN, harLags: R.HAR_LAGS, confTarget: R.CONF_TARGET, confMin: R.CONF_MIN, confMax: R.CONF_MAX, grid: R.GRID, engineWindow: WINDOW, B: R.B, seed: R.SEED, family: R.FAMILY, minNonOverlap: R.MIN_NONOVERLAP},
  manifest, cells};
writeFileSync(process.argv[2], JSON.stringify(result, null, 1));
for (const c of cells) console.log(`${c.market}/h${c.h} dates=${c.dates} nonOverlap=${c.nonOverlap} testable=${c.testable}` + (c.candidates ? ` Pcov=${(100 * c.P.coverage).toFixed(1)} ` + CANDS.map(k => `${k}: rel=${(100 * c.candidates[k].relImprovement).toFixed(1)}% cov=${(100 * c.candidates[k].coverage).toFixed(1)} holm=${c.candidates[k].holmP.toFixed(3)} ${c.candidates[k].verdict}`).join(' | ') : ''));

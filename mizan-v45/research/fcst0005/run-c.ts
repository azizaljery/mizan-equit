// FCST-0005 stage 1 on the EXPOSED development window C (<= 2024-09-04). Reads stored price files ONLY through dev-input-guard.
// usage: bun run-c.ts <out.json>      (reads blobs of branch origin/research-data via `git show`; nothing is written to disk but the result)
// Output is aggregate: per-cell statistics and decisions, file digests and row counts. No price rows.
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {loadTruncated, toSeries, CUTOFF} from './dev-input-guard.mjs';
import {runAll, RUN_HORIZONS, FAMILY_M, SEEDS, B_DEFAULT} from './runner.mjs';
import {engineAt, WINDOW} from './engine-bias';

const REPO = process.env.FCST_REPO!, REF = process.env.FCST_REF || 'origin/research-data';
const run = (a: string[]) => execFileSync('git', ['-C', REPO, ...a], {maxBuffer: 1 << 28}).toString('utf8');
const files = run(['ls-tree', '-r', '--name-only', REF]).split('\n').filter(f => /prices\/[^/]+\.json$/.test(f)).sort();
const stocks: any[] = [], manifest: any[] = [], skipped: any[] = [];
for (const f of files) {
  const L = loadTruncated(run(['show', `${REF}:${f}`]), CUTOFF), S = toSeries(L);
  manifest.push({file: f.split('/').pop(), digest: L.digest, rows: L.rows.length, usable: S.close.length, first: L.firstDate, last: L.lastDate, laterRowCount: L.laterRowCount});
  if (S.close.length < 252 + 63 + 60) { skipped.push({file: f, reason: 'too few usable sessions', n: S.close.length}); continue; }
  const sym = L.symbol || f.split('/').pop()!.replace('.json', '');
  stocks.push({symbol: sym, market: sym.endsWith('.SR') ? 'sa' : 'us', currency: sym.endsWith('.SR') ? 'SAR' : 'USD', ...S});
}
const calendars: Record<string, string[]> = {};
for (const m of ['sa', 'us']) calendars[m] = [...new Set(stocks.filter(s => s.market === m).flatMap(s => s.dates))].sort();
// engine values for every origin t (gridStep 1, protocol: all sessions are origins); bias and C_pub for the three horizons
const GRID = 1, engCache: Record<string, any[]> = {};
const t0 = Date.now();
for (const m of ['sa', 'us']) {
  const list = stocks.filter(s => s.market === m);
  engCache[m] = list.map(s => {
    const col: (any | null)[] = new Array(s.close.length).fill(null);
    for (let t = 252; t < s.close.length; t++) if (t % GRID === 0) col[t] = engineAt(s, t, RUN_HORIZONS);
    return col;
  });
}
const engMs = Date.now() - t0;
const engFor = (m: string) => (i: number, t: number, h: number) => engCache[m][i][t]?.[h] ?? null;
const t1 = Date.now();
const res = runAll({stocks, calendars, engFor, gridStep: GRID, B: B_DEFAULT});
const out = {
  protocol: 'PROTOCOL-FCST-0005', stage: 'exposed-development-window-C', cutoff: CUTOFF, cleanData: false,
  parameters: {gridStep: GRID, B: B_DEFAULT, seeds: SEEDS, familyM: FAMILY_M, engineWindow: WINDOW, kappa: 0.5, delta: 0.01},
  stocks: {sa: stocks.filter(s => s.market === 'sa').length, us: stocks.filter(s => s.market === 'us').length}, skipped, manifest,
  timings: {engineMs: engMs, runMs: Date.now() - t1},
  decisions: res.decisions, controls: res.controls, testYears: res.testYears, trainStats: res.trainStats,
  cells: res.cells.map(c => ({market: c.market, h: c.h, model: c.model, ok: c.ok, testable: c.testable, deltaMin: c.deltaMin, nDates: c.nDates, p: c.p, holmP: c.holmP,
    relImprovement: c.relImprovement, ciLower: c.ciLower, ciUpper: c.ciUpper, stableOk: c.stableOk,
    vsR0: c.vsR0.ok ? {rel: c.vsR0.relImprovement, lo: c.vsR0.ciLower, hi: c.vsR0.ciUpper, p: c.vsR0.p, maeC: c.vsR0.maeC, maeRef: c.vsR0.maeR, block: c.vsR0.block} : null,
    vsCpub: c.vsC.ok ? {rel: c.vsC.relImprovement, lo: c.vsC.ciLower, hi: c.vsC.ciUpper, p: c.vsC.p, maeC: c.vsC.maeC, maeRef: c.vsC.maeR, block: c.vsC.block} : null,
    yearly: c.vsR0.ok ? c.vsR0.yearly : null})),
};
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(JSON.stringify({stocks: out.stocks, skipped: skipped.length, timings: out.timings, decisions: out.decisions.map((d: any) => `${d.market}/h${d.h}: ${d.status} (${d.reason}) best=${d.bestModel}`)}, null, 1));

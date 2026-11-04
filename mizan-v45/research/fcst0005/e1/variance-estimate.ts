// FCST-0005 E1: PRE-FREEZE VARIANCE ESTIMATION on the development slice C (<= 2024-09-04) ONLY, via the dev-input guard.
// Fixed method (stated before any V data is opened; never re-run on V/F/restricted data):
//   d_t   = per-origin-date paired difference (NAE_cand - NAE_ref)/MAE_ref, averaged over stocks (exactly the runner's pairStats statistic)
//   SE_boot = sd of the circular-block-bootstrap means (block = max(h, first |acf|<0.1 lag, capped 20); B = 2000; frozen seed)
//   SE_NW   = Newey-West (Bartlett) long-run SE of mean(d), bandwidth L = max(h, floor(4*(n/100)^(2/9)))
//   SE_plan = max over {models, references} of max(SE_boot, SE_NW)            [the planning noise of a cell]
//   yearRatio = max over years of sd_year(d) / sd(d)                          [evidence on regime variability inside C]
// usage: FCST_REPO=<git root> bun variance-estimate.ts <out.json>
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {loadTruncated, toSeries, CUTOFF} from '../dev-input-guard.mjs';
import {evaluateMarket, RUN_HORIZONS, MODELS, SEEDS, B_DEFAULT} from '../runner.mjs';
import {blockBootstrapMeans} from '../candidate.mjs';
import {engineAt} from '../engine-bias';

const REPO = process.env.FCST_REPO!, REF = process.env.FCST_REF || 'origin/research-data', GRID = 1;
const run = (a: string[]) => execFileSync('git', ['-C', REPO, ...a], {maxBuffer: 1 << 28}).toString('utf8');
const files = run(['ls-tree', '-r', '--name-only', REF]).split('\n').filter(f => /prices\/[^/]+\.json$/.test(f)).sort();
const stocks: any[] = [];
for (const f of files) { const L = loadTruncated(run(['show', `${REF}:${f}`]), CUTOFF), S = toSeries(L); if (S.close.length < 252 + 63 + 60) continue;
  const sym = L.symbol || f.split('/').pop()!.replace('.json', ''); stocks.push({symbol: sym, market: sym.endsWith('.SR') ? 'sa' : 'us', currency: sym.endsWith('.SR') ? 'SAR' : 'USD', ...S}); }
const calendars: Record<string, string[]> = {}; for (const m of ['sa', 'us']) calendars[m] = [...new Set(stocks.filter(s => s.market === m).flatMap(s => s.dates))].sort();
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const acf = (d: number[], L: number) => { const m = mean(d); let a = 0, b = 0; for (let i = 0; i < d.length; i++) { b += (d[i] - m) ** 2; if (i >= L) a += (d[i] - m) * (d[i - L] - m); } return b ? a / b : 0; };
function nwSE(d: number[], L: number) { const n = d.length, m = mean(d); let s = d.reduce((t, v) => t + (v - m) ** 2, 0) / n; for (let l = 1; l <= L; l++) { let g = 0; for (let i = l; i < n; i++) g += (d[i] - m) * (d[i - l] - m); s += 2 * (1 - l / (L + 1)) * g / n; } return Math.sqrt(Math.max(s, 0) / n); }
const out: any = {protocol: 'PROTOCOL-FCST-0005', stage: 'variance-estimation-on-development-slice-C', cutoff: CUTOFF, method: 'see header', cells: []};
const byDate = (arr: any[]) => { const m = new Map<string, number[]>(); for (const r of arr) (m.get(r.date) ?? m.set(r.date, []).get(r.date)!).push(r.nae); return m; };
const engCache: Record<string, any[]> = {};
for (const m of ['sa', 'us']) {
  const list = stocks.filter(s => s.market === m);
  engCache[m] = list.map(s => { const col: any[] = new Array(s.close.length).fill(null); for (let t = 252; t < s.close.length; t++) col[t] = engineAt(s, t, RUN_HORIZONS); return col; });
  const res = evaluateMarket({market: m, stocks, eng: (i: number, t: number, h: number) => engCache[m][i][t]?.[h] ?? null, calendar: calendars[m], gridStep: GRID, B: B_DEFAULT, variant: 'real'});
  for (const h of RUN_HORIZONS) {
    const pm: any = (res as any).out[h].perModel;
    for (const model of MODELS) for (const ref of ['R0', 'CPUB']) {
      const mc = byDate(pm[model]), mr = byDate(pm[ref]), dates = [...mc.keys()].filter(d => mr.has(d)).sort(); if (dates.length < 30) continue;
      const nc = dates.map(d => mean(mc.get(d)!)), nr = dates.map(d => mean(mr.get(d)!)), maeR = mean(nr), d = dates.map((_, i) => (nc[i] - nr[i]) / maeR);
      let L = 1; while (L < 20 && Math.abs(acf(d, L)) >= 0.1) L++;
      const block = Math.max(h, L), means = blockBootstrapMeans(d, block, B_DEFAULT, SEEDS.boot), seBoot = sd(means), bw = Math.max(h, Math.floor(4 * (d.length / 100) ** (2 / 9))), seNW = nwSE(d, bw);
      const yrs = new Map<string, number[]>(); dates.forEach((dt, i) => (yrs.get(dt.slice(0, 4)) ?? yrs.set(dt.slice(0, 4), []).get(dt.slice(0, 4))!).push(d[i]));
      const ys = [...yrs.entries()].filter(([, v]) => v.length >= 30).map(([y, v]) => ({year: y, n: v.length, sd: sd(v)})), s0 = sd(d);
      out.cells.push({market: m, h, model, ref, n: d.length, meanD: mean(d), sdD: s0, acf1: acf(d, 1), acfH: acf(d, Math.min(h, d.length - 2)), block, seBoot, seNW, seMax: Math.max(seBoot, seNW), years: ys, yearRatio: ys.length && s0 > 0 ? Math.max(...ys.map(y => y.sd)) / s0 : null});
    }
  }
}
out.plan = {};
for (const m of ['sa', 'us']) for (const h of RUN_HORIZONS) { const cs = out.cells.filter((c: any) => c.market === m && c.h === h && c.sdD > 1e-9); if (!cs.length) continue;
  const w = cs.reduce((a: any, b: any) => b.seMax > a.seMax ? b : a); out.plan[`${m}/${h}`] = {n: w.n, sePlan: w.seMax, from: `${w.model} vs ${w.ref}`, seBoot: w.seBoot, seNW: w.seNW, maxYearRatio: Math.max(...cs.map((c: any) => c.yearRatio ?? 1))}; }
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(Object.entries(out.plan).map(([k, v]: any) => `${k} n=${v.n} sePlan=${(100 * v.sePlan).toFixed(3)}% boot=${(100 * v.seBoot).toFixed(3)} nw=${(100 * v.seNW).toFixed(3)} yearRatio=${v.maxYearRatio.toFixed(2)} (${v.from})`).join('\n'));

// FCST-0007: descriptive binary direction study on the EXPOSED window C (<= 2024-09-04) through dev-input-guard. Development evidence only; not a confirmation.
// usage: FCST_REPO=<repo> bun direction-c.ts <out.json>
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {loadTruncated, toSeries, CUTOFF} from '../fcst0005/dev-input-guard.mjs';
import {engineAt} from '../fcst0005/engine-bias';
const REPO = process.env.FCST_REPO!, REF = process.env.FCST_REF || 'origin/research-data';
const run = (a: string[]) => execFileSync('git', ['-C', REPO, ...a], {maxBuffer: 1 << 28}).toString('utf8');
const files = run(['ls-tree', '-r', '--name-only', REF]).split('\n').filter(f => /prices\/[^/]+\.json$/.test(f)).sort();
const H = [1, 5, 21, 63], GRID = 5, sgn = (v: number) => v > 0 ? 1 : v < 0 ? -1 : 0, mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const sma = (c: number[], t: number, n: number) => { let s = 0; for (let i = t - n + 1; i <= t; i++) s += c[i]; return s / n; };
type Rec = {m: string; h: number; date: string; y: number; s: Record<string, number>};
const recs: Rec[] = [];
for (const f of files) {
  const L = loadTruncated(run(['show', `${REF}:${f}`]), CUTOFF), S: any = toSeries(L), c: number[] = S.close, n = c.length; if (n < 400) continue;
  const sym = L.symbol || f.split('/').pop()!.replace('.json', ''), m = sym.endsWith('.SR') ? 'sa' : 'us';
  const series = {symbol: sym, currency: m === 'sa' ? 'SAR' : 'USD', ...S};
  for (let t = 252; t < n; t += GRID) {
    const eng = engineAt(series, t, H);
    const base: Record<string, number> = {mom12_1: Math.log(c[t - 21] / c[t - 252]), mom6: Math.log(c[t - 5] / c[t - 126]), trend: sma(c, t, 50) / sma(c, t, 200) - 1,
      rev1: -Math.log(c[t] / c[t - 1]), rev5: -Math.log(c[t] / c[t - 5]), rev21: -Math.log(c[t] / c[t - 21]), up: 1};
    for (const h of H) {
      if (t + h >= n) continue; const y = Math.log(c[t + h] / c[t]); if (y === 0) continue;
      const e = eng?.[h]?.bias ?? 0, s: Record<string, number> = {...base, engine: e};
      s.voteTrend = sgn(s.mom12_1) + sgn(s.trend) + sgn(s.mom6);
      s.voteTrendEngine = s.voteTrend + sgn(e);
      s.voteAll = s.voteTrendEngine + sgn(h <= 1 ? s.rev1 : h <= 5 ? s.rev5 : s.rev21);
      recs.push({m, h, date: S.dates[t], y, s});
    }
  }
}
const keys = Object.keys(recs[0].s), out: any[] = [];
for (const m of ['sa', 'us']) for (const h of H) {
  const xs = recs.filter(r => r.m === m && r.h === h), dates = [...new Set(xs.map(r => r.date))].sort();
  const cell: any = {market: m, h, rows: xs.length, dates: dates.length, upShare: mean(xs.map(r => r.y > 0 ? 1 : 0)), rules: {}};
  for (const k of keys) {
    const called = xs.filter(r => sgn(r.s[k]) !== 0), g = new Map<string, number[]>();
    for (const r of called) (g.get(r.date) ?? g.set(r.date, []).get(r.date)!).push(sgn(r.s[k]) === sgn(r.y) ? 1 : 0);
    const d = [...g.values()].map(mean), mu = mean(d), sd = Math.sqrt(d.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, d.length - 1));
    // strong-signal subset: top tercile of |signal| among called rows
    const abs = called.map(r => Math.abs(r.s[k])).sort((a, b) => a - b), cut = abs[Math.floor(abs.length * 2 / 3)] ?? Infinity, strong = called.filter(r => Math.abs(r.s[k]) >= cut);
    cell.rules[k] = {calls: called.length, callShare: called.length / xs.length, hit: mu, se: sd / Math.sqrt(d.length), strongCalls: strong.length, strongHit: strong.length ? mean(strong.map(r => sgn(r.s[k]) === sgn(r.y) ? 1 : 0)) : null};
  }
  out.push(cell);
}
writeFileSync(process.argv[2], JSON.stringify({experiment: 'FCST-0007 direction study', kind: 'descriptive on exposed window C; SE ignores serial correlation of overlapping horizons', cutoff: CUTOFF, grid: GRID, cells: out}, null, 1));
for (const c of out) console.log(`${c.market}/h${c.h} dates=${c.dates} up=${(100 * c.upShare).toFixed(1)} | ` + keys.map(k => `${k}:${(100 * c.rules[k].hit).toFixed(1)}±${(100 * c.rules[k].se).toFixed(1)}${c.rules[k].strongHit !== null && k !== 'up' ? '(' + (100 * c.rules[k].strongHit).toFixed(0) + ')' : ''}`).join(' '));

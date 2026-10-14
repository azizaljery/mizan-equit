#!/usr/bin/env node
/**
 * HYP-NEGSEL-0001 (price-only proxy): does EXCLUDING the weakest names (negative selection) improve forward outcomes
 * out of sample?  Composite = mean cross-sectional rank of mom126_5, trend50_200, mom252_21 (fixed ex-ante, not tuned).
 * usage: node loser-exclusion.cjs <prices-dir> [cutFraction=0.6]
 * Per date (non-overlapping horizons), per market: survivors = top (1-q) by composite. Compare survivors vs all:
 *   hit rate (fwd return>0), mean log return, and excluded-group's mean return. Date-level bootstrap CI (2000 resamples).
 * CAVEAT: universe = today's large caps (survivorship bias), 2 markets, one regime. Evidence is exploratory only.
 */
const fs = require('fs'), path = require('path');
const [, , priceDir, cutArg] = process.argv; const CUT = Number(cutArg || 0.6);
const data = {};
for (const f of fs.readdirSync(priceDir).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(priceDir, f), 'utf8'));
  data[d.symbol] = d.rows.map((r) => ({date: r[0], c: r[4], h: r[2], l: r[3]}));
}
const sma = (p, i, n) => p.slice(i - n + 1, i + 1).reduce((s, x) => s + x.c, 0) / n;
const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); idx.forEach(([, i], k) => { r[i] = k / (a.length - 1); }); return r; };
function score(p, i) { return [Math.log(p[i - 5].c / p[i - 126].c), Math.log(sma(p, i, 50) / sma(p, i, 200)), Math.log(p[i - 21].c / p[i - 252].c)]; }
const allDates = [...new Set(Object.values(data).flatMap((p) => p.map((x) => x.date)))].sort();
const cut = allDates[Math.floor(allDates.length * CUT)];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function boot(arr, fn, B = 2000) { const out = []; let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; for (let b = 0; b < B; b++) { const s = []; for (let k = 0; k < arr.length; k++) s.push(arr[Math.floor(rnd() * arr.length)]); out.push(fn(s)); } out.sort((x, y) => x - y); return [out[Math.floor(B * 0.025)], out[Math.floor(B * 0.975)]]; }
const res = {cut, notes: 'exploratory; survivorship-biased universe', results: []};
for (const mkt of ['sa', 'us']) for (const h of [5, 21, 63]) for (const q of [0.3, 0.5]) {
  const syms = Object.keys(data).filter((s) => (s.endsWith('.SR') ? 'sa' : 'us') === mkt);
  const idxOf = {}; for (const s of syms) { idxOf[s] = {}; data[s].forEach((x, i) => { idxOf[s][x.date] = i; }); }
  const dates = allDates.filter((d) => syms.filter((s) => idxOf[s][d] !== undefined).length >= 20);
  const perDate = {train: [], test: []};
  for (let k = 0; k < dates.length; k += h) {
    const d = dates[k], rows = [];
    for (const s of syms) { const i = idxOf[s][d]; const p = data[s]; if (i === undefined || i < 260 || !p[i + h]) continue; rows.push({sc: score(p, i), fwd: Math.log(p[i + h].c / p[i].c)}); }
    if (rows.length < 20) continue;
    const comp = [0, 1, 2].map((j) => rank(rows.map((r) => r.sc[j]))); const c = rows.map((_, n) => (comp[0][n] + comp[1][n] + comp[2][n]) / 3);
    const order = c.map((v, n) => [v, n]).sort((x, y) => x[0] - y[0]).map((x) => x[1]); const nEx = Math.floor(rows.length * q);
    const excl = order.slice(0, nEx).map((n) => rows[n].fwd), surv = order.slice(nEx).map((n) => rows[n].fwd), all = rows.map((r) => r.fwd);
    (d < cut ? perDate.train : perDate.test).push({hitAll: mean(all.map((x) => +(x > 0))), hitSurv: mean(surv.map((x) => +(x > 0))), retAll: mean(all), retSurv: mean(surv), retExcl: mean(excl)});
  }
  const sum = (arr) => arr.length < 5 ? null : {nDates: arr.length, hitAll: +(100 * mean(arr.map((a) => a.hitAll))).toFixed(1), hitSurv: +(100 * mean(arr.map((a) => a.hitSurv))).toFixed(1), liftHitPts: +(100 * mean(arr.map((a) => a.hitSurv - a.hitAll))).toFixed(2), liftHitCI95: boot(arr, (s) => 100 * mean(s.map((a) => a.hitSurv - a.hitAll))).map((x) => +x.toFixed(2)), excessRetSurvPct: +(100 * mean(arr.map((a) => a.retSurv - a.retAll))).toFixed(3), excessRetCI95: boot(arr, (s) => 100 * mean(s.map((a) => a.retSurv - a.retAll))).map((x) => +x.toFixed(3)), excludedMinusAllPct: +(100 * mean(arr.map((a) => a.retExcl - a.retAll))).toFixed(3)};
  res.results.push({market: mkt, horizon: h, excludeShare: q, train: sum(perDate.train), test: sum(perDate.test)});
}
console.log(JSON.stringify(res, null, 1));

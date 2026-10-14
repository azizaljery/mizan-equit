#!/usr/bin/env node
/**
 * Out-of-sample cross-sectional information coefficients of simple price features vs forward returns (point-in-time).
 * usage: node feature-ic.cjs <prices-dir> [replay.json]   -- replay.json adds the current model score (exp) as one more feature.
 * Chronological split 60/40; IC measured on non-overlapping dates (spacing >= horizon). t-stat uses those dates only.
 */
const fs = require('fs'), path = require('path');
const [, , priceDir, replayFile] = process.argv;
const H = [1, 5, 21, 63], STEP = 1;
const data = {};
for (const f of fs.readdirSync(priceDir).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(priceDir, f), 'utf8'));
  data[d.symbol] = d.rows.map((r) => ({date: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5]}));
}
const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
function feats(p, i) { // all use data up to and including index i
  const c = (k) => p[i - k].c, r = (a, b) => Math.log(c(a) / c(b));
  const rets = []; for (let j = i - 62; j <= i; j++) rets.push(Math.log(p[j].c / p[j - 1].c));
  const sig = sd(rets), hi = Math.max(...p.slice(i - 251, i + 1).map((x) => x.h)), lo = Math.min(...p.slice(i - 251, i + 1).map((x) => x.l));
  let g = 0, ls = 0; for (let j = i - 13; j <= i; j++) { const d = p[j].c - p[j - 1].c; if (d > 0) g += d; else ls -= d; }
  const sma = (n) => p.slice(i - n + 1, i + 1).reduce((s, x) => s + x.c, 0) / n;
  const tr = []; for (let j = i - 19; j <= i; j++) tr.push(Math.max(p[j].h - p[j].l, Math.abs(p[j].h - p[j - 1].c), Math.abs(p[j].l - p[j - 1].c)));
  const v20 = p.slice(i - 19, i + 1).reduce((s, x) => s + x.v, 0) / 20;
  return {
    mom5: r(0, 5), mom21: r(0, 21), mom63_5: r(5, 63), mom126_5: r(5, 126), mom252_21: r(21, 252),
    mom21_vol: r(0, 21) / (sig * Math.sqrt(21)), mom63_vol: r(5, 63) / (sig * Math.sqrt(58)),
    rev5: -r(0, 5), rev21: -r(0, 21), rsi14: 100 - 100 / (1 + g / (ls || 1e-9)), rsi_rev: -(100 - 100 / (1 + g / (ls || 1e-9))),
    dist52hi: Math.log(p[i].c / hi), dist52lo: Math.log(p[i].c / lo), trend50_200: Math.log(sma(50) / sma(200)), px_sma50: Math.log(p[i].c / sma(50)),
    lowvol: -sig, atrpct_low: -(tr.reduce((a, b) => a + b, 0) / 20) / p[i].c, rvol: p[i].v / (v20 || 1), illiq_low: -1 / (Math.log(1 + v20 * p[i].c)),
  };
}
const rows = []; // per symbol, date index
for (const [sym, p] of Object.entries(data)) for (let i = 260; i < p.length - 1; i += STEP) {
  if (i % 1) continue; const f = feats(p, i); rows.push({sym, mkt: sym.endsWith('.SR') ? 'sa' : 'us', date: p[i].date, i, f});
}
const bySym = data;
const model = {}; if (replayFile) for (const r of JSON.parse(fs.readFileSync(replayFile, 'utf8'))) if (r[4] === 1 && r[6] !== null) model[`${r[0]}|${r[2]}|${r[3]}`] = r[6];
const dates = [...new Set(rows.map((r) => r.date))].sort(), cut = dates[Math.floor(dates.length * 0.6)];
const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const av = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = av; i = j + 1; } return r; };
const corr = (x, y) => { const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); };
const names = Object.keys(rows[0].f).concat(replayFile ? ['MODEL_exp'] : []);
const byDate = {}; for (const r of rows) (byDate[r.date] ||= []).push(r);
const out = {cut, results: {}};
for (const h of H) {
  const res = {};
  const datesH = dates.filter((d, k) => k % h === 0); // non-overlapping forward windows
  for (const name of names) {
    const tr = [], te = [];
    for (const d of datesH) {
      const group = byDate[d]; if (!group || group.length < 30) continue;
      const xs = [], ys = [];
      for (const r of group) {
        const p = bySym[r.sym]; const fwd = p[r.i + h] ? Math.log(p[r.i + h].c / p[r.i].c) : null; if (fwd === null) continue;
        let x = name === 'MODEL_exp' ? model[`${r.sym}|${r.date}|${h}`] : r.f[name]; if (x === undefined || !Number.isFinite(x)) continue; xs.push(x); ys.push(fwd);
      }
      if (xs.length < 30) continue;
      const ic = corr(rank(xs), rank(ys)); if (!Number.isFinite(ic)) continue; (d < cut ? tr : te).push(ic);
    }
    const st = (a) => a.length > 2 ? {n: a.length, ic: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(4), t: +((a.reduce((x, y) => x + y, 0) / a.length) / (sd(a) / Math.sqrt(a.length))).toFixed(2), hit: +(100 * a.filter((v) => v > 0).length / a.length).toFixed(1)} : null;
    res[name] = {train: st(tr), test: st(te)};
  }
  out.results[h] = res;
}
console.log(JSON.stringify(out));

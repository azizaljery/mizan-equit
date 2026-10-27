#!/usr/bin/env node
'use strict';
/**
 * PROTOCOL-FCST-0001 runner. usage: node run-fcst-0001.cjs <built-lib-dir> <prices-dir> <out.json> [--design]
 * Rows are cut at DEV_CUTOFF BEFORE any computation (sealed holdout never read). Models R0,R1,C0,M1 as frozen in the protocol.
 */
const fs = require('fs'), path = require('path');
const N = require('./negsel-lib.cjs');
const F = require('./fcst-lib.cjs');
const [, , libDir, priceDir, outFile] = process.argv;
const {forecasts} = require(path.resolve(libDir, 'lib/research-model'));
const {DEFAULT_SETTINGS} = require(path.resolve(libDir, 'lib/site-settings'));
const H = F.HORIZONS.map((s) => ({name: 'h' + s, sessions: s}));
const weekKey = (d) => { const t = new Date(d + 'T00:00:00Z'); const k = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - k); return t.toISOString().slice(0, 10); };

// ------------------------------------------------------------ 1) build records
const recs = [];
for (const file of fs.readdirSync(priceDir).filter((f) => f.endsWith('.json')).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(priceDir, file), 'utf8'));
  const raw = N.cutRows(d.rows, F.DEV_CUTOFF);
  const prices = raw.map((r) => ({date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5]}));
  const c = prices.map((p) => p.close);
  const market = d.symbol.endsWith('.SR') ? 'sa' : 'us';
  for (let o = F.WARMUP - 1; o < prices.length - 1; o += F.STEP) {
    const asOf = prices[o].date, sig = F.sigma63(c, o), x = F.featureVector(c, o);
    if (!(sig > 0)) continue;
    // sigma5/sigma20 for the shock slice, trend slice uses |trend50_200|
    const s = (n) => { const r = []; for (let k = o - n + 1; k <= o; k++) r.push(F.logRet(c, k)); return N.sd(r); };
    const shock = s(5) / s(20) > 1.6;
    let slice = null, rows = null;
    const needEngine = F.HORIZONS.some((h) => o + h < prices.length);
    if (needEngine) {
      slice = {company: {symbol: d.symbol, name: d.symbol, exchange: market === 'sa' ? 'SAU' : 'NMS', instrument: 'EQUITY'}, asOf,
        retrievedAt: new Date(asOf + 'T20:00:00Z').toISOString(), prices: prices.slice(0, o + 1), priceSource: 'backtest-replay', quoteTime: null,
        currency: d.currency || (market === 'sa' ? 'SAR' : 'USD'), facts: [], official: null, news: [], peers: [], checks: [], warnings: [], mode: 'historical',
        context: {market: null, sector: null}};
      try { rows = forecasts(slice, null, Date.parse(asOf + 'T20:00:00Z'), DEFAULT_SETTINGS, H).rows; } catch (e) { rows = null; }
    }
    const drift = (() => { let s2 = 0; for (let k = 1; k <= o; k++) s2 += F.logRet(c, k); return s2 / o; })();
    F.HORIZONS.forEach((h, hi) => {
      if (o + h >= prices.length) return;
      const y = Math.log(c[o + h] / c[o]);
      const row = rows && rows[hi], dg = row && row.diagnostics;
      const c0 = row && row.available && dg && dg.center && dg.range && dg.range.low > 0 && dg.range.high > 0 ? {
        yhat: dg.center.centerLogReturn, lo: Math.log(dg.range.low / dg.range.reference), hi: Math.log(dg.range.high / dg.range.reference)} : null;
      recs.push({sym: d.symbol, market, h, date: asOf, week: weekKey(asOf), labelDate: prices[o + h].date, y, sig, x, drift, shock, trendAbs: Math.abs(x[1]), c0,
        c0Reason: c0 ? null : (row ? (dg && dg.state) || 'unavailable' : 'engine_error')});
    });
  }
  process.stderr.write(`${d.symbol} rows=${recs.length}\n`);
}

// ------------------------------------------------------------ 2) evaluation
function fitPredict(train, test, h) {
  // returns arrays aligned with test: per-model {yhat, lo, hi}
  const Xtr = [], ztr = [];
  for (const r of train) if (F.featsFinite(r.x)) { Xtr.push(r.x); ztr.push(r.y / F.scale(r.sig, h)); }
  const m1 = F.fitRidge(Xtr, ztr, F.RIDGE_LAMBDA_PER_N * Xtr.length);
  const zAll = train.map((r) => r.y / F.scale(r.sig, h));
  const qR0 = [F.quantile(zAll, F.Q_LO), F.quantile(zAll, F.Q_HI)];
  const resR1 = train.map((r) => (r.y - h * r.drift) / F.scale(r.sig, h));
  const qR1 = [F.quantile(resR1, F.Q_LO), F.quantile(resR1, F.Q_HI)];
  let qM1 = null;
  if (m1) { const res = []; train.forEach((r) => { if (F.featsFinite(r.x)) res.push(r.y / F.scale(r.sig, h) - F.predictRidge(m1, r.x)); }); qM1 = [F.quantile(res, F.Q_LO), F.quantile(res, F.Q_HI)]; }
  return test.map((r) => {
    const S = F.scale(r.sig, h), out = {};
    out.R0 = {yhat: 0, lo: S * qR0[0], hi: S * qR0[1]};
    const y1 = h * r.drift; out.R1 = {yhat: y1, lo: y1 + S * qR1[0], hi: y1 + S * qR1[1]};
    if (m1 && F.featsFinite(r.x)) { const yh = S * F.predictRidge(m1, r.x); out.M1 = {yhat: yh, lo: yh + S * qM1[0], hi: yh + S * qM1[1]}; }
    if (r.c0) out.C0 = {yhat: r.c0.yhat, lo: r.c0.lo, hi: r.c0.hi};
    return out;
  });
}
function scored(r, pred, h, model) {
  const p = pred[model];
  if (!p) return null;
  const S = F.scale(r.sig, h);
  const dir = F.directionOfLog(p.yhat, h), act = r.y > 0 ? 1 : -1;
  return {nae: F.nae(r.y, p.yhat, r.sig, h), nse: F.nse(r.y, p.yhat, r.sig, h), cover: r.y >= p.lo && r.y <= p.hi ? 1 : 0, width: (p.hi - p.lo) / S,
    wink: F.intervalScore(r.y, p.lo, p.hi, r.sig, h), neutral: dir === 0 ? 1 : 0, signHit: (p.yhat > 0 ? 1 : -1) === act ? 1 : 0, upHit: act === 1 ? 1 : 0, dirNum: dir, hit: dir === 0 ? null : (dir === act ? 1 : 0)};
}
function runFolds(foldList, label, dropFutureLabels) {
  const res = [];
  for (const market of ['sa', 'us']) for (const h of F.HORIZONS) for (const fold of foldList) {
    const all = recs.filter((r) => r.market === market && r.h === h);
    const train = all.filter((r) => r.labelDate < fold.start);
    const test = all.filter((r) => r.date >= fold.start && r.date <= fold.end && r.labelDate <= (fold.maxLabel || F.DEV_CUTOFF));
    if (!test.length || train.length < 30) { res.push({market, h, fold: fold.id, nTrain: train.length, nTest: test.length, skipped: true}); continue; }
    const preds = fitPredict(train, test, h);
    test.forEach((r, i) => { res.push({market, h, fold: fold.id, week: r.week, sym: r.sym, shock: r.shock, trendAbs: r.trendAbs, nTrain: train.length, s: Object.fromEntries(['R0', 'R1', 'C0', 'M1'].map((m) => [m, scored(r, preds[i], h, m)])), c0Reason: r.c0Reason}); });
  }
  return res;
}
const designFolds = [{id: 'design', start: '2022-01-01', end: '2022-03-31', maxLabel: F.DESIGN_END}];
const design = runFolds(designFolds, 'design');
const test = runFolds(F.FOLDS, 'test');

function cell(rows, h, markets, a, b) {
  // paired a vs b over rows where both defined; date unit = ISO week
  const sel = rows.filter((r) => r.h === h && !r.skipped && markets.includes(r.market) && r.s[a] && r.s[b]);
  const pa = F.perDateMeans(sel.map((r) => ({date: r.week, v: r.s[a].nae - r.s[b].nae, a: r.s[a].nae, b: r.s[b].nae})), (r) => r.v);
  const meanA = N.mean(sel.map((r) => r.s[a].nae)), meanB = N.mean(sel.map((r) => r.s[b].nae));
  const bs = F.bootstrapMean(pa.values, h, `${markets.join('+')}|${h}|${a}|${b}`);
  const rho = F.rho1(pa.values), neff = F.effectiveN(pa.dates.length, h, rho);
  const byFold = {};
  for (const f of F.FOLDS) { const x = sel.filter((r) => r.fold === f.id); if (x.length) byFold[f.id] = +(N.mean(x.map((r) => r.s[a].nae - r.s[b].nae))).toFixed(5); }
  const folds = Object.values(byFold);
  return {h, markets: markets.join('+'), a, b, nRecords: sel.length, nWeeks: pa.dates.length, rho: +rho.toFixed(3), nEff: +neff.toFixed(1),
    maeA: +meanA.toFixed(5), maeB: +meanB.toFixed(5), relReductionOfAvsB: +((meanB - meanA) / meanB).toFixed(5), diff: +bs.mean.toFixed(5), ci95: bs.ci95.map((v) => +v.toFixed(5)),
    pOneSided: +bs.pBetter.toFixed(4), foldsBetter: folds.filter((v) => v < 0).length, foldsTotal: folds.length, byFold};
}
function profile(rows, h, market, model) {
  const sel = rows.filter((r) => r.h === h && r.market === market && !r.skipped && r.s[model]);
  if (!sel.length) return null;
  const m = (k) => N.mean(sel.map((r) => r.s[model][k]));
  const hits = sel.filter((r) => r.s[model].hit !== null), k = hits.reduce((a, r) => a + r.s[model].hit, 0), lo = F.wilson(sel.reduce((a, r) => a + r.s[model].cover, 0), sel.length);
  const slice = (f) => { const x = sel.filter(f); return x.length ? {n: x.length, nae: +N.mean(x.map((r) => r.s[model].nae)).toFixed(4)} : null; };
  const trendThr = N.median(sel.map((r) => r.trendAbs));
  return {n: sel.length, nae: +m('nae').toFixed(4), nse: +m('nse').toFixed(4), coverage: +m('cover').toFixed(3), coverageCI95: lo.map((v) => +v.toFixed(3)), width: +m('width').toFixed(3), winkler: +m('wink').toFixed(3),
    neutralShare: +m('neutral').toFixed(3), nDirectional: hits.length, dirAccuracy: hits.length ? +(k / hits.length).toFixed(3) : null,
    calm: slice((r) => !r.shock), shock: slice((r) => r.shock), trendHigh: slice((r) => r.trendAbs > trendThr), trendLow: slice((r) => r.trendAbs <= trendThr)};
}
const out = {protocol: 'PROTOCOL-FCST-0001', devCutoff: F.DEV_CUTOFF, nRecords: recs.length, symbols: Array.from(new Set(recs.map((r) => r.sym))).length};

// design-window power (pseudo-fold, M1 minus R0)
out.design = F.HORIZONS.map((h) => {
  const sel = design.filter((r) => r.h === h && !r.skipped && r.s.M1 && r.s.R0);
  if (!sel.length) return {h, note: 'no_fit'};
  const pd = F.perDateMeans(sel.map((r) => ({date: r.week, v: r.s.M1.nae - r.s.R0.nae})), (r) => r.v);
  const sdv = N.sd(pd.values), mae0 = N.mean(sel.map((r) => r.s.R0.nae));
  return {h, nWeeks: pd.dates.length, sigmaD: +sdv.toFixed(4), maeR0: +mae0.toFixed(4)};
});
// primary + secondary
out.primary = cell(test, F.PRIMARY_H, ['sa', 'us'], 'M1', 'R0');
const sec = [];
for (const market of ['sa', 'us']) for (const h of F.HORIZONS) sec.push(cell(test, h, [market], 'M1', 'R0'));
const adj = N.holm(sec.map((c) => (Number.isFinite(c.pOneSided) ? c.pOneSided : 1)));
sec.forEach((c, i) => { c.pHolm = +adj[i].toFixed(4); });
out.secondary = sec;
out.descriptive = [];
for (const market of ['sa', 'us']) for (const h of F.HORIZONS) for (const [a, b] of [['C0', 'R0'], ['M1', 'C0'], ['R1', 'R0']]) out.descriptive.push(cell(test, h, [market], a, b));
out.profiles = {};
for (const market of ['sa', 'us']) for (const h of F.HORIZONS) out.profiles[`${market}|${h}`] = Object.fromEntries(['R0', 'R1', 'C0', 'M1'].map((m) => [m, profile(test, h, market, m)]));
// AMEND-1 (descriptive): sign-of-centre accuracy vs always-up, per market x horizon
out.direction = [];
for (const market of ['sa', 'us']) for (const h of F.HORIZONS) for (const model of ['C0', 'M1']) {
  const sel = test.filter((r) => r.h === h && r.market === market && !r.skipped && r.s[model]);
  if (!sel.length) continue;
  const upShare = N.mean(sel.map((r) => r.s[model].upHit)), majUp = upShare >= 0.5, baseHit = (r) => (majUp ? r.s[model].upHit : 1 - r.s[model].upHit); // hindsight-majority baseline: deliberately conservative
  const pd = F.perDateMeans(sel.map((r) => ({date: r.week, v: -(r.s[model].signHit - baseHit(r))})), (r) => r.v);
  const bs = F.bootstrapMean(pd.values, h, `dir|${market}|${h}|${model}`), rho = F.rho1(pd.values);
  const nd = sel.filter((r) => r.s[model].dirNum !== 0), w = F.wilson(nd.reduce((a, r) => a + r.s[model].hit, 0), nd.length);
  out.direction.push({market, h, model, n: sel.length, nWeeks: pd.dates.length, nEff: +F.effectiveN(pd.dates.length, h, rho).toFixed(1), signAcc: +N.mean(sel.map((r) => r.s[model].signHit)).toFixed(4), upAcc: +upShare.toFixed(4), baselineAcc: +Math.max(upShare, 1 - upShare).toFixed(4),
    gainOverMajority: +(-bs.mean).toFixed(4), ci95: [+(-bs.ci95[1]).toFixed(4), +(-bs.ci95[0]).toFixed(4)], nDirectional: nd.length, dirAccWilson: nd.length ? [+w[0].toFixed(3), +w[1].toFixed(3)] : null,
    dirAcc: nd.length ? +(nd.reduce((a, r) => a + r.s[model].hit, 0) / nd.length).toFixed(3) : null});
}
// C0 availability
out.c0Availability = F.HORIZONS.map((h) => { const x = recs.filter((r) => r.h === h && r.date >= F.FOLDS[0].start); return {h, n: x.length, available: x.filter((r) => r.c0).length, reasons: x.filter((r) => !r.c0).reduce((m, r) => { m[r.c0Reason] = (m[r.c0Reason] || 0) + 1; return m; }, {})}; });
// center-magnitude diagnostics: |yhat|/S by model (does the centre move at all?)
out.centerMagnitude = {};
for (const h of F.HORIZONS) { const x = recs.filter((r) => r.h === h && r.c0 && r.date >= F.FOLDS[0].start); out.centerMagnitude[h] = x.length ? {n: x.length, medianAbsCentreOverS: +N.median(x.map((r) => Math.abs(r.c0.yhat) / F.scale(r.sig, h))).toFixed(4), medianAbsCentrePct: +(100 * N.median(x.map((r) => Math.abs(Math.exp(r.c0.yhat) - 1)))).toFixed(3), medianHalfWidthOverS: +N.median(x.map((r) => (r.c0.hi - r.c0.lo) / 2 / F.scale(r.sig, h))).toFixed(3)} : null; }
out.meta = {firstOrigin: recs.reduce((a, r) => (r.date < a ? r.date : a), '9999'), lastLabel: recs.reduce((a, r) => (r.labelDate > a ? r.labelDate : a), ''),
  symbols: {sa: new Set(recs.filter((r) => r.market === 'sa').map((r) => r.sym)).size, us: new Set(recs.filter((r) => r.market === 'us').map((r) => r.sym)).size},
  foldRecords: F.FOLDS.map((f) => ({id: f.id, start: f.start, end: f.end, records: test.filter((r) => !r.skipped && r.fold === f.id && r.h === F.PRIMARY_H).length})),
  skipped: test.filter((r) => r.skipped).map((r) => ({market: r.market, h: r.h, fold: r.fold, nTrain: r.nTrain, nTest: r.nTest}))};
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log('done', recs.length, 'records ->', outFile);

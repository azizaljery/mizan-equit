'use strict';
/**
 * Tests for SHARA-BACKFILL-0001 (research/experiments/shara-backfill.cjs). CODE-TESTED only — not predictive evidence.
 * run: node --test research/tests/shara-backfill.test.cjs
 * The replay tests (point-in-time through the REAL forecasts()/SHARA) need a built lib:
 *   SHARA_BF_LIB=<built-lib-dir> node --test ...   (build: NODE_PATH=/opt/npm-tools/node_modules node research/experiments/build-replay-lib.cjs <dir>)
 * If SHARA_BF_LIB is unset the suite tries to build one into a temp dir (needs `typescript` on NODE_PATH); otherwise those tests skip.
 * Optional real-data holdout test: SHARA_BF_SEALED_DIR=<research-data/prices> node --test ...
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const B = require('../experiments/shara-backfill.cjs');

function genDates(n, start = '2019-01-02') {
  const out = []; let d = new Date(start + 'T00:00:00Z');
  while (out.length < n) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
  return out;
}
function genRows(n, start, seed = 1) {
  let x = seed, c = 100; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  return genDates(n, start).map((date) => { c *= Math.exp((rnd() - 0.49) * 0.03); const h = c * 1.01, l = c * 0.99; return [date, +(c * 0.999).toFixed(4), +h.toFixed(4), +l.toFixed(4), +c.toFixed(4), Math.round(1e6 + rnd() * 1e6)]; });
}
function writeSeries(dir, symbol, rows) { fs.writeFileSync(path.join(dir, `${symbol}.json`), JSON.stringify({symbol, currency: symbol.endsWith('.SR') ? 'SAR' : 'USD', rows})); }

// ------------------------------------------------------------------ holdout guard
test('sealed universe parses to the 80 frozen symbols and contains the owner examples; Set A is disjoint', () => {
  const U = B.sealedUniverse();
  assert.equal(U.size, 80);
  for (const s of B.SET_B_SYMBOLS) assert.ok(U.has(s), s);
  for (const s of B.SET_A_SYMBOLS) assert.ok(!U.has(s), s);
  assert.equal(B.SET_A.sa.length, 10); assert.equal(B.SET_A.us.length, 10);
});
test('guardRows cuts every post-cutoff row of a sealed symbol and leaves non-sealed symbols untouched', () => {
  const U = B.sealedUniverse(), rows = genRows(1500, '2019-01-02');
  assert.ok(rows.at(-1)[0] > B.SEALED_CUTOFF_MAX);
  const g = B.guardRows('AAPL', rows, U, B.SEALED_CUTOFF_MAX);
  assert.ok(g.sealed); assert.ok(g.rows.length < rows.length);
  assert.ok(g.rows.every((r) => r[0] <= B.SEALED_CUTOFF_MAX));
  const free = B.guardRows('NFLX', rows, U, B.SEALED_CUTOFF_MAX);
  assert.equal(free.sealed, false); assert.equal(free.rows.length, rows.length);
});
test('loadSeries: poisoned post-cutoff rows of a sealed symbol never reach the prices; identity mismatch refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  const rows = genRows(1500, '2019-01-02');
  const poisoned = rows.map((r) => (r[0] > B.SEALED_CUTOFF_MAX ? [r[0], 1e9, 1e9, 1e9, 1e9, 1e12] : r));
  writeSeries(dir, '2222.SR', poisoned);
  const U = B.sealedUniverse();
  const s = B.loadSeries(dir, '2222.SR', U, B.SEALED_CUTOFF_MAX);
  assert.ok(s.sealed);
  assert.ok(s.prices.every((p) => p.date <= B.SEALED_CUTOFF_MAX && p.close < 1e8));
  fs.writeFileSync(path.join(dir, 'AMZN.json'), JSON.stringify({symbol: 'AMZ', rows}));
  assert.match(B.loadSeries(dir, 'AMZN', U, B.SEALED_CUTOFF_MAX).error, /identity_mismatch/);
});
test('sealedCutoff is never later than SEALED_CUTOFF_MAX and follows determineDevCutoff when earlier', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  // a short calendar ending 2022 -> dev cutoff in 2021, earlier than the constant
  writeSeries(dir, 'AAPL', genRows(500, '2020-01-02'));
  const c = B.sealedCutoff(dir, B.sealedUniverse());
  assert.ok(c < B.SEALED_CUTOFF_MAX);
  writeSeries(dir, 'AAPL', genRows(3000, '2019-01-02')); // calendar up to ~2030 -> computed cutoff later -> clamp
  assert.equal(B.sealedCutoff(dir, B.sealedUniverse()), B.SEALED_CUTOFF_MAX);
  assert.equal(B.sealedCutoff(null, B.sealedUniverse()), B.SEALED_CUTOFF_MAX);
});
test('Set B window: every issue date AND its h=21 outcome date lie on/before the cutoff', () => {
  const U = B.sealedUniverse(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  writeSeries(dir, 'AMZN', genRows(1600, '2019-01-02'));
  const s = B.loadSeries(dir, 'AMZN', U, B.SEALED_CUTOFF_MAX);
  const idx = B.issueWindow(s.prices.length, 60, B.MAX_H);
  assert.equal(idx.length, 60);
  assert.equal(idx.at(-1) + B.MAX_H, s.prices.length - 1);
  for (const o of idx) { assert.ok(s.prices[o].date <= B.SEALED_CUTOFF_MAX); assert.ok(s.prices[o + B.MAX_H].date <= B.SEALED_CUTOFF_MAX); }
});
test('issueWindow returns [] when there is not enough history', () => {
  assert.deepEqual(B.issueWindow(50, 60, 5), []);
  assert.deepEqual(B.issueWindow(64, 60, 5), []);
  assert.deepEqual(B.issueWindow(65, 60, 5), Array.from({length: 60}, (_, i) => i)); // last issue 59, outcome row 64 = n-1
});

// ------------------------------------------------------------------ point-in-time
test('historyAt uses rows <= o only and a 5-calendar-year window', () => {
  const P = B.toPrices(genRows(2000, '2015-01-02'));
  const o = 1800, h = B.historyAt(P, o);
  assert.equal(h.at(-1).date, P[o].date);
  assert.ok(h.every((p) => p.date <= P[o].date));
  assert.ok(h[0].date >= B.minusYears(P[o].date, 5));
  assert.ok(h.length < o + 1);
  // mutating the future must not change the history
  const P2 = P.map((p, i) => (i > o ? {...p, close: NaN} : p));
  assert.deepEqual(B.historyAt(P2, o), h);
});
test('minusYears handles leap days', () => { assert.equal(B.minusYears('2024-02-29', 5), '2019-02-28'); assert.equal(B.minusYears('2024-09-04', 5), '2019-09-04'); });
test('toPrices drops invalid rows, sorts and dedups', () => {
  const P = B.toPrices([['2020-01-03', 1, 1, 1, 1, 5], ['bad', 1, 1, 1, 1, 1], ['2020-01-02', 1, 1, 1, NaN, 1], ['2020-01-02', 2, 2, 2, 2, -1], ['2020-01-03', 9, 9, 9, 9, 9]]);
  assert.deepEqual(P.map((p) => [p.date, p.close, p.volume]), [['2020-01-02', 2, 0], ['2020-01-03', 1, 5]]);
});

// ------------------------------------------------------------------ outcome math
test('outcomePct and directionHit', () => {
  const P = [{close: 100}, {close: 110}, {close: 99}];
  assert.equal(B.outcomePct(P, 0, 1), 10.000000000000009);
  assert.ok(Math.abs(B.outcomePct(P, 0, 2) + 1) < 1e-12);
  assert.equal(B.outcomePct(P, 1, 2), null);
  assert.equal(B.directionHit('صاعد', 0.5), 1); assert.equal(B.directionHit('صاعد', 0), 0); assert.equal(B.directionHit('صاعد', -1), 0);
  assert.equal(B.directionHit('هابط', -0.1), 1); assert.equal(B.directionHit('هابط', 0.1), 0);
  assert.equal(B.directionHit('محايد', 3), null); assert.equal(B.directionHit('غير متاح', 3), null); assert.equal(B.directionHit('صاعد', null), null);
});
test('wilson interval: known values and edge cases', () => {
  const w = B.wilson(5, 10); assert.ok(Math.abs(w.lo - 0.2366) < 1e-3 && Math.abs(w.hi - 0.7634) < 1e-3);
  assert.equal(B.wilson(0, 0).p, null);
  const z = B.wilson(0, 20); assert.equal(z.lo, 0); assert.ok(z.hi > 0.1 && z.hi < 0.2);
  const f = B.wilson(20, 20); assert.equal(f.hi, 1); assert.ok(f.lo > 0.8);
});

// ------------------------------------------------------------------ verdict aggregation
test('combineVerdict: parity first, market only for parity survivors', () => {
  assert.equal(B.combineVerdict('KILL', 'NOT_RUN'), 'KILL');
  assert.equal(B.combineVerdict('SUSPEND', 'NOT_RUN'), 'SUSPEND');
  assert.equal(B.combineVerdict('PASS', 'KILL'), 'KILL');
  assert.equal(B.combineVerdict('PASS', 'SUSPEND'), 'SUSPEND');
  assert.equal(B.combineVerdict('PASS', 'PASS'), 'PASS');
});
test('aggregate counts verdicts, gates and rising hit rates per market×h and all×h', () => {
  const base = {set: 'B', available: true, parityAgrees: true, d2All: [], error: undefined};
  const recs = [
    {...base, symbol: 'X', market: 'us', h: 5, direction: 'صاعد', verdict: 'KILL', parity: 'KILL', parityRule: 'low_or_unknown_confidence', d1: 'PASS', d2: 'PASS', ret: 1, hit: 1, d2All: []},
    {...base, symbol: 'X', market: 'us', h: 5, direction: 'صاعد', verdict: 'KILL', parity: 'KILL', parityRule: 'low_or_unknown_confidence', d1: 'PASS', d2: 'KILL', d2Rule: 'risk_atr_pct', ret: -2, hit: 0, d2All: ['risk_atr_pct:KILL']},
    {...base, symbol: 'Y', market: 'sa', h: 5, direction: 'هابط', verdict: 'KILL', parity: 'KILL', parityRule: 'not_rising', d1: 'KILL', d2: 'PASS', ret: -1, hit: 1},
    {...base, symbol: 'Y', market: 'sa', h: 5, direction: 'محايد', verdict: 'KILL', parity: 'KILL', parityRule: 'not_rising', d1: 'KILL', d2: 'PASS', ret: 0.5, hit: null},
    {...base, symbol: 'Z', market: 'sa', h: 5, error: 'boom', ret: 0.1, hit: null},
  ];
  const a = B.aggregate(recs);
  assert.deepEqual(Object.keys(a).sort(), ['all|h5', 'sa|h5', 'us|h5']);
  const all = a['all|h5'];
  assert.equal(all.n, 5); assert.equal(all.errors, 1); assert.equal(all.available, 4);
  assert.deepEqual(all.verdict, {KILL: 4});
  assert.deepEqual(all.parityRule, {low_or_unknown_confidence: 2, not_rising: 2});
  assert.equal(all.rising.all.n, 2); assert.equal(all.rising.all.k, 1); assert.equal(all.rising.all.meanRet, -0.5);
  assert.equal(all.rising.officialPass.n, 0);
  assert.equal(all.rising.d1PassAndMarketPass.n, 1); assert.equal(all.rising.d1PassAndMarketPass.k, 1);
  assert.equal(all.rising.d1PassMarketRemoved.n, 1); assert.equal(all.rising.d1PassMarketRemoved.k, 0);
  assert.equal(all.directionAccuracyNonNeutral.n, 3); assert.equal(all.directionAccuracyNonNeutral.k, 2);
  assert.equal(all.directionAccuracyNonNeutral.coverage, 3 / 4);
  assert.deepEqual(all.d2AllGates, {'risk_atr_pct:KILL': 1});
  assert.equal(a['us|h5'].n, 2); assert.equal(a['sa|h5'].n, 3);
  assert.ok(B.toMarkdown({set: 'B', symbols: ['X'], window: 60, sealedCutoff: '2024-09-04', records: 5, errors: [], libDir: 'x', windows: {X: null}, sealedSymbols: [], aggregate: a}).includes('all|h5'));
});

// ------------------------------------------------------------------ replay through the real lib (point-in-time end to end)
function libDir() {
  if (process.env.SHARA_BF_LIB) return process.env.SHARA_BF_LIB;
  try {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-lib-'));
    cp.execFileSync(process.execPath, [path.join(__dirname, '../experiments/build-replay-lib.cjs'), out], {stdio: 'ignore', env: {...process.env, NODE_PATH: process.env.NODE_PATH || '/opt/npm-tools/node_modules'}});
    return out;
  } catch { return null; }
}
const LIB = libDir();
test('replay is point-in-time: corrupting every row after the issue date changes neither forecast nor SHARA verdict', {skip: !LIB && 'no built lib'}, async () => {
  const lib = B.loadLib(LIB);
  const P = B.toPrices(genRows(700, '2022-01-03', 7));
  const o = 640, mk = (prices) => {
    const hist = B.historyAt(prices, o), report = B.buildReport('NFLX', 'us', 'USD', hist);
    const res = lib.forecasts(report, null, Date.parse(report.asOf + 'T20:00:00Z'), lib.DEFAULT_SETTINGS, [B.HORIZONS[1]]);
    return {report, c: B.buildCandidate('NFLX', 'us', report, res, 5)};
  };
  const a = mk(P);
  const poisoned = P.map((p, i) => (i > o ? {...p, close: p.close * 50, high: p.high * 50, low: 0.0001, volume: 0} : p));
  const b = mk(poisoned);
  assert.deepEqual(b.c, a.c);
  assert.deepEqual(await B.evaluateCandidate(lib, b.c, b.report), await B.evaluateCandidate(lib, a.c, a.report));
});
test('replaySymbol on a sealed symbol never emits an issue or outcome date after the cutoff; parity always agrees with candidateExclusion', {skip: !LIB && 'no built lib'}, async () => {
  const lib = B.loadLib(LIB), U = B.sealedUniverse(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  writeSeries(dir, 'AAPL', genRows(1600, '2019-01-02', 3));
  const s = B.loadSeries(dir, 'AAPL', U, B.SEALED_CUTOFF_MAX);
  const r = await B.replaySymbol(lib, s, 'B', 10);
  assert.equal(r.records.length, 10 * B.HORIZONS.length);
  for (const x of r.records) {
    assert.ok(x.asOf <= B.SEALED_CUTOFF_MAX); assert.ok(x.outcomeDate && x.outcomeDate <= B.SEALED_CUTOFF_MAX);
    assert.equal(x.parityAgrees, true, JSON.stringify(x));
    assert.equal(x.market, 'us'); // the SHARA market-gate status must not overwrite the record's market (regression)
    assert.ok(['PASS', 'KILL', 'SUSPEND', 'NOT_RUN'].includes(x.marketGate));
    assert.ok(['PASS', 'KILL', 'SUSPEND'].includes(x.verdict));
    assert.ok(x.ret !== null);
  }
});
test('NaN / missing evidence never passes: short history suspends market gates; NaN price kills or suspends parity', {skip: !LIB && 'no built lib'}, async () => {
  const lib = B.loadLib(LIB);
  const P = B.toPrices(genRows(15, '2024-01-02'));
  const report = B.buildReport('NFLX', 'us', 'USD', P);
  const c = {symbol: 'NFLX', market: 'us', currency: 'USD', price: NaN, predictedPrice: 101, direction: 'صاعد', expectedChangePct: 1, range: [90, 110], confidence: 'متوسط', available: true, priceTime: P.at(-1).date, retrievedAt: report.retrievedAt};
  const v = await B.evaluateCandidate(lib, c, report);
  assert.notEqual(v.verdict, 'PASS');
  assert.notEqual(v.d1, 'PASS');
  assert.equal(v.d2, 'SUSPEND'); // < 21 bars -> no market evidence -> SUSPEND, never PASS
});
test('real data (optional): Set B symbols after guard end on/before the sealed cutoff', {skip: !process.env.SHARA_BF_SEALED_DIR && 'SHARA_BF_SEALED_DIR unset'}, () => {
  const dir = process.env.SHARA_BF_SEALED_DIR, U = B.sealedUniverse(), cutoff = B.sealedCutoff(dir, U);
  assert.ok(cutoff <= B.SEALED_CUTOFF_MAX);
  for (const sym of B.SET_B_SYMBOLS) {
    const s = B.loadSeries(dir, sym, U, cutoff);
    assert.ok(s.sealed && s.prices.length > 1000);
    assert.ok(s.prices.at(-1).date <= cutoff, `${sym} ${s.prices.at(-1).date}`);
  }
});

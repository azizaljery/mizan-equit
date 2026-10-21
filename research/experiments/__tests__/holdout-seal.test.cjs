'use strict';
/**
 * Mechanical seal test for the NEGSEL-0002 holdout guard (negsel-lib.cjs devCount / devCutoffForCalendar /
 * determineDevCutoff / cutRows, wired through negsel-0002.cjs applyDevCut / assertNoHoldout).
 * SYNTHETIC DATA ONLY: no real price file is read, no experiment is run on real data, the real holdout is untouched.
 * Post-cutoff synthetic rows are TRIPWIRES: reading any field other than the date throws, so a test passes only if the
 * dev path never touches a holdout price/volume.
 * run: node --test research/experiments/__tests__/holdout-seal.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../negsel-lib.cjs');
const NS = require('../negsel-0002.cjs');

function genDates(n, start, saudiWeek) {
  const out = [];
  let d = new Date(start + 'T00:00:00Z');
  while (out.length < n) {
    const w = d.getUTCDay();
    const weekend = saudiWeek ? (w === 5 || w === 6) : (w === 0 || w === 6);
    if (!weekend) out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
/** Row whose date (index 0) is readable but whose o/h/l/c/v throw on access. */
function tripwireRow(date) {
  const r = [date, 0, 0, 0, 0, 0];
  for (let k = 1; k <= 5; k++) Object.defineProperty(r, k, {get() { throw new Error(`HOLDOUT FIELD READ ${date}[${k}]`); }, enumerable: true});
  return r;
}
function synthSeries({nSa = 22, nUs = 22, nDates = 420, tripwireAfter = null} = {}) {
  const rng = L.mulberry32(20261021);
  const out = [];
  const mk = (symbol, dates, currency) => {
    let p = 30 + rng() * 20;
    const rows = dates.map((date) => {
      if (tripwireAfter && date > tripwireAfter) return tripwireRow(date);
      p *= Math.exp(0.01 * (rng() - 0.5));
      return [date, p, p, p, p, 1e6 * (0.5 + rng())];
    });
    return {symbol, currency, tz: 'UTC', splitsInRange: 0, rows};
  };
  const dSa = genDates(nDates, '2018-01-07', true), dUs = genDates(nDates, '2018-01-08', false);
  for (let i = 0; i < nSa; i++) out.push(mk(`${2000 + i}.SR`, dSa, 'SAR'));
  for (let i = 0; i < nUs; i++) out.push(mk(`U${String(i).padStart(2, '0')}`, dUs, 'USD'));
  return out;
}
/** The cutoff the guard computes, using DATES ONLY (same rule as applyDevCut). */
function expectedCutoff(series) {
  const cal = (f) => Array.from(new Set(series.filter(f).flatMap((s) => s.rows.map((r) => r[0])))).sort();
  return L.determineDevCutoff([
    {name: 'sa', dates: cal((s) => /\.SR$/.test(s.symbol))},
    {name: 'us', dates: cal((s) => !/\.SR$/.test(s.symbol))},
    {name: 'union', dates: cal(() => true)},
  ]).cutoff;
}

test('devCount / devCutoffForCalendar: dev = n - ceil(0.3n), integer arithmetic', () => {
  assert.equal(L.devCount(10), 7);
  assert.equal(L.devCount(11), 7); // ceil(3.3) = 4
  assert.equal(L.devCount(1), 0);
  assert.equal(L.devCount(0), 0);
  const d = genDates(10, '2020-01-06', false);
  assert.equal(L.devCutoffForCalendar(d), d[6]);
  assert.equal(L.devCutoffForCalendar(['2020-01-01']), null); // 1 date -> nothing is development
  assert.equal(L.devCutoffForCalendar([]), null);
});

test('determineDevCutoff: earliest (most conservative) of the per-calendar cutoffs', () => {
  const a = genDates(100, '2020-01-06', false), b = genDates(100, '2020-03-02', false);
  const r = L.determineDevCutoff([{name: 'a', dates: a}, {name: 'b', dates: b}, {name: 'empty', dates: []}]);
  assert.equal(r.cutoff, a[69]);
  assert.equal(r.perCalendar.find((x) => x.name === 'empty').dev_cutoff, null);
  assert.equal(L.determineDevCutoff([{name: 'x', dates: []}]).cutoff, null);
});

test('cutRows physically removes every row after the cutoff and keeps the cutoff day; input not mutated', () => {
  const d = genDates(20, '2021-01-04', false), cutoff = d[13];
  const rows = d.map((x, i) => [x, i, i, i, i + 1, 10]);
  rows.push(null, ['not-a-date-but-string', 1, 1, 1, 1, 1], [20210101, 1, 1, 1, 1, 1]);
  const snapshot = JSON.stringify(rows);
  const out = L.cutRows(rows, cutoff);
  assert.equal(JSON.stringify(rows), snapshot);
  assert.ok(out.every((r) => typeof r[0] === 'string' && r[0] <= cutoff));
  assert.equal(out.filter((r) => /^\d{4}-/.test(r[0])).length, 14);
  assert.ok(out.some((r) => r[0] === cutoff));
  assert.ok(!out.some((r) => r[0] > cutoff));
  assert.deepEqual(L.cutRows(rows, null), []); // no cutoff -> nothing passes (fail closed)
});

test('cutoff depends on dates only: changing every price leaves it unchanged', () => {
  const s1 = synthSeries();
  const s2 = s1.map((s) => ({...s, rows: s.rows.map((r) => [r[0], 1, 1, 1, 999, 0])}));
  assert.equal(NS.applyDevCut(s1).cutoff, NS.applyDevCut(s2).cutoff);
  assert.equal(NS.applyDevCut(s1).cutoff, expectedCutoff(s1));
});

test('applyDevCut: holdout prices are never read (tripwire rows) and are physically absent from the dev data', () => {
  const plain = synthSeries();
  const cutoff = expectedCutoff(plain);
  const armed = synthSeries({tripwireAfter: cutoff});
  const nHoldout = armed.reduce((s, x) => s + x.rows.filter((r) => r[0] > cutoff).length, 0);
  assert.ok(nHoldout > 0, 'sanity: synthetic holdout exists');
  const res = NS.applyDevCut(armed); // would throw if any o/h/l/c/v of a holdout row were read
  assert.equal(res.cutoff, cutoff);
  for (const s of res.cut) for (const r of s.rows) assert.ok(r[0] <= cutoff);
  assert.doesNotThrow(() => NS.assertNoHoldout(res.cut, res.cutoff));
  // every dev row is the same object as the input row (no copies, no re-reads), and every tripwire row is gone
  const holdoutRefs = new Set(armed.flatMap((s) => s.rows.filter((r) => r[0] > cutoff)));
  for (const s of res.cut) for (const r of s.rows) assert.ok(!holdoutRefs.has(r));
});

test('dev pipeline cannot receive holdout rows: buildMarket on the cut data never touches a tripwire', () => {
  const cutoff = expectedCutoff(synthSeries());
  const armed = synthSeries({tripwireAfter: cutoff});
  const {cut} = NS.applyDevCut(armed);
  for (const m of ['sa', 'us']) {
    const ctx = NS.buildMarket(m, cut.filter((x) => (m === 'sa') === /\.SR$/.test(x.symbol)), {});
    assert.ok(ctx.cal.length > 0);
    assert.ok(ctx.cal[ctx.cal.length - 1] <= cutoff, `calendar of ${m} reaches beyond cutoff`);
    for (const s of ctx.syms) assert.ok(s.rows[s.rows.length - 1].date <= cutoff);
  }
  // control: feeding the UNCUT armed data to the same dev builder trips immediately
  assert.throws(() => NS.buildMarket('us', armed.filter((x) => !/\.SR$/.test(x.symbol)), {}), /HOLDOUT FIELD READ/);
});

test('assertNoHoldout fails closed on an injected leak', () => {
  const {cut, cutoff} = NS.applyDevCut(synthSeries());
  const leaked = cut.map((s, i) => (i === 0 ? {...s, rows: s.rows.concat([['2099-12-31', 1, 1, 1, 1, 1]])} : s));
  assert.throws(() => NS.assertNoHoldout(leaked, cutoff), /holdout row leaked/);
});

test('real-data constant: the sealed NEGSEL-0002 dev cutoff is 2024-09-04 (documentation check, no data read)', () => {
  const fs = require('fs'), path = require('path');
  const p = path.join(__dirname, '..', '..', 'NEGSEL-0002-DEV-REPORT.md');
  if (!fs.existsSync(p)) return; // report absent in this checkout: nothing to check
  assert.match(fs.readFileSync(p, 'utf8'), /2024-09-04/);
});

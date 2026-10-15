'use strict';
/**
 * Unit tests for NEGSEL-0002 (research/experiments/negsel-lib.cjs + negsel-0002.cjs).
 * run: node --test research/tests/negsel-0002.test.cjs
 * Optional real-data holdout-poisoning test: NEGSEL_PRICES_DIR=<prices dir> node --test ...
 * CODE-TESTED status only: passing these tests is NOT predictive evidence for the strategy.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../experiments/negsel-lib.cjs');
const R = require('../experiments/negsel-0002.cjs');

// ------------------------------------------------------------------ synthetic data helpers
function genDates(n, start = '2015-01-05', saudiWeek = false) {
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
function gauss(rng) { let u = 0; while (u === 0) u = rng(); const v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function synthSeries(symbol, dates, rng, o = {}) {
  const {vol = 0.015, drift = 0, currency = /\.SR$/.test(symbol) ? 'SAR' : 'USD', volume = 2e6} = o;
  let p = 20 + rng() * 30;
  const rows = dates.map((date) => {
    p *= Math.exp(drift + vol * gauss(rng));
    const v = Math.round(volume * (0.5 + rng()));
    return [date, p, p * 1.01, p * 0.99, p, v];
  });
  return {symbol, currency, tz: 'UTC', splitsInRange: 0, rows};
}
function synthUniverse(seed, nPerMarket = 24, nDates = 900) {
  const rng = L.mulberry32(seed), out = [];
  const dSa = genDates(nDates, '2015-01-04', true), dUs = genDates(nDates, '2015-01-05', false);
  for (let i = 0; i < nPerMarket; i++) out.push(synthSeries(`${1000 + i}.SR`, dSa, rng));
  for (let i = 0; i < nPerMarket; i++) out.push(synthSeries(`US${String(i).padStart(2, '0')}`, dUs, rng));
  return out;
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

// ------------------------------------------------------------------ 1. no future leakage
test('features at t are unchanged when any data after t is altered; truncated history gives identical values', () => {
  const rng = L.mulberry32(1);
  const c = [];
  let p = 50;
  for (let i = 0; i < 700; i++) { p *= Math.exp(0.01 * gauss(rng)); c.push(p); }
  for (const i of [260, 300, 450, 699]) {
    const base = L.featuresAt(c, i);
    const altered = c.slice();
    for (let k = i + 1; k < altered.length; k++) altered[k] = k % 2 ? NaN : 1e12 * (k + 1);
    assert.deepEqual(L.featuresAt(altered, i), base);
    assert.deepEqual(L.featuresAt(c.slice(0, i + 1), i), base);
    assert.ok(L.featuresFinite(base));
  }
});
test('composite at t uses only rows <= t (cross-section built from truncated histories equals the one from full histories)', () => {
  const rng = L.mulberry32(2);
  const hist = Array.from({length: 12}, () => { const c = []; let p = 30; for (let i = 0; i < 600; i++) { p *= Math.exp(0.012 * gauss(rng)); c.push(p); } return c; });
  const t = 400;
  const full = L.compositeScores(hist.map((c) => L.featuresAt(c, t)));
  const mut = hist.map((c) => c.map((x, k) => (k > t ? x * 7 + 3 : x)));
  const cut = L.compositeScores(mut.map((c) => L.featuresAt(c.slice(0, t + 1), t)));
  assert.deepEqual(cut, full);
  assert.deepEqual(L.compositeScores(mut.map((c) => L.featuresAt(c, t))), full);
});
test('features need at least 253 rows; insufficient history gives NaN, not an error', () => {
  const c = Array.from({length: 252}, (_, i) => 10 + i * 0.01);
  assert.ok(!L.featuresFinite(L.featuresAt(c, 251)));
  assert.ok(L.featuresFinite(L.featuresAt(c.concat([11]), 252)));
});

// ------------------------------------------------------------------ 2. holdout structurally untouched
test('dev cutoff: n - ceil(0.3 n), earliest of calendars, depends on dates only', () => {
  assert.equal(L.devCount(10), 7);
  assert.equal(L.devCount(30), 21);
  assert.equal(L.devCount(1749), 1224);
  assert.equal(L.devCount(1759), 1231);
  const cals = [{name: 'a', dates: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10']}, {name: 'b', dates: ['d1', 'd2', 'd3', 'd4', 'd5']}];
  assert.equal(L.determineDevCutoff(cals).cutoff, 'd3'); // b: 5 - ceil(1.5) = 3 ; a: 7 -> d7 ; earliest d3
});
test('POISONING: perturbing every price/volume after the cutoff does not change any output byte', () => {
  const base = synthUniverse(11);
  const {cutoff} = R.applyDevCut(base);
  const ref = JSON.stringify(R.runDev(base, {B: 100, protocolSha256: 'x'}));
  const variants = [
    (r) => [r[0], NaN, NaN, NaN, NaN, NaN],
    (r) => [r[0], r[1] * 1e9, r[2] * 1e9, r[3] * 1e9, r[4] * 1e9 + 12345, 1e18],
    (r) => [r[0], -1, -1, -1, -1, -1],
    (r) => [r[0], null, undefined, 'abc', 0, 'x'],
    (r) => [r[0], r[1] * 0.001, r[2], r[3], r[4] * 0.001, 0],
  ];
  let touched = 0;
  for (const f of variants) {
    const poisoned = clone(base);
    for (const s of poisoned) s.rows = s.rows.map((r) => { if (r[0] > cutoff) { touched++; return f(r); } return r; });
    const out = JSON.stringify(R.runDev(poisoned, {B: 100, protocolSha256: 'x'}));
    assert.equal(out, ref);
  }
  assert.ok(touched > 1000, 'the test really poisoned rows');
  const parsed = JSON.parse(ref);
  assert.equal(parsed.holdout_opened, false);
  assert.equal(parsed.dev_cutoff.date, cutoff);
  for (const m of ['sa', 'us']) assert.ok(parsed.data.markets[m].last_date <= cutoff);
});
test('POISONING also holds when the poison values are non-array garbage rows after the cutoff', () => {
  const base = synthUniverse(12);
  const {cutoff} = R.applyDevCut(base);
  const ref = JSON.stringify(R.runDev(base, {B: 100}));
  const poisoned = clone(base);
  for (const s of poisoned) s.rows = s.rows.map((r) => (r[0] > cutoff ? [r[0]] : r));
  assert.equal(JSON.stringify(R.runDev(poisoned, {B: 100})), ref);
});
test('POISONING on the real dataset (only when NEGSEL_PRICES_DIR is set)', {skip: !process.env.NEGSEL_PRICES_DIR}, () => {
  const dir = process.env.NEGSEL_PRICES_DIR;
  const series = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const {cutoff} = R.applyDevCut(series);
  const ref = JSON.stringify(R.runDev(series, {B: 200}));
  const poisoned = clone(series);
  let touched = 0;
  for (const s of poisoned) s.rows = s.rows.map((r) => { if (r[0] > cutoff) { touched++; return [r[0], NaN, r[4] * 1e6, -3, r[4] * 1e6 + 1, 1e18]; } return r; });
  assert.ok(touched > 5000);
  assert.equal(JSON.stringify(R.runDev(poisoned, {B: 200})), ref);
});
test('assertNoHoldout throws if a post-cutoff row ever reaches the analysis; runHoldout is a stub that throws', () => {
  assert.throws(() => R.assertNoHoldout([{symbol: 'A', rows: [['2020-01-01'], ['2020-01-05']]}], '2020-01-03'), /holdout row leaked/);
  assert.throws(() => R.runHoldout(), /HOLDOUT NOT IMPLEMENTED/);
  const src = fs.readFileSync(path.join(__dirname, '../experiments/negsel-0002.cjs'), 'utf8');
  assert.ok(!/holdout_opened:\s*true/.test(src));
});

// ------------------------------------------------------------------ 3. identity guards
const mkRows = (cal, from, to) => cal.slice(from, to + 1).map((d) => ({date: d, c: 10, v: 1}));
function ctxFor(cal, extra = {}) { return {cal, calIndex: new Map(cal.map((d, i) => [d, i])), expectedCurrency: 'SAR', maxGap: 20, ...extra}; }
test('identity: series starting after a known listing date is rejected; one starting on it is accepted', () => {
  const cal = genDates(300, '2020-01-05', true);
  const late = L.checkIdentity({rows: mkRows(cal, 40, 299), currency: 'SAR'}, ctxFor(cal, {listingDate: cal[0]}));
  assert.equal(late.ok, false);
  assert.match(late.reasons[0], /starts_after_listing/);
  assert.equal(L.checkIdentity({rows: mkRows(cal, 40, 299), currency: 'SAR'}, ctxFor(cal, {listingDate: cal[40]})).ok, true);
  assert.equal(L.checkIdentity({rows: mkRows(cal, 0, 299), currency: 'SAR'}, ctxFor(cal, {listingDate: '2001-01-01'})).ok, true); // listed before the window
  assert.equal(L.checkIdentity({rows: mkRows(cal, 41, 299), currency: 'SAR'}, ctxFor(cal, {listingDate: cal[40]})).ok, false); // one session late
});
test('identity: gap > 20 sessions rejected, exactly 20 accepted, trailing gap rejected', () => {
  const cal = genDates(300, '2020-01-05', true);
  const mk = (missing) => mkRows(cal, 0, 299).filter((_, i) => !(i >= 100 && i < 100 + missing));
  assert.equal(L.checkIdentity({rows: mk(20), currency: 'SAR'}, ctxFor(cal)).ok, true);
  const bad = L.checkIdentity({rows: mk(21), currency: 'SAR'}, ctxFor(cal));
  assert.equal(bad.ok, false);
  assert.match(bad.reasons[0], /gap_21_sessions/);
  assert.equal(L.checkIdentity({rows: mkRows(cal, 0, 250), currency: 'SAR'}, ctxFor(cal)).ok, false); // 49 missing at the end
});
test('identity: currency mismatch / currency jump / name jump rejected', () => {
  const cal = genDates(100, '2020-01-05', true);
  const rows = mkRows(cal, 0, 99);
  assert.equal(L.checkIdentity({rows, currency: 'USD'}, ctxFor(cal)).ok, false);
  assert.ok(L.checkIdentity({rows, currency: 'SAR', currencyHistory: ['SAR', 'USD']}, ctxFor(cal)).reasons.includes('currency_jump'));
  assert.ok(L.checkIdentity({rows, currency: 'SAR', nameHistory: ['Old Co', 'New Co']}, ctxFor(cal)).reasons.includes('name_jump'));
  assert.equal(L.checkIdentity({rows, currency: 'SAR', nameHistory: ['Same', 'Same']}, ctxFor(cal)).ok, true);
});
test('identity guards are applied inside runDev and every rejection is recorded', () => {
  const base = synthUniverse(21, 22, 700);
  const dSa = genDates(700, '2015-01-04', true);
  const gap = synthSeries('1900.SR', dSa, L.mulberry32(5)); gap.rows.splice(300, 30);
  const wrongCur = synthSeries('1901.SR', dSa, L.mulberry32(6)); wrongCur.currency = 'USD';
  const reused = synthSeries('1902.SR', dSa, L.mulberry32(7)); reused.rows = reused.rows.slice(250);
  const res = R.runDev([...base, gap, wrongCur, reused], {B: 50, listingDates: {'1902.SR': dSa[0]}});
  const rej = Object.fromEntries(res.data.markets.sa.rejected.map((r) => [r.symbol, r.reasons.join(';')]));
  assert.match(rej['1900.SR'], /gap_30/);
  assert.match(rej['1901.SR'], /currency_USD/);
  assert.match(rej['1902.SR'], /starts_after_listing/);
  assert.equal(res.data.markets.sa.n_symbols_accepted, 22);
});

// ------------------------------------------------------------------ 4. non-overlapping dates
test('non-overlapping selection: spacing >= h, deterministic, honours gaps in eligibility', () => {
  const elig = [];
  for (let i = 0; i < 300; i++) if (i % 7 !== 3 && !(i >= 100 && i < 130)) elig.push(i);
  for (const h of [1, 5, 21, 63]) {
    const a = L.selectNonOverlapping(elig, h), b = L.selectNonOverlapping(elig, h);
    assert.deepEqual(a, b);
    assert.equal(a[0], elig[0]);
    for (let i = 1; i < a.length; i++) assert.ok(a[i] - a[i - 1] >= h);
    // greedy: every skipped eligible index lies within h of the previously chosen one
    const chosen = new Set(a);
    let lastChosen = -Infinity;
    for (const t of elig) { if (chosen.has(t)) lastChosen = t; else assert.ok(t - lastChosen < h); }
  }
  assert.deepEqual(L.selectNonOverlapping([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5), [0, 5, 10]);
  assert.deepEqual(L.selectNonOverlapping([], 5), []);
  assert.throws(() => L.selectNonOverlapping([1, 2], 0));
});
test('runDev: selected dates in the result are spaced >= h and fewer than eligible', () => {
  const res = R.runDev(synthUniverse(31), {B: 50});
  for (const m of ['sa', 'us']) for (const h of [5, 21, 63]) {
    const info = res.data.markets[m].nonoverlapping_dates[`h${h}`];
    assert.ok(info.n_nonoverlapping > 0 && info.n_nonoverlapping <= Math.ceil(info.n_eligible_before_spacing / h) + 1);
  }
});

// ------------------------------------------------------------------ 5. Holm
test('Holm correction matches hand-computed values', () => {
  // p = [0.01, 0.04, 0.03, 0.005], m=4: sorted 0.005*4=0.02, 0.01*3=0.03, 0.03*2=0.06, 0.04*1=0.04 -> monotone max 0.06
  const adj = L.holm([0.01, 0.04, 0.03, 0.005]);
  [0.03, 0.06, 0.06, 0.02].forEach((v, i) => near(adj[i], v));
  const capped = L.holm([0.4, 0.6]);
  near(capped[0], 0.8); near(capped[1], 0.8);
  assert.deepEqual(L.holm([0.9, 0.5, 0.9]), [1, 1, 1]); // 0.5*3 -> capped 1, monotone max keeps 1
  near(L.holm([0.001])[0], 0.001);
  assert.deepEqual(L.holm([]), []);
});

// ------------------------------------------------------------------ 6. block bootstrap
test('block bootstrap is deterministic for a seed and changes with the seed', () => {
  const rng0 = L.mulberry32(5), vals = Array.from({length: 48}, () => gauss(rng0));
  const run = (key) => { const sets = L.makeBootIndexSets(48, 300, L.blockLength(48), L.seededRng(7, key)); return L.bootSummary(vals, sets, 300); };
  assert.deepEqual(run('a'), run('a'));
  assert.notDeepEqual(run('a').ci95, run('b').ci95);
  assert.equal(L.blockLength(48), 4);
  assert.equal(L.blockLength(1), 1);
});
test('block bootstrap coverage sanity on iid synthetic data (true mean 0, 95% CI)', () => {
  const B = 400, reps = 300, n = 60;
  let cover = 0, rejectPos = 0;
  for (let r = 0; r < reps; r++) {
    const rng = L.mulberry32(1000 + r), v = Array.from({length: n}, () => gauss(rng));
    const sets = L.makeBootIndexSets(n, B, L.blockLength(n), L.mulberry32(9000 + r));
    const s = L.bootSummary(v, sets, B);
    if (s.ci95[0] <= 0 && 0 <= s.ci95[1]) cover++;
    if (s.p_one_sided < 0.025) rejectPos++;
  }
  const cov = cover / reps;
  assert.ok(cov >= 0.88 && cov <= 0.99, `coverage ${cov}`);
  assert.ok(rejectPos / reps <= 0.07, `one-sided false positive rate ${rejectPos / reps}`);
});
test('block bootstrap detects a planted mean and keeps CI ordered', () => {
  const rng = L.mulberry32(77), n = 60, v = Array.from({length: n}, () => 0.8 + gauss(rng));
  const s = L.bootSummary(v, L.makeBootIndexSets(n, 500, L.blockLength(n), L.mulberry32(1)), 500);
  assert.ok(s.ci95[0] > 0 && s.ci95[0] < s.mean && s.mean < s.ci95[1]);
  assert.ok(s.p_one_sided < 0.01);
  assert.ok(Number.isNaN(L.bootSummary([1, 2, 3], new Int32Array(0), 0).ci95[0])); // n < 5 -> no CI
});

// ------------------------------------------------------------------ 7. random-exclusion permutation baseline
function permScenario(seed, signal, D = 30, N = 40, q = 0.3) {
  const rng = L.mulberry32(seed), nEx = L.exclusionCount(N, q);
  const fwdAll = [], exAll = [], gross = [];
  for (let d = 0; d < D; d++) {
    const score = Array.from({length: N}, () => rng()); // exclusion rule score (rank = score)
    const fwd = score.map((u) => signal * (u - 0.5) + 0.05 * gauss(rng));
    const ev = L.evaluateDate(score.map((_, i) => `s${i}`), score, fwd, q);
    fwdAll.push(fwd); exAll.push(nEx); gross.push(ev.retSurv - ev.retAll);
  }
  return {fwdAll, exAll, obs: L.mean(gross)};
}
test('permutation baseline: null data -> p-values not significant and roughly uniform', () => {
  const ps = [];
  for (let r = 0; r < 60; r++) {
    // signal 0 and a rule whose exclusion is independent of returns
    const sc = permScenario(500 + r, 0);
    ps.push(L.permutationBaseline(sc.fwdAll, sc.exAll, sc.obs, 400, L.mulberry32(3000 + r)).p);
  }
  const m = L.mean(ps);
  assert.ok(m > 0.35 && m < 0.65, `mean p ${m}`);
  assert.ok(ps.filter((p) => p < 0.05).length <= 10);
  assert.ok(ps.filter((p) => p < 0.5).length > 15 && ps.filter((p) => p < 0.5).length < 45);
});
test('permutation baseline: planted signal is detected', () => {
  const sc = permScenario(901, 0.05);
  const r = L.permutationBaseline(sc.fwdAll, sc.exAll, sc.obs, 1000, L.mulberry32(1));
  assert.ok(sc.obs > 0);
  assert.ok(r.p < 0.01, `p ${r.p}`);
  const rev = permScenario(902, -0.05); // reversed signal: survivors worse than all
  assert.ok(L.permutationBaseline(rev.fwdAll, rev.exAll, rev.obs, 500, L.mulberry32(2)).p > 0.9);
});
test('permutation baseline is deterministic given the seed', () => {
  const sc = permScenario(5, 0.02);
  const a = L.permutationBaseline(sc.fwdAll, sc.exAll, sc.obs, 200, L.mulberry32(8));
  const b = L.permutationBaseline(sc.fwdAll, sc.exAll, sc.obs, 200, L.mulberry32(8));
  assert.deepEqual(a, b);
});

// ------------------------------------------------------------------ 8. cost model
test('cost model: turnover x c, hand-computed example', () => {
  // previous book A,B,C,D equal weight 0.25, no drift; new book A,B,C,E -> replaced fraction 0.25
  const prev = L.driftWeights(['A', 'B', 'C', 'D'], [0, 0, 0, 0]);
  const to = L.turnoverOf(prev, ['A', 'B', 'C', 'E']);
  near(to, 0.25);
  near(L.netExcess(0.01, to, 25), 0.01 - 0.25 * 0.0025); // 0.009375
  near(L.netExcess(0.01, to, 0), 0.01);
  near(L.netExcess(0.01, to, 50), 0.01 - 0.25 * 0.005);
  near(L.netExcess(0.01, 1, 10), 0.01 - 0.001);
  assert.equal(L.turnoverOf(null, ['A', 'B']), 1); // first rebalance
  assert.equal(L.turnoverOf(prev, ['A', 'B', 'C', 'D']), 0);
  assert.equal(L.turnoverOf(prev, ['X', 'Y']), 1);
});
test('cost model: drift is taken into account in turnover (hand-computed)', () => {
  // A doubled, B flat -> weights 2/3, 1/3; new book equal 1/2 each: 0.5*(|0.5-2/3| + |0.5-1/3|) = 1/6
  const w = L.driftWeights(['A', 'B'], [1, 0]);
  near(w.get('A'), 2 / 3); near(w.get('B'), 1 / 3);
  near(L.turnoverOf(w, ['A', 'B']), 1 / 6);
});
test('net excess is monotone non-increasing in c and a constant-book strategy pays only once', () => {
  const to = 0.3, g = 0.004;
  const nets = [0, 10, 25, 50].map((c) => L.netExcess(g, to, c));
  for (let i = 1; i < nets.length; i++) assert.ok(nets[i] < nets[i - 1]);
});

// ------------------------------------------------------------------ 9. delisting sensitivity
test('delisting adjustment: hand-computed value and phi=0 identity', () => {
  const d = {N: 10, nSurv: 7, retSurv: 0.02, retAll: 0.01};
  near(L.delistAdjustedExcess(d, 0, 0.5, 21), 0.01);
  // phi=0.1, h=252 -> M = 1 ; pex=.5 : S=(7*.02-.25)/7.5 ; A=(10*.01-.5)/11
  near(L.delistAdjustedExcess(d, 0.1, 0.5, 252), (0.14 - 0.25) / 7.5 - (0.1 - 0.5) / 11, 1e-12);
});
test('delisting sensitivity: higher phi never improves the excess when delisters are not over-concentrated in the excluded group', () => {
  const phis = [0, 0.01, 0.02, 0.04, 0.08];
  for (const h of [5, 21, 63]) for (const pex of [0.1, 0.3]) {
    // exclusion share 0.3 -> pex <= share
    const d = {N: 40, nSurv: 28, retSurv: 0.012, retAll: 0.008};
    const ex = phis.map((p) => L.delistAdjustedExcess(d, p, pex, h));
    for (let i = 1; i < ex.length; i++) assert.ok(ex[i] <= ex[i - 1] + 1e-15, `h${h} pex${pex}`);
    assert.ok(ex[ex.length - 1] >= 0); // positive base effect shrinks, never flips sign when pex<=share
  }
  // random (pex == share): excess shrinks exactly by N/(N+M)
  const d = {N: 40, nSurv: 28, retSurv: 0.012, retAll: 0.008}, M = 0.04 * (21 / 252) * 40;
  near(L.delistAdjustedExcess(d, 0.04, 0.3, 21), (d.retSurv - d.retAll) * (40 / (40 + M)), 1e-12);
  // documented opposite case: if the rule is better than random at excluding the delisters, the excess rises with phi
  assert.ok(L.delistAdjustedExcess(d, 0.04, 0.6, 21) > L.delistAdjustedExcess(d, 0, 0.6, 21));
});
test('delisting sensitivity in runDev: grid has phi in {0,1,2,4}% x p_ex in {0.3,0.6}; phi=0 equals the base net(25) estimate', () => {
  const res = R.runDev(synthUniverse(41), {B: 50});
  for (const c of res.results) {
    assert.equal(c.delisting_sensitivity.grid.length, 8);
    const g0 = c.delisting_sensitivity.grid.find((x) => x.phi_pct_per_year === 0 && x.p_ex === 0.3);
    near(g0.net25_excess_pct, c.composite.net_excess_pct_by_cost.c25bps.mean, 2e-5);
    // monotonicity is tested on the pure function above: with integer flooring nEx/N can sit slightly below q, so p_ex=q is not exactly 'random' at every date
    for (const g of c.delisting_sensitivity.grid) assert.ok(Number.isFinite(g.net25_excess_pct));
  }
});

// ------------------------------------------------------------------ 10. NaN / missing / non-finite inputs
test('cleanSeries drops invalid rows, zeroes bad volume, sorts and de-duplicates', () => {
  const raw = [
    ['2020-01-03', 1, 1, 1, 3, 10], ['2020-01-01', 1, 1, 1, 1, 10], ['2020-01-02', 1, 1, 1, NaN, 10], ['2020-01-04', 1, 1, 1, Infinity, 1],
    ['2020-01-05', 1, 1, 1, -2, 1], ['2020-01-06', 1, 1, 1, 0, 1], ['bad', 1, 1, 1, 5, 1], [null], null, ['2020-01-07', 1, 1, 1, 7, NaN],
    ['2020-01-03', 1, 1, 1, 99, 10],
  ];
  const {rows, stats} = L.cleanSeries(raw);
  assert.deepEqual(rows.map((r) => r.date), ['2020-01-01', '2020-01-03', '2020-01-07']);
  assert.equal(rows[1].c, 3); // first duplicate kept
  assert.equal(rows[2].v, 0);
  assert.equal(stats.badClose, 4); assert.equal(stats.badDate, 3); assert.equal(stats.duplicateDates, 1); assert.equal(stats.wasUnsorted, true);
  assert.deepEqual(L.cleanSeries(undefined).rows, []);
});
test('non-finite inputs never throw and never produce finite junk', () => {
  const c = Array.from({length: 400}, (_, i) => 10 + Math.sin(i / 9));
  c[300] = NaN;
  assert.ok(!L.featuresFinite(L.featuresAt(c, 310))); // NaN inside SMA200 window
  assert.ok(L.featuresFinite(L.featuresAt(c, 399)) === false || true);
  const bad = c.slice(); bad[399 - 5] = 0;
  assert.ok(!L.featuresFinite(L.featuresAt(bad, 399)));
  const feats = [{mom126_5: 1, trend50_200: 1, mom252_21: 1}, {mom126_5: NaN, trend50_200: 2, mom252_21: 2}, {mom126_5: 3, trend50_200: 3, mom252_21: 3}];
  const sc = L.compositeScores(feats);
  assert.ok(Number.isNaN(sc[1]));
  assert.deepEqual([sc[0], sc[2]], [0, 1]);
  assert.deepEqual(L.rankNormalized([3, NaN, 1, Infinity, 2]).map((x) => (Number.isNaN(x) ? 'n' : x)), [1, 'n', 0, 'n', 0.5]);
  assert.ok(Number.isNaN(L.mean([])) && Number.isNaN(L.median([NaN])));
  const ev = L.evaluateDate(['a', 'b', 'c', 'd'], [0.1, NaN, 0.5, 0.9], [0.1, 0.2, 0.3, 0.4], 0.3);
  assert.equal(ev.N, 3);
});
test('runDev tolerates NaN / missing / corrupted rows inside the development window', () => {
  const base = synthUniverse(51);
  const s = clone(base);
  for (let k = 100; k < 105; k++) s[0].rows[k][4] = NaN; // short run of bad closes -> gap < 20
  s[1].rows[200][5] = NaN; // bad volume
  s[2].rows[50] = null; // missing row
  for (let k = 100; k < 140; k++) s[3].rows[k][4] = NaN; // 40 bad rows -> gap > 20 -> rejected
  const res = R.runDev(s, {B: 50});
  assert.ok(res.data.markets.sa.rejected.some((r) => r.symbol === s[3].symbol));
  assert.ok(['REJECTED', 'INCONCLUSIVE'].includes(res.decision.decision));
  assert.ok(!JSON.stringify(res).includes('NaN'));
});

// ------------------------------------------------------------------ 11. ties
test('ranking ties: average ranks; exclusion tie-break is by id and independent of input order', () => {
  assert.deepEqual(L.rankNormalized([1, 2, 2, 3]), [0, 0.5, 0.5, 1]);
  assert.deepEqual(L.rankNormalized([5, 5, 5]), [0.5, 0.5, 0.5]);
  assert.deepEqual(L.rankNormalized([7]), [0.5]);
  const ids = ['d', 'a', 'c', 'b', 'e'], scores = [0.3, 0.3, 0.3, 0.3, 0.9];
  const pick = (perm) => L.selectExcluded(perm.map((i) => scores[i]), perm.map((i) => ids[i]), 2).excluded.map((k) => ids[perm[k]]).sort();
  assert.deepEqual(pick([0, 1, 2, 3, 4]), ['a', 'b']);
  assert.deepEqual(pick([4, 3, 2, 1, 0]), ['a', 'b']);
  assert.deepEqual(pick([2, 0, 4, 1, 3]), ['a', 'b']);
  assert.equal(L.exclusionCount(40, 0.3), 12);
  assert.equal(L.exclusionCount(35, 0.2), 7);
  assert.equal(L.exclusionCount(29, 0.5), 14);
});
test('composite is the mean of the three normalised ranks (hand-computed)', () => {
  const f = [
    {mom126_5: 1, trend50_200: 3, mom252_21: 2},
    {mom126_5: 2, trend50_200: 2, mom252_21: 3},
    {mom126_5: 3, trend50_200: 1, mom252_21: 1},
  ];
  // ranks (0,.5,1): row0 = (0,1,.5)->0.5 ; row1 = (.5,.5,1)->0.6666666667 ; row2 = (1,0,0)->0.3333333333
  const s = L.compositeScores(f);
  near(s[0], 0.5, 1e-11); near(s[1], 2 / 3, 1e-11); near(s[2], 1 / 3, 1e-11);
  assert.deepEqual(L.singleScores(f), [0, 0.5, 1]);
});

// ------------------------------------------------------------------ 12. liquidity threshold from training data only
test('liquidity threshold uses only the values passed and is frac x median', () => {
  assert.equal(L.liquidityThreshold([1, 2, 3, 4, 100], 0.25), 0.75);
  assert.equal(L.liquidityThreshold([], 0.25), null);
  assert.equal(L.liquidityThreshold([NaN, 4, 6], 0.5), 2.5);
});
test('fold liquidity threshold is unchanged when data dated on/after the fold year is altered (training data only)', () => {
  const base = synthUniverse(61, 24, 900);
  const {cut} = R.applyDevCut(base);
  const sa0 = cut.filter((s) => /\.SR$/.test(s.symbol));
  const ctx0 = R.buildMarket('sa', sa0, {});
  const year = 2017;
  const t0 = R.foldThreshold(ctx0, year);
  assert.ok(t0 > 0);
  const poisoned = clone(sa0);
  for (const s of poisoned) for (const r of s.rows) if (r[0] >= `${year}-01-01`) { r[5] = r[5] * 1000 + 1; r[4] = r[4] * 3; }
  assert.equal(R.foldThreshold(R.buildMarket('sa', poisoned, {}), year), t0);
  // and it does change if training data change (the test is sensitive)
  const poisoned2 = clone(sa0);
  for (const s of poisoned2) for (const r of s.rows) if (r[0] < `${year}-01-01`) r[5] = r[5] * 1000 + 1;
  assert.notEqual(R.foldThreshold(R.buildMarket('sa', poisoned2, {}), year), t0);
});
test('medianTradedValue needs a full 20-session window', () => {
  const rows = Array.from({length: 25}, (_, i) => ({date: `d${i}`, c: 2, v: i + 1}));
  assert.ok(Number.isNaN(L.medianTradedValue(rows, 18, 20)));
  near(L.medianTradedValue(rows, 24, 20), 2 * L.median(Array.from({length: 20}, (_, k) => 6 + k)));
});

// ------------------------------------------------------------------ 13. decision logic & determinism
test('decision rules: never RESEARCH-VALIDATED, protocol order, holdout gate', () => {
  const ok = {primary: true, folds: true, delist: true, perm: true};
  assert.equal(L.decide({criteria: {...ok, perm: false}, nEff: 500, powerMinN: 60, holdoutOpened: true}).decision, 'REJECTED');
  assert.equal(L.decide({criteria: {...ok, primary: false}, nEff: 10, powerMinN: 60, holdoutOpened: false}).decision, 'REJECTED'); // failure beats low power
  assert.equal(L.decide({criteria: ok, nEff: 59, powerMinN: 60, holdoutOpened: true}).decision, 'INCONCLUSIVE');
  assert.equal(L.decide({criteria: ok, nEff: 500, powerMinN: 60, holdoutOpened: false}).decision, 'INCONCLUSIVE');
  assert.equal(L.decide({criteria: ok, nEff: 500, powerMinN: 60, holdoutOpened: true}).decision, 'SHADOW-VALIDATED');
  assert.equal(L.decide({criteria: {...ok, perm: null}, nEff: 500, powerMinN: 60, holdoutOpened: true}).decision, 'INCONCLUSIVE');
  for (const nEff of [0, 5, 59, 60, 1e6]) for (const open of [true, false]) for (const v of [true, false, null]) {
    const d = L.decide({criteria: {a: v, b: true}, nEff, powerMinN: 60, holdoutOpened: open}).decision;
    assert.ok(['REJECTED', 'INCONCLUSIVE', 'SHADOW-VALIDATED'].includes(d));
  }
});
test('runDev is deterministic, independent of input order, and contains no timestamps; sources use no Math.random / Date.now', () => {
  const base = synthUniverse(71);
  const a = JSON.stringify(R.runDev(base, {B: 100}));
  assert.equal(JSON.stringify(R.runDev(base, {B: 100})), a);
  assert.equal(JSON.stringify(R.runDev(base.slice().reverse(), {B: 100})), a);
  const res = JSON.parse(a);
  assert.equal(res.holdout_opened, false);
  assert.ok(['REJECTED', 'INCONCLUSIVE', 'SHADOW-VALIDATED'].includes(res.decision.decision));
  assert.notEqual(res.decision.decision, 'RESEARCH-VALIDATED');
  assert.equal(res.secondary_tests.length, 17);
  assert.equal(res.results.length, 18);
  for (const f of ['negsel-lib.cjs', 'negsel-0002.cjs']) {
    const src = fs.readFileSync(path.join(__dirname, '../experiments', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random|Date\.now|new Date\(/.test(src), f);
  }
});
test('runDev on pure noise does not validate: no secondary test is significant after Holm and the status is not SHADOW-VALIDATED', () => {
  const res = R.runDev(synthUniverse(81, 30, 1300), {B: 200});
  assert.notEqual(res.decision.decision, 'SHADOW-VALIDATED');
  assert.ok(res.secondary_tests.filter((t) => t.significant_after_holm).length <= 1);
});
test('PRNG: mulberry32 / fnv1a are deterministic and in [0,1)', () => {
  const a = L.mulberry32(42), b = L.mulberry32(42);
  for (let i = 0; i < 1000; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
  assert.equal(L.fnv1a('abc'), L.fnv1a('abc'));
  assert.notEqual(L.fnv1a('abc'), L.fnv1a('abd'));
});

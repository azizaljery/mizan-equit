'use strict';
/**
 * Unit tests for NEGSEL-0002 (research/experiments/negsel-lib.cjs + negsel-0002.cjs).
 * run: node --test research/tests/negsel-0002.test.cjs
 * Optional real-data holdout-poisoning test: NEGSEL_PRICES_DIR=<prices dir> node --test ...
 * Mutation check: NEGSEL_CODE_DIR=<dir holding copies of negsel-lib.cjs + negsel-0002.cjs> node --test ...  (default: research/experiments).
 *   A mutated copy of the experiment code must make this suite FAIL; the sections "A..H" at the end exist for that purpose.
 * CODE-TESTED status only: passing these tests is NOT predictive evidence for the strategy.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const CODE_DIR = process.env.NEGSEL_CODE_DIR ? path.resolve(process.env.NEGSEL_CODE_DIR) : path.join(__dirname, '../experiments');
const L = require(path.join(CODE_DIR, 'negsel-lib.cjs'));
const R = require(path.join(CODE_DIR, 'negsel-0002.cjs'));

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
  const src = fs.readFileSync(path.join(CODE_DIR, 'negsel-0002.cjs'), 'utf8');
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
test('block bootstrap coverage on iid synthetic data (true mean 0, nominal 95% CI): tight band around the measured 0.937', () => {
  // 1000 replications (binomial SE ~0.0075). Seeds are fixed, so the value is reproducible (0.937 measured). A percentile bootstrap with
  // n=60, block length 4 undercovers slightly, hence the band [0.915, 0.97] (about -3 / +4 SE) instead of the former 0.88-0.99.
  const B = 500, reps = 1000, n = 60;
  let cover = 0, rejectPos = 0;
  for (let r = 0; r < reps; r++) {
    const rng = L.mulberry32(20000 + r), v = Array.from({length: n}, () => gauss(rng));
    const sets = L.makeBootIndexSets(n, B, L.blockLength(n), L.mulberry32(29000 + r));
    const s = L.bootSummary(v, sets, B);
    if (s.ci95[0] <= 0 && 0 <= s.ci95[1]) cover++;
    if (s.p_one_sided < 0.025) rejectPos++;
  }
  const cov = cover / reps, fp = rejectPos / reps;
  assert.ok(cov >= 0.915 && cov <= 0.97, `coverage ${cov}`);
  // nominal one-sided rate 0.025 (the centred bootstrap p is mildly liberal at n=60: 0.036 measured)
  assert.ok(fp >= 0.012 && fp <= 0.055, `one-sided false positive rate ${fp}`);
});
test('percentileCI and bootPOneSided: exact hand-computed values', () => {
  const means = Float64Array.from({length: 1000}, (_, i) => i); // sorted 0..999
  assert.deepEqual(L.percentileCI(means), [25, 974]); // idx floor(1000*0.025)=25 ; ceil(1000*0.975)-1=974
  assert.deepEqual(L.percentileCI(Float64Array.from([4, 3, 2, 1, 0].concat(Array.from({length: 95}, (_, i) => 5 + i)))), [2, 97]); // 100 values 0..99 -> idx 2 and 97
  // obs mean 2 ; centred null: count of (mean_b - 2) >= 2 i.e. mean_b >= 4 ; means [1,2,3,4,5,6] -> 3 ; p = (1+3)/(6+1)
  near(L.bootPOneSided([1, 2, 3], [1, 2, 3, 4, 5, 6]), 4 / 7);
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
test('net excess is strictly decreasing in c and exactly linear: slope = -turnover per 1e4 bps', () => {
  const to = 0.3, g = 0.004;
  const nets = [0, 10, 25, 50].map((c) => L.netExcess(g, to, c));
  for (let i = 1; i < nets.length; i++) assert.ok(nets[i] < nets[i - 1]);
  near(nets[0], g); near(nets[1], 0.004 - 0.3 * 0.001); near(nets[2], 0.004 - 0.3 * 0.0025); near(nets[3], 0.004 - 0.3 * 0.005);
  assert.equal(L.netExcess(g, 0, 50), g); // no turnover -> no cost
});
test('a constant book pays the cost only once (first rebalance): turnover 1, then 0 when nothing is bought or sold and prices do not drift', () => {
  const names = ['A', 'B', 'C'];
  const turnovers = [L.turnoverOf(null, names)];
  for (let d = 1; d < 6; d++) turnovers.push(L.turnoverOf(L.driftWeights(names, [0, 0, 0]), names));
  assert.deepEqual(turnovers, [1, 0, 0, 0, 0, 0]);
  const total = turnovers.reduce((s, to) => s + L.netExcess(0, to, 25) * -1, 0); // total cost = sum of turnover x c
  near(total, 0.0025); // 25 bps, once
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
test('non-finite inputs never throw and never produce finite junk (exact window edges)', () => {
  const clean = Array.from({length: 700}, (_, i) => 10 + Math.sin(i / 9));
  assert.ok(L.featuresFinite(L.featuresAt(clean, 399))); // control: the clean series is finite
  const c = clean.slice();
  c[300] = NaN;
  assert.ok(!L.featuresFinite(L.featuresAt(c, 310))); // NaN inside the SMA200 window
  assert.ok(!L.featuresFinite(L.featuresAt(c, 399))); // 300 is inside [i-199, i] = [200, 399]
  // c[300] is read by features at i iff 300 is among i-252 (point) or in [i-199, i] (SMA200), i-126, i-21, i-5 :
  assert.ok(!L.featuresFinite(L.featuresAt(c, 552))); // i-252 = 300 (point read)
  assert.ok(L.featuresFinite(L.featuresAt(c, 553))); // 300 is now outside every lookback -> finite again, exactly
  assert.deepEqual(L.featuresAt(c, 553), L.featuresAt(clean, 553));
  const bad = clean.slice(); bad[399 - 5] = 0;
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
    const src = fs.readFileSync(path.join(CODE_DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random|Date\.now|new Date\(/.test(src), f);
  }
});
test('NEGATIVE CONTROL (noise only; says nothing about the sign of the effect - see section G for the signed controls): runDev on pure noise does not validate', () => {
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

// =====================================================================================================================================
// MUTATION-RESISTANCE SECTIONS (A-H). Each pins one runner/lib behaviour with synthetic panels whose answers are known analytically.
// Every fixture below is synthetic: no real price, volume or return (and in particular nothing from the sealed holdout) is read here.
// Only the exported surface is used: L.*, R.buildMarket, R.selectDates, R.applyDevCut, R.runDev (evalScheme/universeAt are not exported:
// they are covered through selectDates / runDev output, see section F).
// =====================================================================================================================================
const NSYM_GEO = 25;
const ln = Math.log;

/** One-market ('sa') panel. fn(k,j) -> {c, v} | null (null = no row that session). Symbols 1000.SR .. ; full calendar of n Saudi sessions. */
function saPanel(n, nSym, fn) {
  const dates = genDates(n, '2015-01-04', true);
  return Array.from({length: nSym}, (_, k) => {
    const rows = [];
    dates.forEach((d, j) => { const x = fn(k, j); if (x) rows.push([d, x.c, x.c, x.c, x.c, x.v]); });
    return {symbol: `${1000 + k}.SR`, currency: 'SAR', tz: 'UTC', splitsInRange: 0, rows};
  });
}
/** Fixed liquidity thresholds for every calendar year (so that the universe depends only on what the test controls). */
const presetThr = (v) => new Map(Array.from({length: 20}, (_, i) => [2010 + i, v]));
const buildSa = (series) => R.buildMarket('sa', series, {});
const FIRST_T = 259; // MIN_HISTORY (260) - 1 : first session with a usable feature row when every symbol has a full history

// ---------------------------------------------------------------------- A. the three features: hand-computed values (kills "5-session skip dropped")
test('A1 features, linear closes c[j]=j+1 at i=300: hand-computed mom126_5, trend50_200, mom252_21', () => {
  const c = Array.from({length: 400}, (_, j) => j + 1);
  const f = L.featuresAt(c, 300);
  // c[i-5]=296, c[i-126]=175 ; SMA50 over c[251..300]=252..301 -> 276.5 ; SMA200 over c[101..300]=102..301 -> 201.5 ; c[i-21]=280, c[i-252]=49
  near(f.mom126_5, ln(296 / 175));
  near(f.trend50_200, ln(276.5 / 201.5));
  near(f.mom252_21, ln(280 / 49));
  // the skip is real: ln(c[i]/c[i-126]) and ln(c[i-4]/c[i-126]) are different numbers
  assert.ok(Math.abs(f.mom126_5 - ln(301 / 175)) > 0.01);
  assert.ok(Math.abs(f.mom126_5 - ln(297 / 175)) > 0.001);
  assert.ok(Math.abs(f.mom252_21 - ln(301 / 49)) > 0.05);
});
test('A2 features, spiked closes: every lookback index is pinned individually (i-5, i-126, i-21, i-252, SMA50, SMA200)', () => {
  const i = 300, c = Array.from({length: 400}, () => 100);
  c[i - 5] = 200; c[i - 126] = 50; c[i - 21] = 150; c[i - 252] = 30;
  const f = L.featuresAt(c, i);
  near(f.mom126_5, ln(200 / 50)); // ln 4
  near(f.mom252_21, ln(150 / 30)); // ln 5
  // SMA50 window 251..300 contains i-5 (200) and i-21 (150): (48*100+200+150)/50 = 103 ; SMA200 window 101..300 also i-126 (50): (197*100+200+150+50)/200 = 100.5
  near(f.trend50_200, ln(103 / 100.5));
  // c[i] itself and c[i-4] must not be read by mom126_5
  const c2 = c.slice(); c2[i] = 1e6; c2[i - 4] = 1e6;
  assert.equal(L.featuresAt(c2, i).mom126_5, f.mom126_5);
  assert.equal(L.featuresAt(c2, i).mom252_21, f.mom252_21);
});

// ---------------------------------------------------------------------- B. forward return and feature alignment inside selectDates
test('B1 forward return and features at t, flat prices with one planted close: fwd[k] = k/100 exactly (kills fwd shift and feature<-fwd leak)', () => {
  const h = 5, t0 = FIRST_T;
  // every symbol is flat at 100 except close(t0+h) = 100+k  -> fwd_k = k/100 at t0 ; a shift by +-1 session reads 100 -> 0
  const series = saPanel(300, 24, (k, j) => ({c: j === t0 + h ? 100 + k : 100, v: 1e5}));
  const sel = R.selectDates(buildSa(series), h, presetThr(1));
  const rec = sel.recs[0];
  assert.equal(rec.t, t0);
  assert.equal(rec.ids.length, 24);
  rec.fwd.forEach((x, k) => near(x, k / 100, 1e-12));
  // features at t0 are computed from rows <= t0 only: flat history -> exactly 0 (a fwd leak would show k/100 here)
  for (const f of rec.feats) assert.deepEqual(f, {mom126_5: 0, trend50_200: 0, mom252_21: 0});
  // next selected date is t0 + h (all sessions eligible, greedy) and its forward return reads t0+2h, not the planted close
  assert.equal(sel.recs[1].t, t0 + h);
  sel.recs[1].fwd.forEach((x, k) => near(x, 100 / (100 + k) - 1, 1e-12)); // c[t0+h]=100+k -> c[t0+2h]=100
});
test('B2 missing close at t+h is filled with the LAST EARLIER close, never a later one (kills backward fill)', () => {
  const h = 5, t0 = FIRST_T; // t0+h = 264 ; close(j) = 100 + j
  const miss = {3: [264], 5: [263, 264, 265], 7: [262, 263, 264], 9: [t0]}; // symbol 9: no row at t0 itself
  const series = saPanel(300, 24, (k, j) => ((miss[k] || []).includes(j) ? null : {c: 100 + j, v: 1e5}));
  const rec = R.selectDates(buildSa(series), h, presetThr(1)).recs[0];
  assert.equal(rec.t, t0);
  const idx = (k) => rec.ids.indexOf(`${1000 + k}.SR`);
  const c0 = 100 + t0;
  const expect = {3: (100 + 263) / c0 - 1, 5: (100 + 262) / c0 - 1, 7: (100 + 261) / c0 - 1}; // last earlier close
  const wrongLater = {3: (100 + 265) / c0 - 1, 5: (100 + 266) / c0 - 1, 7: (100 + 265) / c0 - 1}; // next later close (the bug)
  for (const k of [3, 5, 7]) {
    assert.ok(Math.abs(expect[k] - wrongLater[k]) > 1e-3, 'fixture must distinguish earlier from later fill');
    near(rec.fwd[idx(k)], expect[k], 1e-12);
    assert.ok(Math.abs(rec.fwd[idx(k)] - wrongLater[k]) > 1e-3);
  }
  near(rec.fwd[idx(0)], (100 + t0 + h) / c0 - 1, 1e-12); // a symbol with all rows
  assert.equal(idx(9), -1, 'a symbol with no row at t is not in the universe at t (no stale quote is carried into t)');
  assert.equal(rec.ids.length, 23);
});

// ---------------------------------------------------------------------- C. liquidity universe uses data up to t only
test('C1 universe at t uses the 20-session traded value ending at t: a name liquid until t (then dead) is IN, a name dead until t (then liquid) is OUT', () => {
  const h = 63, A = 22, B = 23; // 22 ordinary names, A = liquid up to session 259 then zero volume, B = the reverse
  const series = saPanel(400, 24, (k, j) => ({c: 100, v: k === A ? (j <= FIRST_T ? 1e5 : 0) : k === B ? (j <= FIRST_T ? 0 : 1e5) : 1e5}));
  const sel = R.selectDates(buildSa(series), h, presetThr(5e6)); // traded value 1e7 > 5e6 when liquid
  const [r0, r1] = sel.recs;
  assert.equal(r0.t, FIRST_T);
  assert.ok(r0.ids.includes('1022.SR'), 'A was liquid through t: must be in');
  assert.ok(!r0.ids.includes('1023.SR'), 'B is illiquid through t (it only becomes liquid after t): must be out');
  assert.equal(r0.ids.length, 23);
  assert.equal(r1.t, FIRST_T + h);
  assert.ok(!r1.ids.includes('1022.SR'), 'A has been dead for the whole 20-session window ending at t1: out');
  assert.ok(r1.ids.includes('1023.SR'), 'B has been liquid for the whole window ending at t1: in');
});

test('C2 liquidity median is taken over the window ending exactly at t: a one-session look-ahead flips both a name that is in at t and a name that is out at t', () => {
  // traded value H=1e7 when volume is 1e5 at price 100 ; threshold 0.75 H. window at t0=259 is sessions 240..259.
  // X: zero volume on 240..249 only (10 low + 10 high -> median H/2 < thr -> OUT at t0 ; shifting the window by +1 session would give 9 low + 11 high -> median H -> IN)
  // Y: zero volume on 241..249 and from 260 on (11 high + 9 low -> median H -> IN at t0 ; window shifted by +1 session: 10 low + 10 high -> H/2 -> OUT)
  const X = 22, Y = 23;
  const vol = (k, j) => (k === X ? (j >= 240 && j <= 249 ? 0 : 1e5) : k === Y ? ((j >= 241 && j <= 249) || j >= 260 ? 0 : 1e5) : 1e5);
  const series = saPanel(300, 24, (k, j) => ({c: 100, v: vol(k, j)}));
  const rec = R.selectDates(buildSa(series), 5, presetThr(7.5e6)).recs[0];
  assert.equal(rec.t, FIRST_T);
  assert.ok(!rec.ids.includes('1022.SR'), 'X: median(window ending at t) = H/2 < threshold -> out');
  assert.ok(rec.ids.includes('1023.SR'), 'Y: median(window ending at t) = H >= threshold -> in');
  assert.equal(rec.ids.length, 23);
});

// ---------------------------------------------------------------------- D. no look-ahead anywhere in selectDates (truncate / alter / append)
function leakFixture() {
  const rng = L.mulberry32(404), N = 26, n = 420, p = Array.from({length: N}, () => { let x = 30 + rng() * 40; return Array.from({length: n}, () => (x *= Math.exp(0.012 * gauss(rng)))); });
  const skip = {2: [329, 330], 4: [200], 6: [300, 301, 302], 8: [120, 121]}; // scattered holes (fill-forward is exercised before and at the cut)
  return {N, n, p, skip, T: 330, h: 5};
}
const leakSeries = (fx, mode) => {
  const {N, p, skip, T} = fx;
  const nn = mode === 'trunc' ? T + 1 : fx.n;
  return saPanel(nn, N, (k, j) => {
    if ((skip[k] || []).includes(j)) return null;
    if (mode === 'alt' && j > T) return {c: p[k][j] * 3 * (1 + 0.1 * Math.sin(j + k)), v: 0};
    return {c: p[k][j], v: 1e6};
  });
};
const slim = (r) => ({t: r.t, date: r.date, ids: r.ids, feats: r.feats, fwd: r.fwd});
test('D1 altering EVERY price/volume after T changes nothing at dates <= T (features, universe) and nothing in fwd for t+h <= T', () => {
  const fx = leakFixture(), {T, h} = fx;
  const full = R.selectDates(buildSa(leakSeries(fx, 'full')), h, presetThr(1)).recs;
  const alt = R.selectDates(buildSa(leakSeries(fx, 'alt')), h, presetThr(1)).recs;
  const upToT = (recs) => recs.filter((r) => r.t <= T);
  assert.deepEqual(upToT(alt).map((r) => r.t), upToT(full).map((r) => r.t));
  assert.ok(upToT(full).length > 10);
  const byT = new Map(alt.map((r) => [r.t, r]));
  let straddle = 0;
  for (const r of upToT(full)) {
    const a = byT.get(r.t);
    assert.deepEqual(a.ids, r.ids, `universe at ${r.date}`);
    assert.deepEqual(a.feats, r.feats, `features at ${r.date}`);
    if (r.t + h <= T) assert.deepEqual(a.fwd, r.fwd, `fwd at ${r.date}`);
    else { straddle++; assert.notDeepEqual(a.fwd, r.fwd, 'fwd of a window that crosses T must see the altered future (fixture is sensitive)'); }
  }
  assert.ok(straddle >= 1);
});
test('D2 truncating the history at T gives exactly the prefix of the full run (appending future rows only adds later dates)', () => {
  const fx = leakFixture(), {T, h} = fx;
  const full = R.selectDates(buildSa(leakSeries(fx, 'full')), h, presetThr(1)).recs;
  const trunc = R.selectDates(buildSa(leakSeries(fx, 'trunc')), h, presetThr(1)).recs;
  const expected = full.filter((r) => r.t + h <= T);
  assert.ok(expected.length > 10);
  assert.deepEqual(trunc.map(slim), expected.map(slim));
});
test('D3 appending rows to the end of the history does not change any earlier record (ids, features, fwd)', () => {
  const fx = leakFixture(), h = fx.h;
  const mk = (n) => saPanel(n, fx.N, (k, j) => ((fx.skip[k] || []).includes(j) ? null : {c: fx.p[k][j], v: 1e6}));
  const short = R.selectDates(buildSa(mk(380)), h, presetThr(1)).recs, long = R.selectDates(buildSa(mk(420)), h, presetThr(1)).recs;
  assert.ok(short.length > 20 && long.length > short.length);
  assert.deepEqual(short.map(slim), long.slice(0, short.length).map(slim));
});

// ---------------------------------------------------------------------- E. analytic geometric universe through runDev (costs, turnover, counts, sign, permutation)
// 25 names per market, close_k(j) = 20*exp(a_k j), a_k = 0.0003*(k-12.5), traded value constant -> every name always liquid, composite rank = k/24 on
// every date, survivors = the nEx-th..24th highest-growth names. fwd_k = exp(a_k h)-1 on every date; dates are exactly h sessions apart.
const GEO_A = Array.from({length: NSYM_GEO}, (_, k) => 0.0003 * (k - 12.5));
function geoUniverse(n = 1000) {
  const out = [];
  const dSa = genDates(n, '2015-01-04', true), dUs = genDates(n, '2015-01-05', false);
  for (const [dates, cur, name] of [[dSa, 'SAR', (k) => `${1000 + k}.SR`], [dUs, 'USD', (k) => `US${String(k).padStart(2, '0')}`]]) {
    for (let k = 0; k < NSYM_GEO; k++) {
      const rows = dates.map((d, j) => { const c = 20 * Math.exp(GEO_A[k] * j); return [d, c, c, c, c, 1e7 / c]; });
      out.push({symbol: name(k), currency: cur, tz: 'UTC', splitsInRange: 0, rows});
    }
  }
  return out;
}
const NEX = {0.2: 5, 0.3: 7, 0.5: 12}; // floor(25*q): 5, 7 (7.5 floored), 12 (12.5 floored) - hard-coded, not computed by the library
function geoExpect(h, q) {
  const f = GEO_A.map((a) => Math.exp(a * h) - 1), g = GEO_A.map((a) => Math.exp(a * h)), nEx = NEX[q];
  const grossRet = L.mean(f.slice(nEx)) - L.mean(f);
  const sg = g.slice(nEx).reduce((s, x) => s + x, 0), ns = NSYM_GEO - nEx;
  const turnover = 0.5 * g.slice(nEx).reduce((s, x) => s + Math.abs(1 / ns - x / sg), 0); // drifted weights vs equal weights, same names
  const mu = L.mean(f), sigma2 = L.mean(f.map((x) => (x - mu) ** 2));
  return {nEx, ns, grossRet, turnover, sigma2};
}
let geoRunCache = null;
const geoRun = () => geoRunCache || (geoRunCache = R.runDev(geoUniverse(), {B: 10000}));

test('E1 selectDates on the geometric panel: fwd = exp(a h)-1, features = closed forms (121a, 231a, trend), dates exactly h apart', () => {
  const series = saPanel(1000, NSYM_GEO, (k, j) => { const c = 20 * Math.exp(GEO_A[k] * j); return {c, v: 1e7 / c}; });
  for (const h of [5, 21, 63]) {
    const recs = R.selectDates(buildSa(series), h, presetThr(1)).recs;
    assert.ok(recs.length >= 6);
    for (let i = 1; i < recs.length; i++) assert.equal(recs[i].t - recs[i - 1].t, h);
    for (const rec of recs) {
      assert.equal(rec.ids.length, NSYM_GEO);
      GEO_A.forEach((a, k) => {
        near(rec.fwd[k], Math.exp(a * h) - 1, 1e-12);
        near(rec.feats[k].mom126_5, 121 * a, 1e-9); // ln(c[i-5]/c[i-126]) = 121 a
        near(rec.feats[k].mom252_21, 231 * a, 1e-9); // ln(c[i-21]/c[i-252]) = 231 a
        near(rec.feats[k].trend50_200, ln((200 * (1 - Math.exp(-50 * a))) / (50 * (1 - Math.exp(-200 * a)))), 1e-9); // geometric-series closed form
      });
    }
  }
});
test('E2 runDev on the geometric panel: gross, turnover and every net(c) equal the hand-derived values; gross - net = turnover x c/1e4', () => {
  const res = geoRun();
  assert.equal(res.results.length, 18);
  for (const r of res.results) {
    const e = geoExpect(r.horizon, r.q), n = r.n_dates_eff;
    assert.ok(n >= 3, r.key);
    assert.equal(r.candidates.mean_before, 25); assert.equal(r.candidates.mean_excluded, e.nEx); assert.equal(r.candidates.mean_after, e.ns); // floor, not ceil/round
    const meanTo = (1 + (n - 1) * e.turnover) / n;
    near(r.composite.mean_one_way_turnover, meanTo, 6e-5);
    near(r.composite.gross_excess_pct.mean, 100 * e.grossRet, 2e-5);
    assert.ok(e.grossRet > 0.001 && e.turnover > 0.001, 'sign and size of the planted effect');
    for (const c of [0, 10, 25, 50]) {
      const net = r.composite.net_excess_pct_by_cost[`c${c}bps`].mean;
      near(net, 100 * (e.grossRet - meanTo * (c / 1e4)), 2e-5, `${r.key} c=${c}`);
      near(r.composite.gross_excess_pct.mean - net, 100 * meanTo * (c / 1e4), 4e-5); // the cost really is turnover x c
    }
    assert.ok(r.composite.net_excess_pct_by_cost.c25bps.mean < r.composite.net_excess_pct_by_cost.c0bps.mean);
  }
});
test('E3 primary per-date rows on the geometric panel: first rebalance turnover 1, later dates the hand-computed drift turnover, net25 = gross - turnover x 25bps', () => {
  const res = geoRun(), e = geoExpect(21, 0.3), rows = res.primary_test.per_date;
  assert.ok(rows.length >= 8);
  rows.forEach((d, i) => {
    assert.equal(d.N, 25); assert.equal(d.n_surv, e.ns);
    near(d.gross_pct, 100 * e.grossRet, 1e-5);
    const to = i === 0 ? 1 : e.turnover;
    near(d.turnover, to, 1e-4);
    near(d.net25_pct, 100 * (e.grossRet - to * 0.0025), 1e-5);
    if (i) assert.ok(d.gross_pct - d.net25_pct > 0, 'a cost is charged on every date (drift alone makes turnover > 0)');
  });
  assert.equal(rows[0].turnover, 1);
  assert.ok(rows[0].gross_pct - rows[0].net25_pct > 0.24); // 25 bps = 0.25 pct charged in full on the first rebalance
});
test('E4 permutation baseline inside runDev excludes the same count as the rule: null sd matches the finite-population formula within 3.5% (nEx +-1 moves it ~6%)', () => {
  const res = geoRun();
  let checked = 0;
  for (const r of res.results) {
    const p = r.permutation_random_exclusion;
    if (!p) continue;
    const e = geoExpect(r.horizon, r.q), D = r.n_dates_eff;
    // per date: stat = (nEx*mu - sumEx)/(N-nEx), var = nEx s2 / ((N-1)(N-nEx)); mean of D identical independent dates -> /D
    const sdTheory = Math.sqrt((e.nEx * e.sigma2) / ((NSYM_GEO - 1) * (NSYM_GEO - e.nEx) * D));
    assert.ok(Math.abs(p.null_sd / sdTheory - 1) < 0.035, `${r.key}: null_sd ${p.null_sd} vs theory ${sdTheory}`);
    assert.ok(Math.abs(p.null_mean) < 5 * sdTheory / Math.sqrt(p.iterations), `${r.key} null mean`);
    near(p.observed, e.grossRet, 2e-6);
    assert.ok(p.p_one_sided < 0.01, `${r.key}: the planted rank effect is far in the tail of the random-exclusion null`);
    checked++;
  }
  assert.ok(checked >= 12);
});

// ---------------------------------------------------------------------- F. independent re-derivation of the per-date pipeline on random-walk data
test('F1 runDev gross / turnover / net(c) for every SA combination equal an independent re-derivation from selectDates records', () => {
  const base = synthUniverse(91, 26, 1100);
  const res = R.runDev(base, {B: 50});
  const {cut} = R.applyDevCut(base.slice().sort((a, b) => (a.symbol < b.symbol ? -1 : 1)));
  const ctx = R.buildMarket('sa', cut.filter((s) => /\.SR$/.test(s.symbol)), {});
  const thr = new Map();
  let compared = 0;
  for (const h of [5, 21, 63]) {
    const recs = R.selectDates(ctx, h, thr).recs;
    for (const q of [0.2, 0.3, 0.5]) {
      const rows = []; let prev = null;
      for (const rec of recs) {
        const sc = L.compositeScores(rec.feats), ev = L.evaluateDate(rec.ids, sc, rec.fwd, q);
        const names = ev.survivors.map((i) => rec.ids[i]);
        let to = 1;
        if (prev) {
          const rets = prev.uni.map((si) => ctx.syms[si].closeAtCal[rec.t] / ctx.syms[si].closeAtCal[prev.t] - 1);
          to = L.turnoverOf(L.driftWeights(prev.names, rets), names);
        }
        prev = {t: rec.t, names, uni: ev.survivors.map((i) => rec.uni[i])};
        rows.push({gross: ev.retSurv - ev.retAll, to, nEx: ev.nEx, N: ev.N});
      }
      const r = res.results.find((x) => x.key === `sa|h${h}|q${q}`);
      assert.equal(r.n_dates_eff, recs.length);
      near(r.composite.gross_excess_pct.mean, 100 * L.mean(rows.map((x) => x.gross)), 1e-5);
      near(r.composite.mean_one_way_turnover, L.mean(rows.map((x) => x.to)), 6e-5);
      assert.ok(L.mean(rows.map((x) => x.to)) > 0.02 && L.mean(rows.map((x) => x.to)) <= 1, 'non-trivial turnover');
      assert.equal(r.candidates.mean_excluded, rows.length ? Math.round(100 * L.mean(rows.map((x) => x.nEx))) / 100 : null);
      for (const c of [0, 10, 25, 50]) near(r.composite.net_excess_pct_by_cost[`c${c}bps`].mean, 100 * L.mean(rows.map((x) => x.gross - x.to * c / 1e4)), 1e-5, `${r.key} c${c}`);
      compared++;
    }
  }
  assert.equal(compared, 9);
  // per-date rows of the primary test line up with the same derivation
  const recs21 = R.selectDates(ctx, 21, new Map()).recs, pd = res.primary_test.per_date;
  assert.equal(pd.length, recs21.length);
  assert.deepEqual(pd.map((d) => d.date), recs21.map((r) => r.date));
  assert.equal(pd[0].turnover, 1);
});

// ---------------------------------------------------------------------- G. signed controls (the old noise-only test cannot detect a flipped sign)
function driftUniverse(seed, nPerMarket, nDates, spread) {
  const rng = L.mulberry32(seed), out = [];
  const dSa = genDates(nDates, '2015-01-04', true), dUs = genDates(nDates, '2015-01-05', false);
  for (let i = 0; i < nPerMarket; i++) out.push(synthSeries(`${1000 + i}.SR`, dSa, rng, {drift: spread * (i - (nPerMarket - 1) / 2) / nPerMarket}));
  for (let i = 0; i < nPerMarket; i++) out.push(synthSeries(`US${String(i).padStart(2, '0')}`, dUs, rng, {drift: spread * (i - (nPerMarket - 1) / 2) / nPerMarket}));
  return out;
}
test('G1 POSITIVE CONTROL: persistent cross-sectional drift (high feature -> high forward return) gives positive gross excess and a small permutation p', () => {
  const res = R.runDev(driftUniverse(95, 30, 1300, 0.004), {B: 400});
  const pos = res.results.filter((r) => r.composite.gross_excess_pct.mean > 0);
  assert.equal(pos.length, 18, `positive gross excess in ${pos.length}/18 combos`); // measured: all 18, 0.14..3.8 pct
  assert.ok(res.primary_test.gross_excess_pct.mean > 0, 'primary gross excess must be positive when the rule removes the weak names');
  assert.ok(res.results.every((r) => r.permutation_random_exclusion && r.permutation_random_exclusion.p_one_sided < 0.01)); // measured 0.0025 (the floor at B=400) everywhere
  assert.ok(res.results.every((r) => r.composite.hit_rate_lift_pts.mean > 0)); // hit-rate lift has the same sign as the gross excess
});
test('G2 REVERSED-SIGN CONTROL: if the rule is applied backwards (exclude the BEST names) the same panel shows negative gross excess', () => {
  const base = driftUniverse(95, 30, 1300, 0.004);
  const {cut} = R.applyDevCut(base);
  const ctx = R.buildMarket('sa', cut.filter((s) => /\.SR$/.test(s.symbol)), {});
  const recs = R.selectDates(ctx, 21, new Map()).recs;
  const gross = (flip) => L.mean(recs.map((rec) => {
    const sc = L.compositeScores(rec.feats).map((x) => (flip ? 1 - x : x));
    const ev = L.evaluateDate(rec.ids, sc, rec.fwd, 0.3);
    return ev.retSurv - ev.retAll;
  }));
  const good = gross(false), bad = gross(true);
  assert.ok(good > 0 && bad < 0, `rule ${good} reversed rule ${bad}`);
  // and runDev's own number for sa|h21|q0.3 is the un-flipped one
  const res = R.runDev(base, {B: 50});
  near(res.results.find((r) => r.key === 'sa|h21|q0.3').composite.gross_excess_pct.mean, 100 * good, 1e-5);
});

// ---------------------------------------------------------------------- H. permutation baseline (lib): exclusion count per date is exactly nEx
test('H1 permutation baseline: exact two-point null (one outlier among 10 names, nEx=3) -> p = 0.7, null sd = sqrt(0.7*(3/7)^2+0.3), null mean = 0', () => {
  const f = [10, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // survivors' mean excess is 10/7-1 = 3/7 if the outlier survives (prob 7/10), else -1
  const obs = 10 / 7 - 1;
  const B = 20000, r = L.permutationBaseline([f], [3], obs, B, L.mulberry32(5));
  assert.ok(Math.abs(r.p - 0.7) < 0.02, `p ${r.p}`); // nEx=2 would give ~0.0 ; nEx=4 would give ~0.6
  assert.ok(Math.abs(r.null_sd - Math.sqrt(0.7 * (3 / 7) ** 2 + 0.3)) < 0.02, `sd ${r.null_sd}`); // nEx=2 -> 0.5, nEx=4 -> 0.73
  assert.ok(Math.abs(r.null_mean) < 0.015, `mean ${r.null_mean}`);
  assert.equal(r.B, B);
});
test('H2 permutation baseline: null sd follows the finite-population formula with a DIFFERENT nEx on each date', () => {
  const rng = L.mulberry32(77), Ns = [10, 20, 40, 25];
  const fwd = Ns.map((N) => Array.from({length: N}, () => 0.05 * gauss(rng)));
  const theory = (nExs) => {
    let varSum = 0;
    fwd.forEach((f, d) => {
      const N = f.length, mu = L.mean(f), s2 = L.mean(f.map((x) => (x - mu) ** 2));
      varSum += (nExs[d] * s2) / ((N - 1) * (N - nExs[d]));
    });
    return Math.sqrt(varSum) / Ns.length;
  };
  const nExs = [3, 5, 12, 7], other = [5, 10, 20, 12];
  const r = L.permutationBaseline(fwd, nExs, 0, 20000, L.mulberry32(9));
  assert.ok(Math.abs(r.null_sd / theory(nExs) - 1) < 0.03, `sd ${r.null_sd} theory ${theory(nExs)}`);
  assert.ok(Math.abs(r.null_mean) < 5 * theory(nExs) / Math.sqrt(20000));
  // the supplied counts really drive the null: other counts -> a clearly different, equally well-predicted sd
  const r2 = L.permutationBaseline(fwd, other, 0, 20000, L.mulberry32(9));
  assert.ok(Math.abs(r2.null_sd / theory(other) - 1) < 0.03);
  assert.ok(Math.abs(theory(other) / theory(nExs) - 1) > 0.2);
  // a +-1 error on every date (the kind of off-by-one a mutation would introduce) is outside the 3% tolerance
  assert.ok(Math.abs(theory(nExs.map((x) => x + 1)) / theory(nExs) - 1) > 0.05 && Math.abs(theory(nExs.map((x) => x - 1)) / theory(nExs) - 1) > 0.05);
});

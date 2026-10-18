'use strict';
/**
 * Unit tests for DIR-0001 (research/experiments/dir-0001.cjs; reuses negsel-lib.cjs / negsel-0002.cjs).
 * run: node --test research/tests/dir-0001.test.cjs
 * CODE-TESTED status only: passing these tests is NOT predictive evidence for the model.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../experiments/negsel-lib.cjs');
const NS = require('../experiments/negsel-0002.cjs');
const D = require('../experiments/dir-0001.cjs');

// ------------------------------------------------------------------ synthetic helpers
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
/** drifts: per-symbol daily log drift (planted persistent signal when non-zero). */
function synthUniverse(seed, {nPerMarket = 24, nDates = 1000, drifts = null, vol = 0.012, stableValue = false} = {}) {
  const rng = L.mulberry32(seed), out = [];
  const mk = (symbol, dates, drift) => {
    let p = 20 + rng() * 30;
    const rows = dates.map((date) => { p *= Math.exp(drift + vol * gauss(rng)); return [date, p, p * 1.01, p * 0.99, p, Math.round((stableValue ? 6e7 / p : 2e6) * (0.5 + rng()))]; });
    return {symbol, currency: /\.SR$/.test(symbol) ? 'SAR' : 'USD', tz: 'UTC', splitsInRange: 0, rows};
  };
  const dSa = genDates(nDates, '2015-01-04', true), dUs = genDates(nDates, '2015-01-05', false);
  for (let i = 0; i < nPerMarket; i++) out.push(mk(`${1000 + i}.SR`, dSa, drifts ? drifts(i) : 0));
  for (let i = 0; i < nPerMarket; i++) out.push(mk(`US${String(i).padStart(2, '0')}`, dUs, drifts ? drifts(i) : 0));
  return out;
}
const clone = (x) => JSON.parse(JSON.stringify(x));

// cache full runs (each runDev trains 16 models with the engine defaults)
const runCache = new Map();
function runCached(key, series, B = 200) {
  if (!runCache.has(key)) runCache.set(key, D.runDev(series, {B}));
  return runCache.get(key);
}

// ------------------------------------------------------------------ 1. holdout cut
test('holdout cut removes every post-cutoff row and nothing on/before the cutoff', () => {
  const u = synthUniverse(3);
  const {cutoff, cut} = NS.applyDevCut(u);
  assert.ok(cutoff);
  for (let k = 0; k < u.length; k++) {
    const before = u[k].rows.filter((r) => r[0] <= cutoff);
    assert.deepEqual(cut[k].rows, before);
    assert.ok(cut[k].rows.every((r) => r[0] <= cutoff));
    assert.ok(u[k].rows.some((r) => r[0] > cutoff), 'synthetic data really has post-cutoff rows');
  }
  assert.throws(() => NS.assertNoHoldout([{symbol: 'X', rows: [[cutoff], ['9999-01-01']]}], cutoff), /holdout row leaked/);
});

test('POISONING: altering every row after the cutoff does not change any output byte of runDev', async () => {
  const base = synthUniverse(5);
  const {cutoff} = NS.applyDevCut(base);
  const ref = JSON.stringify(await runCached('noise5', base));
  const poisoned = clone(base);
  let touched = 0;
  for (const s of poisoned) s.rows = s.rows.map((r) => { if (r[0] > cutoff) { touched++; return [r[0], NaN, r[4] * 1e6, -3, r[4] * 1e6 + 1, 1e18]; } return r; });
  assert.ok(touched > 1000);
  assert.equal(JSON.stringify(await D.runDev(poisoned, {B: 200})), ref);
  const parsed = JSON.parse(ref);
  assert.equal(parsed.dev_cutoff.date, cutoff);
  assert.equal(parsed.holdout_opened, false);
  for (const m of ['sa', 'us']) assert.ok(parsed.data.markets[m].dev_calendar.last <= cutoff);
  assert.ok(parsed.data.rows_removed_by_cut_total > 0);
});

// ------------------------------------------------------------------ 2. features use only data <= t
test('features at t (all five) are unchanged when data after t is altered (future data would change them otherwise)', () => {
  const rng = L.mulberry32(7);
  const c = [];
  let p = 50;
  for (let i = 0; i < 700; i++) { p *= Math.exp(0.01 * gauss(rng)); c.push(p); }
  for (const i of [260, 400, 650]) {
    const base = D.featuresAllAt(c, i);
    assert.ok(D.allFinite(base));
    const altered = c.slice();
    for (let k = i + 1; k < altered.length; k++) altered[k] = 1e9 * (k + 1);
    assert.deepEqual(D.featuresAllAt(altered, i), base);
    assert.deepEqual(D.featuresAllAt(c.slice(0, i + 1), i), base);
    // a feature evaluated LATER does see the change (the test series really would move the value)
    const later = D.featuresAllAt(altered, i + 5);
    assert.notEqual(later.rev5, D.featuresAllAt(c, i + 5).rev5);
  }
});
test('rev5 and vol63: hand-computed values on a closed-form series', () => {
  const c = Array.from({length: 300}, (_, j) => Math.exp(0.001 * j + (j % 2 ? 0.01 : 0)));
  const i = 299;
  const e = D.extraFeaturesAt(c, i);
  assert.ok(Math.abs(e.rev5 - Math.log(c[i] / c[i - 5])) < 1e-15);
  const r = []; for (let k = i - 62; k <= i; k++) r.push(Math.log(c[k] / c[k - 1]));
  assert.ok(Math.abs(e.vol63 - L.sd(r)) < 1e-15);
  assert.ok(Number.isNaN(D.extraFeaturesAt(c, 62).vol63));
});
test('panel at date t is identical whether built from full histories or from histories truncated at t', () => {
  const u = synthUniverse(9, {nDates: 700});
  const ctxFull = D.buildContext('sa', u.filter((s) => /\.SR$/.test(s.symbol)));
  const panelFull = D.buildPanel(ctxFull, 5);
  const rec = panelFull[Math.floor(panelFull.length / 2)];
  const endDate = ctxFull.cal[rec.t + 5]; // the target date must remain available
  const trunc = u.filter((s) => /\.SR$/.test(s.symbol)).map((s) => ({...s, rows: s.rows.filter((r) => r[0] <= endDate)}));
  const panelT = D.buildPanel(D.buildContext('sa', trunc), 5);
  const recT = panelT.find((r) => r.date === rec.date);
  assert.deepEqual(recT.x, rec.x);
  assert.deepEqual(recT.ids, rec.ids);
  assert.deepEqual(recT.y, rec.y);
});

// ------------------------------------------------------------------ 3. rank scaling
test('rankScaled maps to [-0.5, 0.5] with average ranks for ties and ignores NaN', () => {
  assert.deepEqual(D.rankScaled([3, 1, 2]), [0.5, -0.5, 0]);
  assert.deepEqual(D.rankScaled([1, 1, 2, 3, 3]), [-0.375, -0.375, 0, 0.375, 0.375]);
  const r = D.rankScaled([5, NaN, 1]);
  assert.equal(r[0], 0.5); assert.ok(Number.isNaN(r[1])); assert.equal(r[2], -0.5);
  assert.deepEqual(D.rankScaled([42]), [0]);
  const u = synthUniverse(4, {nDates: 600});
  const panel = D.buildPanel(D.buildContext('us', u.filter((s) => !/\.SR$/.test(s.symbol))), 5);
  for (const rec of panel.slice(0, 20)) for (const f of D.CONSTANTS.FEATURES) {
    const v = rec.x.map((x) => x[f]);
    assert.equal(Math.min(...v), -0.5); assert.equal(Math.max(...v), 0.5);
  }
});

// ------------------------------------------------------------------ 4. embargo / walk-forward
test('fold plan: no training or calibration target after the fold cutoff; embargo h; calibration strictly after training', () => {
  const u = synthUniverse(6);
  const {cut} = NS.applyDevCut(u);
  for (const h of [5, 21]) {
    const ctx = D.buildContext('sa', cut.filter((s) => /\.SR$/.test(s.symbol)));
    const panel = D.buildPanel(ctx, h);
    for (const Y of D.testYearsOf(ctx.cal)) {
      const plan = D.planFold(ctx, panel, h, Y);
      if (!plan.ok) continue;
      const firstOfY = ctx.cal[plan.y0];
      for (const r of plan.pool) {
        assert.ok(r.targetDate <= plan.foldCutoff, 'target after fold cutoff');
        assert.ok(r.t <= plan.y0 - 1 - h, 'embargo');
        assert.ok(r.targetDate < firstOfY);
      }
      for (const r of plan.calib) assert.ok(r.date > plan.trainedThrough);
      const lastTrain = plan.train[plan.train.length - 1];
      assert.equal(plan.trainedThrough, ctx.cal[lastTrain.t + h]);
      assert.equal(plan.train.length, Math.floor(plan.pool.length * 0.8));
    }
  }
});
test('runDev records per fold: max train/calib target <= fold cutoff < first test date', async () => {
  const res = await runCached('noise5', synthUniverse(5));
  let checked = 0;
  for (const m of ['sa', 'us']) for (const h of ['h5', 'h21']) for (const f of res.data.markets[m].horizons[h].folds) {
    if (!f.evaluable) continue;
    checked++;
    assert.ok(f.max_train_target <= f.fold_cutoff);
    assert.ok(f.trained_through <= f.fold_cutoff);
    if (f.max_calib_target) assert.ok(f.max_calib_target <= f.fold_cutoff);
    assert.ok(f.calib_first > f.trained_through);
    assert.ok(f.first_test_date > f.fold_cutoff);
  }
  assert.ok(checked >= 2);
});
test('the engine itself rejects an unmatured training row (targetAt after cutoff)', async () => {
  const E = await D.loadEngine();
  const rows = Array.from({length: 40}, (_, i) => ({market: 'SA', horizon: 5, asOf: '2020-01-01', featuresAvailableAt: '2020-01-01', targetAt: '2020-01-08', availableAt: '2020-01-08', actualUp: i % 2, features: {a: i / 40 - 0.5}}));
  assert.ok(E.trainDirection(rows, {market: 'SA', horizon: 5, cutoff: '2020-01-08', featureNames: ['a']}));
  assert.throws(() => E.trainDirection(rows, {market: 'SA', horizon: 5, cutoff: '2020-01-07', featureNames: ['a']}), /unmatured or future/);
});

// ------------------------------------------------------------------ 5. non-overlap
test('test dates are spaced >= h sessions (also across fold years) and lie in test years only', async () => {
  const res = await runCached('noise5', synthUniverse(5));
  const u = synthUniverse(5);
  const {cut} = NS.applyDevCut(u);
  for (const m of ['sa', 'us']) {
    const ctx = D.buildContext(m, cut.filter((s) => (m === 'sa') === /\.SR$/.test(s.symbol)));
    const idx = new Map(ctx.cal.map((d, i) => [d, i]));
    for (const h of [5, 21]) {
      const key = `${m}|h${h}|q0.2`;
      const c = res.results.find((x) => x.key === key);
      assert.ok(c.power.n_nonoverlapping_dates > 3);
      const panel = D.buildPanel(ctx, h);
      const years = D.testYearsOf(ctx.cal);
      const sel = D.selectTestRecords(panel, h, years[0]);
      for (let k = 1; k < sel.length; k++) assert.ok(idx.get(sel[k].date) - idx.get(sel[k - 1].date) >= h);
      assert.ok(sel.every((r) => r.year >= years[0]));
    }
  }
  const sel = L.selectNonOverlapping([0, 1, 2, 5, 6, 9, 10, 30], 5);
  assert.deepEqual(sel, [0, 5, 10, 30]);
});

// ------------------------------------------------------------------ 6. lift / base-rate math
test('evalTop: lift = hit of top floor(N q) - base rate, ties by id (hand-computed)', () => {
  const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const scores = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0];
  const y = [1, 0, 1, 1, 0, 0, 0, 1, 0, 0];
  const e = D.evalTop(scores, ids, y, 0.2);
  assert.equal(e.nSel, 2); assert.equal(e.base, 0.4); assert.equal(e.hit, 0.5); assert.ok(Math.abs(e.lift - 0.1) < 1e-15);
  const e3 = D.evalTop(scores, ids, y, 0.3);
  assert.equal(e3.nSel, 3); assert.ok(Math.abs(e3.hit - 2 / 3) < 1e-15);
  // tie at the cut broken by id
  const t = D.selectTop([1, 1, 1, 0], ['Z', 'B', 'M', 'A'], 0.5);
  assert.deepEqual(t.map((i) => ['Z', 'B', 'M', 'A'][i]).sort(), ['B', 'M']);
  assert.equal(L.exclusionCount(40, 0.2), 8); assert.equal(L.exclusionCount(40, 0.1), 4); assert.equal(L.exclusionCount(40, 0.3), 12);
});
test('n_eff (AMEND-1), lag-1 autocorrelation, Brier, calibration table: hand-computed', () => {
  assert.equal(D.nEff(100, 0), 100);
  assert.ok(Math.abs(D.nEff(100, 0.2) - 100 * 0.8 / 1.2) < 1e-12);
  assert.equal(D.nEff(100, -0.3), 100); // clipped at >= 0
  assert.equal(D.nEff(10, NaN), null);
  const x = [1, 2, 3, 4];
  // m=2.5; num = (-1.5)(-0.5)+(-0.5)(0.5)+(0.5)(1.5) = 0.75-0.25+0.75 = 1.25; den = 5
  assert.ok(Math.abs(D.lag1Autocorr(x) - 0.25) < 1e-15);
  assert.ok(D.lag1Autocorr([1, -1, 1, -1, 1, -1]) < 0);
  assert.ok(Math.abs(D.brier([0.5, 0.5], [1, 0]) - 0.25) < 1e-15);
  assert.ok(Math.abs(D.brier([0.9, 0.2], [1, 0]) - (0.01 + 0.04) / 2) < 1e-15);
  const tab = D.calibrationTable([0.1, 0.3, 0.35, 0.5, 0.9, 1.0], [0, 0, 1, 1, 1, 1], 'equal_width');
  assert.deepEqual(tab.map((b) => b.n), [1, 2, 1, 0, 2]);
  assert.equal(tab[1].observed_up_rate, 0.5);
  const qt = D.calibrationTable(Array.from({length: 10}, (_, i) => i / 10), Array(10).fill(1), 'quintile');
  assert.deepEqual(qt.map((b) => b.n), [2, 2, 2, 2, 2]);
});

// ------------------------------------------------------------------ 7. permutation null and planted signal
test('permutation null on a random signal: null mean ~ 0 and observed random-score lift not significant', () => {
  const rng = L.mulberry32(99);
  const days = 150, N = 40, q = 0.2;
  const ys = [], lifts = [];
  for (let d = 0; d < days; d++) {
    const y = Array.from({length: N}, () => (rng() < 0.52 ? 1 : 0));
    const s = Array.from({length: N}, () => rng());
    const ids = Array.from({length: N}, (_, i) => `S${i}`);
    ys.push(y); lifts.push(D.evalTop(s, ids, y, q).lift);
  }
  const pr = L.permutationBaseline(ys, ys.map(() => N - 8), L.mean(lifts), 2000, L.seededRng(1, 'perm'));
  assert.ok(Math.abs(pr.null_mean) < 0.003, `null mean ${pr.null_mean}`);
  assert.ok(pr.p > 0.05, `p ${pr.p}`);
});
test('noise panel: runDev does not produce an eligible decision and lift CI covers ~0', async () => {
  const res = await runCached('noise5', synthUniverse(5));
  assert.notEqual(res.decision.decision, 'ELIGIBLE_SHADOW_RUN_ONLY');
  const p = res.primary_test;
  assert.ok(Math.abs(p.permutation.null_mean_pts) < 1);
  assert.equal(res.decision.status_ceiling, 'SHADOW-VALIDATED');
});
test('PLANTED SIGNAL: persistent cross-sectional drift gives positive lift, BSS > 0 and small permutation p (sanity)', async () => {
  const drifts = (i) => ((i % 24) - 11.5) * 0.0004; // persistent per-name drift -> momentum features predictive
  const res = await runCached('planted', synthUniverse(21, {drifts, vol: 0.01, stableValue: true}));
  const p = res.primary_test;
  assert.ok(p.lift_pts.mean > 5, `lift ${p.lift_pts.mean}`);
  assert.ok(p.lift_pts.ci95[0] > 0);
  assert.ok(p.permutation.p_one_sided < 0.05);
  assert.ok(p.brier.bss > 0, `bss ${p.brier.bss}`);
  const us = res.results.find((c) => c.key === 'us|h5|q0.2');
  assert.ok(us.lift_pts.mean > 5);
  // reversed sign control: selecting the LOWEST P would be negative -> the top-q direction matters
  assert.ok(p.baseline_mom126_5.lift_pts.mean > 0);
});

// ------------------------------------------------------------------ 8. decision table
test('decision rules: REJECTED / INCONCLUSIVE / ELIGIBLE (protocol 8)', () => {
  const ok = {primary_ci_lower_gt_0: true, primary_permutation_p_lt_0_05: true, primary_bss_gt_0: true, lift_positive_in_ge_70pct_folds: true};
  assert.equal(D.decide({criteria: ok, nEffPrimary: 120}).decision, 'ELIGIBLE_SHADOW_RUN_ONLY');
  assert.equal(D.decide({criteria: ok, nEffPrimary: 60}).decision, 'ELIGIBLE_SHADOW_RUN_ONLY');
  assert.equal(D.decide({criteria: ok, nEffPrimary: 59.9}).decision, 'INCONCLUSIVE');
  assert.equal(D.decide({criteria: ok, nEffPrimary: null}).decision, 'INCONCLUSIVE');
  for (const k of Object.keys(ok)) {
    const r = D.decide({criteria: {...ok, [k]: false}, nEffPrimary: 500});
    assert.equal(r.decision, 'REJECTED');
    assert.deepEqual(r.reasons, [`failed:${k}`]);
  }
  // failure dominates low power and unknown
  assert.equal(D.decide({criteria: {...ok, primary_bss_gt_0: false, primary_ci_lower_gt_0: null}, nEffPrimary: 10}).decision, 'REJECTED');
  assert.equal(D.decide({criteria: {...ok, primary_bss_gt_0: null}, nEffPrimary: 500}).decision, 'INCONCLUSIVE');
});

// ------------------------------------------------------------------ 9. hygiene
test('split guard flags ratio >= 2 or <= 0.5 only', () => {
  const rows = [10, 10.5, 5.1, 5.2, 11, 11.2, 6.0].map((c, i) => ({date: `2020-01-0${i + 1}`, c}));
  const j = D.detectUnadjustedSplits(rows);
  // 10.5 -> 5.1 = 0.486 (flag); 5.2 -> 11 = 2.115 (flag); 11.2 -> 6.0 = 0.536 (no flag)
  assert.deepEqual(j.map((x) => x.date), ['2020-01-03', '2020-01-05']);
});
test('sources use no Math.random / Date.now and the engine file is imported unmodified', () => {
  const src = fs.readFileSync(path.join(__dirname, '../experiments/dir-0001.cjs'), 'utf8');
  assert.ok(!/Math\.random\(/.test(src));
  assert.ok(!/Date\.now\(/.test(src));
  assert.ok(/probability\.mjs/.test(src));
});

#!/usr/bin/env node
'use strict';
/**
 * DIR-0001 — probabilistic direction model, h = 5 / 21, SHADOW ONLY (PROTOCOL-DIR-0001.md, frozen at commit 9f7d4b5).
 *   usage: node research/experiments/dir-0001.cjs <prices-dir> [out.json]
 *
 * HOLDOUT: the NEGSEL-0002 development cutoff (determineDevCutoff, last 30% of every calendar) is applied FIRST and every row dated
 * after it is physically removed (cutRows) before any feature / universe / target / model / statistic is computed. Nothing here
 * opens the holdout.
 *
 * Model engine: mizan-v45/research/aziz/src/probability.mjs used UNMODIFIED via dynamic import() (trainDirection with its default
 * optimizer 600 it / lr 0.1 / reg 0.01, fitProbabilityCalibration = Platt on a later, disjoint sample, predictProbability). The engine
 * itself rejects unmatured/future training rows and calibration rows that overlap the training time.
 *
 * Deterministic: seeded PRNG streams (negsel-lib mulberry32/fnv1a), no Math.random, no Date.now in results.
 * Code status: CODE-TESTED (research/tests/dir-0001.test.cjs). Unit tests are NOT predictive evidence.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {pathToFileURL} = require('url');
const L = require('./negsel-lib.cjs');
const NS = require('./negsel-0002.cjs'); // applyDevCut, assertNoHoldout, buildMarket, foldThreshold (reused, not copied)

// ------------------------------------------------------------------ protocol constants (nothing here is tuned)
const PROTOCOL_COMMIT_FROZEN = '9f7d4b59c9c41c9977adf1ede65abbc2e53da6da';
const SEED = 2026101801; // fixed before running; per-test streams = fnv1a(SEED|key)
const MARKETS = ['sa', 'us'];
const HS = [5, 21];
const QS = [0.1, 0.2, 0.3];
const PRIMARY = {market: 'sa', h: 5, q: 0.2};
const SECONDARY = [{market: 'sa', h: 21, q: 0.2}, {market: 'us', h: 5, q: 0.2}, {market: 'us', h: 21, q: 0.2}];
const B_DEFAULT = 2000; // bootstrap resamples AND permutation iterations
const POWER_MIN_N_EFF = 60; // owner decision 2026-10-15
const FOLD_POSITIVE_MIN = 0.7;
const TRAIN_FRACTION = 0.8; // first 80% (by date) train, last 20% calibration
const FEATURES = ['mom126_5', 'trend50_200', 'mom252_21', 'rev5', 'vol63'];
const MIN_HISTORY = 260; // NEGSEL universe rule (clean series >= 260 sessions at t)
const MIN_UNIVERSE = NS.CONSTANTS.MIN_UNIVERSE; // 20, NEGSEL rule
const SPLIT_JUMP_RATIO = 2; // unadjusted-split guard: a close-to-close ratio >= 2 or <= 1/2 rejects the series
const ENGINE_PATH = path.join(__dirname, '..', '..', 'mizan-v45', 'research', 'aziz', 'src', 'probability.mjs');

const marketOf = (sym) => (/\.SR$/.test(sym) ? 'sa' : 'us');
const engineMarket = (m) => (m === 'sa' ? 'SA' : 'US');
const comboKey = (m, h, q) => `${m}|h${h}|q${q}`;
const rnd = (x, d = 5) => (L.isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const rndArr = (a, d = 5) => a.map((x) => rnd(x, d));
const pts = (x) => 100 * x;

let enginePromise = null;
function loadEngine() {
  if (!enginePromise) enginePromise = import(pathToFileURL(ENGINE_PATH).href);
  return enginePromise;
}

// ------------------------------------------------------------------ cleaning guard: unadjusted splits (protocol 1)
/** Returns the list of close-to-close jumps with ratio >= SPLIT_JUMP_RATIO or <= 1/SPLIT_JUMP_RATIO (clean rows {date,c}). */
function detectUnadjustedSplits(cleanRows, ratio = SPLIT_JUMP_RATIO) {
  const out = [];
  for (let i = 1; i < cleanRows.length; i++) {
    const r = cleanRows[i].c / cleanRows[i - 1].c;
    if (r >= ratio || r <= 1 / ratio) out.push({date: cleanRows[i].date, ratio: rnd(r, 4)});
  }
  return out;
}

// ------------------------------------------------------------------ features (rows <= i only)
/** rev5 = ln(c[i]/c[i-5]); vol63 = sample sd of the 63 daily log returns ending at i. Reads c[i-63..i] only. */
function extraFeaturesAt(c, i) {
  const bad = {rev5: NaN, vol63: NaN};
  if (!Number.isInteger(i) || i < 63 || i >= c.length) return bad;
  for (let k = i - 63; k <= i; k++) if (!L.isNum(c[k]) || c[k] <= 0) return bad;
  const r = [];
  for (let k = i - 62; k <= i; k++) r.push(Math.log(c[k] / c[k - 1]));
  return {rev5: Math.log(c[i] / c[i - 5]), vol63: L.sd(r)};
}
/** All five protocol features at row i (raw values). mom126_5 / trend50_200 / mom252_21 come from negsel-lib.featuresAt. */
function featuresAllAt(c, i) {
  return Object.assign({}, L.featuresAt(c, i), extraFeaturesAt(c, i));
}
const allFinite = (f) => FEATURES.every((k) => L.isNum(f[k]));
/** Cross-sectional rank scaled to [-0.5, 0.5] (average ranks for ties; single name -> 0). */
function rankScaled(values) {
  return L.rankNormalized(values).map((x) => (L.isNum(x) ? x - 0.5 : NaN));
}

// ------------------------------------------------------------------ market context
function buildContext(mkt, seriesList) {
  const splitRejected = [];
  const kept = [];
  for (const s of seriesList) {
    const {rows} = L.cleanSeries(s.rows);
    const jumps = detectUnadjustedSplits(rows);
    if (jumps.length) splitRejected.push({symbol: s.symbol, jumps});
    else kept.push(s);
  }
  const ctx = NS.buildMarket(mkt, kept, {});
  for (const s of ctx.syms) {
    const c = s.rows.map((r) => r.c), n = c.length;
    s.rev5 = new Float64Array(n).fill(NaN);
    s.vol63 = new Float64Array(n).fill(NaN);
    for (let i = MIN_HISTORY - 1; i < n; i++) { const e = extraFeaturesAt(c, i); s.rev5[i] = e.rev5; s.vol63[i] = e.vol63; }
  }
  ctx.splitRejected = splitRejected;
  return ctx;
}

/** NEGSEL universe at calendar index t (clean history >= 260, finite features, liquidity >= fold threshold, close at t+h exists). */
function universeAt(ctx, t, h, thr) {
  const out = [];
  for (let si = 0; si < ctx.syms.length; si++) {
    const s = ctx.syms[si], r = s.rowOfCal[t];
    if (r < MIN_HISTORY - 1 || !s.featOk[r]) continue;
    if (!L.isNum(s.rev5[r]) || !L.isNum(s.vol63[r])) continue;
    if (!(s.med20[r] >= thr)) continue;
    if (t + h >= ctx.cal.length || !L.isNum(s.closeAtCal[t + h])) continue;
    out.push(si);
  }
  return out;
}

/**
 * Panel for one market x horizon: one record per calendar date t with >= MIN_UNIVERSE eligible names.
 * Each record: t, date, targetDate (= cal[t+h]), ids, raw mom126_5, rank-scaled features, y (actualUp), fwd.
 */
function buildPanel(ctx, h) {
  const thrCache = new Map(), recs = [];
  for (let t = 0; t + h < ctx.cal.length; t++) {
    const year = Number(ctx.cal[t].slice(0, 4));
    if (!thrCache.has(year)) thrCache.set(year, NS.foldThreshold(ctx, year));
    const thr = thrCache.get(year);
    if (thr === null) continue;
    const uni = universeAt(ctx, t, h, thr);
    if (uni.length < MIN_UNIVERSE) continue;
    const raw = {mom126_5: [], trend50_200: [], mom252_21: [], rev5: [], vol63: []};
    for (const si of uni) {
      const s = ctx.syms[si], r = s.rowOfCal[t];
      raw.mom126_5.push(s.f1[r]); raw.trend50_200.push(s.f2[r]); raw.mom252_21.push(s.f3[r]); raw.rev5.push(s.rev5[r]); raw.vol63.push(s.vol63[r]);
    }
    const scaled = {};
    for (const k of FEATURES) scaled[k] = rankScaled(raw[k]);
    const fwd = uni.map((si) => ctx.syms[si].closeAtCal[t + h] / ctx.syms[si].closeAtCal[t] - 1);
    recs.push({
      t, date: ctx.cal[t], targetDate: ctx.cal[t + h], year: Number(ctx.cal[t].slice(0, 4)),
      ids: uni.map((si) => ctx.syms[si].symbol),
      mom: raw.mom126_5.slice(),
      x: uni.map((_, j) => Object.fromEntries(FEATURES.map((k) => [k, scaled[k][j]]))),
      fwd, y: fwd.map((r) => (r > 0 ? 1 : 0)),
    });
  }
  return recs;
}

/** Engine rows for a set of panel records. availableAt = targetAt = cal[t+h]; featuresAvailableAt = asOf = cal[t]. */
function engineRows(recs, mkt, h) {
  const out = [];
  for (const r of recs) for (let j = 0; j < r.ids.length; j++) {
    out.push({id: `${r.ids[j]}|${r.date}`, market: engineMarket(mkt), horizon: h, asOf: r.date, featuresAvailableAt: r.date,
      targetAt: r.targetDate, availableAt: r.targetDate, actualUp: r.y[j], features: r.x[j]});
  }
  return out;
}

// ------------------------------------------------------------------ walk-forward plan (calendar year, expanding window)
/** Test years = calendar years of the (cut) market calendar from the third one on. */
function testYearsOf(cal) {
  const years = Array.from(new Set(cal.map((d) => Number(d.slice(0, 4))))).sort((a, b) => a - b);
  return years.slice(2);
}
/** Non-overlapping test dates: global greedy over all eligible test-year panel dates (spacing >= h sessions, also across years). */
function selectTestRecords(panel, h, firstTestYear) {
  const elig = panel.filter((r) => r.year >= firstTestYear);
  const chosen = new Set(L.selectNonOverlapping(elig.map((r) => r.t), h));
  return elig.filter((r) => chosen.has(r.t));
}
/**
 * Fold plan for test year Y:
 *  y0 = first calendar session of Y; pool = panel dates t <= y0-1-h (embargo: last h sessions before Y excluded, so every target
 *  date <= cal[y0-1] = fold cutoff); first floor(0.8*D) pool dates -> training, the rest -> calibration candidates; the engine
 *  requires calibration asOf > trainedThrough (= last training target date), so candidates dated <= trainedThrough are purged.
 */
function planFold(ctx, panel, h, Y) {
  const y0 = ctx.cal.findIndex((d) => Number(d.slice(0, 4)) === Y);
  if (y0 <= 0) return {year: Y, ok: false, reason: 'no_sessions_before_year'};
  const foldCutoff = ctx.cal[y0 - 1];
  const pool = panel.filter((r) => r.t <= y0 - 1 - h);
  const D = pool.length;
  const nTrain = Math.floor(D * TRAIN_FRACTION);
  if (nTrain < 1 || D - nTrain < 1) return {year: Y, ok: false, reason: `pool_too_small_${D}_dates`, foldCutoff, poolDates: D};
  const train = pool.slice(0, nTrain), calibCand = pool.slice(nTrain);
  const trainedThrough = ctx.cal[train[train.length - 1].t + h];
  const calib = calibCand.filter((r) => r.date > trainedThrough);
  return {year: Y, ok: true, y0, foldCutoff, pool, train, calibCand, calib, trainedThrough, calibratedThrough: foldCutoff};
}

// ------------------------------------------------------------------ per-date evaluation
/** Top-q selection: nSel = floor(N*q) highest scores, ties broken by id (lexical) — ex-ante. */
function selectTop(scores, ids, q) {
  const nSel = L.exclusionCount(scores.filter(L.isNum).length, q);
  const neg = scores.map((s) => (L.isNum(s) ? -s : NaN));
  return L.selectExcluded(neg, ids, nSel).excluded; // lowest of -score = highest score
}
function evalTop(scores, ids, y, q) {
  const sel = selectTop(scores, ids, q);
  const base = L.mean(y), hit = L.mean(sel.map((i) => y[i]));
  return {N: y.length, nSel: sel.length, base, hit, lift: hit - base, sel};
}

// ------------------------------------------------------------------ statistics helpers
/** Lag-1 sample autocorrelation (standard ACF estimator). NaN if n < 3 or zero variance. */
function lag1Autocorr(x) {
  const n = x.length;
  if (n < 3) return NaN;
  const m = L.mean(x);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) den += (x[i] - m) ** 2;
  for (let i = 0; i < n - 1; i++) num += (x[i] - m) * (x[i + 1] - m);
  return den > 0 ? num / den : NaN;
}
/** AMEND-1: n_eff = n (1 - rho) / (1 + rho), rho clipped at >= 0 (no extra credit for negative autocorrelation). */
function nEff(n, rho) {
  if (!L.isNum(rho)) return null;
  const r = Math.max(0, rho);
  return n * (1 - r) / (1 + r);
}
const brier = (p, y) => L.mean(p.map((pi, i) => (pi - y[i]) ** 2));
function calibrationTable(p, y, mode) {
  const n = p.length;
  if (!n) return [];
  let edges;
  if (mode === 'equal_width') edges = [0, 0.2, 0.4, 0.6, 0.8, 1];
  else {
    const s = p.slice().sort((a, b) => a - b);
    edges = [s[0]];
    for (let k = 1; k < 5; k++) edges.push(s[Math.floor((k * n) / 5)]);
    edges.push(s[n - 1]);
  }
  const bins = Array.from({length: 5}, (_, k) => ({bin: k + 1, lo: edges[k], hi: edges[k + 1], ps: [], ys: []}));
  if (mode === 'equal_width') {
    for (let i = 0; i < n; i++) { const k = Math.min(4, Math.floor(p[i] / 0.2)); bins[k].ps.push(p[i]); bins[k].ys.push(y[i]); }
  } else {
    const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b] || a - b);
    idx.forEach((i, r) => { const k = Math.min(4, Math.floor((r * 5) / n)); bins[k].ps.push(p[i]); bins[k].ys.push(y[i]); });
  }
  return bins.map((b) => ({bin: b.bin, p_lo: rnd(b.lo, 4), p_hi: rnd(b.hi, 4), n: b.ps.length, mean_p: rnd(L.mean(b.ps), 4), observed_up_rate: rnd(L.mean(b.ys), 4)}));
}
function bsOut(b) { return {n: b.n, mean: rnd(b.mean), ci95: rndArr(b.ci95), p_one_sided_bootstrap: rnd(b.p_one_sided, 5)}; }

// ------------------------------------------------------------------ decision rules (protocol 8, applied mechanically)
/**
 * criteria (true/false/null): primary_ci_lower_gt_0, primary_permutation_p_lt_0_05, primary_bss_gt_0, lift_positive_in_ge_70pct_folds.
 * any false -> REJECTED; any null (not evaluable) -> INCONCLUSIVE; n_eff < 60 (or unknown) -> INCONCLUSIVE; else ELIGIBLE_SHADOW_RUN_ONLY.
 */
function decide({criteria, nEffPrimary, powerMin = POWER_MIN_N_EFF}) {
  const ent = Object.entries(criteria);
  const failed = ent.filter(([, v]) => v === false).map(([k]) => k);
  const unknown = ent.filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  if (failed.length) return {decision: 'REJECTED', reasons: failed.map((k) => `failed:${k}`)};
  if (unknown.length) return {decision: 'INCONCLUSIVE', reasons: unknown.map((k) => `not_evaluable:${k}`)};
  if (!(L.isNum(nEffPrimary) && nEffPrimary >= powerMin)) return {decision: 'INCONCLUSIVE', reasons: [`criteria_met_but_n_eff_${L.isNum(nEffPrimary) ? rnd(nEffPrimary, 2) : 'unknown'}_below_${powerMin}`]};
  return {decision: 'ELIGIBLE_SHADOW_RUN_ONLY', reasons: ['all_criteria_met_and_n_eff_ge_60: daily P(up) may be logged beside the original forecast in snapshots, never shown and never used; SHADOW-VALIDATED requires later forward data']};
}

// ------------------------------------------------------------------ one market x horizon
async function runMarketHorizon(ctx, mkt, h, B) {
  const E = await loadEngine();
  const panel = buildPanel(ctx, h);
  const years = testYearsOf(ctx.cal);
  const testRecs = years.length ? selectTestRecords(panel, h, years[0]) : [];
  const folds = [];
  const preds = []; // per selected test date: {date, year, ids, y, mom, p, pClim}
  for (const Y of years) {
    const recsY = testRecs.filter((r) => r.year === Y);
    const plan = planFold(ctx, panel, h, Y);
    const fold = {year: Y, n_test_dates: recsY.length, fold_cutoff: plan.foldCutoff || null, evaluable: false};
    if (!recsY.length) { fold.reason = 'no_test_dates'; folds.push(fold); continue; }
    if (!plan.ok) { fold.reason = plan.reason; folds.push(fold); continue; }
    const trainRows = engineRows(plan.train, mkt, h), calibRows = engineRows(plan.calib, mkt, h);
    // explicit embargo checks (the engine enforces its own as well)
    const maxTrainTarget = plan.train.reduce((a, r) => (r.targetDate > a ? r.targetDate : a), '');
    const maxCalibTarget = plan.calib.reduce((a, r) => (r.targetDate > a ? r.targetDate : a), '');
    if (maxTrainTarget > plan.foldCutoff || (maxCalibTarget && maxCalibTarget > plan.foldCutoff)) throw new Error(`embargo violated in fold ${mkt} h${h} ${Y}`);
    if (!(recsY[0].date > plan.foldCutoff)) throw new Error(`test date not after fold cutoff ${mkt} h${h} ${Y}`);
    Object.assign(fold, {
      train_dates: plan.train.length, train_rows: trainRows.length, train_first: plan.train[0].date, train_last_asof: plan.train[plan.train.length - 1].date,
      trained_through: plan.trainedThrough, max_train_target: maxTrainTarget,
      calib_candidate_dates: plan.calibCand.length, calib_dates_after_purge: plan.calib.length, calib_rows: calibRows.length,
      calib_first: plan.calib[0] ? plan.calib[0].date : null, max_calib_target: maxCalibTarget || null, calibrated_through: plan.calibratedThrough,
      first_test_date: recsY[0].date, last_test_date: recsY[recsY.length - 1].date,
    });
    let model, calib;
    try {
      model = E.trainDirection(trainRows, {market: engineMarket(mkt), horizon: h, cutoff: plan.trainedThrough, featureNames: FEATURES, version: `dir-0001/${mkt}/h${h}/${Y}`});
      calib = E.fitProbabilityCalibration(model, calibRows, {cutoff: plan.calibratedThrough});
    } catch (e) {
      fold.reason = `engine_error:${e.message}`;
      folds.push(fold);
      continue;
    }
    const poolY = plan.pool.flatMap((r) => r.y);
    const pClim = L.mean(poolY);
    fold.evaluable = true;
    fold.climatology_up_rate = rnd(pClim, 5);
    fold.model_weights = rndArr(model.weights, 6);
    fold.platt_weights = rndArr(calib.weights, 6);
    for (const r of recsY) {
      const p = r.x.map((f) => E.predictProbability(model, calib, f, r.date).probabilityUp);
      preds.push({date: r.date, year: Y, ids: r.ids, y: r.y, mom: r.mom, p, pClim});
    }
    folds.push(fold);
  }
  return {panelDates: panel.length, testYears: years, nTestDatesSelected: testRecs.length, folds, preds};
}

function analyzeCombo(mh, mkt, h, q, B) {
  const key = comboKey(mkt, h, q);
  const P = mh.preds, n = P.length;
  const ev = P.map((d) => evalTop(d.p, d.ids, d.y, q));
  const evM = P.map((d) => evalTop(d.mom, d.ids, d.y, q));
  const lift = ev.map((e) => e.lift), liftM = evM.map((e) => e.lift), diff = lift.map((x, i) => x - liftM[i]);
  // power first (declared before reading the lift): n, rho, n_eff
  const rho = lag1Autocorr(lift);
  const ne = nEff(n, rho);
  const blk = L.blockLength(Math.max(n, 1));
  const sets = n >= 5 ? L.makeBootIndexSets(n, B, blk, L.seededRng(SEED, `${key}|boot`)) : null;
  const S = (v) => (n >= 5 ? L.bootSummary(v, sets, B) : {n, mean: n ? L.mean(v) : NaN, ci95: [NaN, NaN], p_one_sided: NaN});
  const sL = S(lift.map(pts)), sM = S(liftM.map(pts)), sD = S(diff.map(pts));
  let perm = null, permM = null;
  if (n >= 5) {
    const ys = P.map((d) => d.y), nEx = ev.map((e) => e.N - e.nSel);
    const pr = L.permutationBaseline(ys, nEx, L.mean(lift), B, L.seededRng(SEED, `${key}|perm`));
    perm = {statistic: 'mean over dates of (hit of a uniformly random same-size selection - base rate)', observed_pts: rnd(pts(L.mean(lift))), null_mean_pts: rnd(pts(pr.null_mean)), null_sd_pts: rnd(pts(pr.null_sd)), p_one_sided: rnd(pr.p, 5), iterations: pr.B};
    const prM = L.permutationBaseline(ys, nEx, L.mean(liftM), B, L.seededRng(SEED, `${key}|perm_mom`));
    permM = {p_one_sided: rnd(prM.p, 5), iterations: prM.B};
  }
  // Brier (independent of q; pooled over every name on the selected test dates)
  const allP = P.flatMap((d) => d.p), allY = P.flatMap((d) => d.y), allC = P.flatMap((d) => d.y.map(() => d.pClim));
  const bM = brier(allP, allY), bC = brier(allC, allY);
  const perDateImp = P.map((d) => pts(brier(d.y.map(() => d.pClim), d.y) - brier(d.p, d.y)));
  const sImp = n >= 5 ? L.bootSummary(perDateImp, L.makeBootIndexSets(n, B, blk, L.seededRng(SEED, `${key}|boot_brier`)), B) : {n, mean: NaN, ci95: [NaN, NaN], p_one_sided: NaN};
  const sortedP = allP.slice().sort((a, b) => a - b);
  // folds
  const folds = mh.folds.map((f) => {
    const ix = P.map((d, i) => (d.year === f.year ? i : -1)).filter((i) => i >= 0);
    const o = {year: f.year, evaluable: f.evaluable && ix.length > 0, n_dates: ix.length};
    if (!o.evaluable) return Object.assign(o, {reason: f.reason || 'no_predictions', lift_positive: false});
    const ly = L.mean(ix.map((i) => lift[i]));
    const py = ix.flatMap((i) => P[i].p), yy = ix.flatMap((i) => P[i].y), cy = ix.flatMap((i) => P[i].y.map(() => P[i].pClim));
    const bm = brier(py, yy), bc = brier(cy, yy);
    return Object.assign(o, {
      base_rate_pct: rnd(pts(L.mean(ix.map((i) => ev[i].base)))), hit_top_pct: rnd(pts(L.mean(ix.map((i) => ev[i].hit)))),
      lift_pts: rnd(pts(ly)), lift_positive: ly > 0, mom126_5_lift_pts: rnd(pts(L.mean(ix.map((i) => liftM[i])))),
      brier_model: rnd(bm, 6), brier_climatology: rnd(bc, 6), bss: rnd(1 - bm / bc, 5),
    });
  });
  const posShare = folds.length ? folds.filter((f) => f.lift_positive).length / folds.length : null;
  return {
    out: {
      key, market: mkt, horizon: h, top_q: q,
      power: {n_nonoverlapping_dates: n, rho1_lift: rnd(rho, 5), rho1_clipped: L.isNum(rho) ? rnd(Math.max(0, rho), 5) : null, n_eff: rnd(ne, 2), power_min_n_eff: POWER_MIN_N_EFF, meets_power_min: L.isNum(ne) ? ne >= POWER_MIN_N_EFF : null},
      first_date: P[0] ? P[0].date : null, last_date: n ? P[n - 1].date : null, block_length: blk,
      names_per_date: {mean: rnd(L.mean(ev.map((e) => e.N)), 2), min: n ? Math.min(...ev.map((e) => e.N)) : null, max: n ? Math.max(...ev.map((e) => e.N)) : null},
      selected_per_date: {mean: rnd(L.mean(ev.map((e) => e.nSel)), 2), min: n ? Math.min(...ev.map((e) => e.nSel)) : null, max: n ? Math.max(...ev.map((e) => e.nSel)) : null},
      base_rate_pct: rnd(pts(L.mean(ev.map((e) => e.base)))),
      hit_top_pct: rnd(pts(L.mean(ev.map((e) => e.hit)))),
      lift_pts: bsOut(sL),
      permutation: perm,
      baseline_mom126_5: {hit_top_pct: rnd(pts(L.mean(evM.map((e) => e.hit)))), lift_pts: bsOut(sM), permutation_p_one_sided: permM ? permM.p_one_sided : null},
      model_minus_mom126_5_pts: bsOut(sD),
      brier: {
        n_obs: allP.length, model: rnd(bM, 6), climatology: rnd(bC, 6), bss: rnd(1 - bM / bC, 5),
        climatology_definition: 'per fold: up-rate of all pre-fold pool rows (train + calibration candidates), every target <= fold cutoff',
        per_date_improvement_pts: {mean: rnd(sImp.mean), ci95: rndArr(sImp.ci95)},
        p_hat_distribution: {min: rnd(sortedP[0], 4), p10: rnd(sortedP[Math.floor(0.1 * sortedP.length)], 4), median: rnd(L.median(sortedP), 4), p90: rnd(sortedP[Math.floor(0.9 * sortedP.length)], 4), max: rnd(sortedP[sortedP.length - 1], 4), sd: rnd(L.sd(sortedP), 5)},
      },
      calibration_equal_width: calibrationTable(allP, allY, 'equal_width'),
      calibration_quintiles: calibrationTable(allP, allY, 'quintile'),
      folds, folds_positive_share: rnd(posShare, 4),
    },
    internals: {n, ne, sL, perm, bss: 1 - bM / bC, posShare, evPerDate: P.map((d, i) => ({date: d.date, year: d.year, N: ev[i].N, n_sel: ev[i].nSel, base: rnd(ev[i].base, 4), hit: rnd(ev[i].hit, 4), lift: rnd(ev[i].lift, 4), mom_lift: rnd(liftM[i], 4)}))},
  };
}

// ------------------------------------------------------------------ implementation notes (declared before running)
const IMPLEMENTATION_NOTES = [
  {id: 'I01', topic: 'holdout cut', note_ar: 'القطع = determineDevCutoff من negsel-lib عبر applyDevCut في negsel-0002 (الأبكر بين تقويم السعودي والأمريكي والمدمج، آخر ⌈30%⌉ محجوز). تُحذف الصفوف بعد القطع قبل أي حساب ويُتحقق بـassertNoHoldout. الأهداف تتطلب t+h ≤ القطع (إقصاء طبيعي).'},
  {id: 'I02', topic: 'cleaning & universe', note_ar: 'نفس قواعد NEGSEL-0002 كاملة (cleanSeries، حراس الهوية، سلسلة نظيفة ≥ 260 جلسة، عتبة سيولة 0.25 من وسيط قيمة التداول للسوق من بيانات قبل سنة t، ≥ 20 سهماً مؤهلاً للتاريخ). البروتوكول ذكر «≥ 260 جلسة» فقط؛ القراءة الأكثر تحفظاً = تطبيق كون NEGSEL كما هو بما فيه السيولة والحد الأدنى 20.'},
  {id: 'I03', topic: 'adjclose / splits', note_ar: 'لا يوجد adjclose في الملفات، فاستُعمل close (معدّل للتجزئة ظاهرياً، غير معدّل للتوزيعات). لا توجد في negsel-lib قاعدة تجزئة صريحة، فأُضيف حارس محافظ: رفض أي سلسلة فيها نسبة إغلاق يومية ≥ 2 أو ≤ 0.5 (عتبة priceJumpMinRatio=2 من DESIGN-INSTRUMENT-SNAPSHOT). تجزئة 3:2 مثلاً لا تُكشف بهذه القاعدة (حدّ معلن).'},
  {id: 'I04', topic: 'features', note_ar: 'mom126_5 وtrend50_200 وmom252_21 من negsel-lib.featuresAt (لوغاريتمية: ln(SMA50/SMA200) بدل النسبة − 1؛ الرتبة لا تتغير لأن التحويل رتيب). rev5 = ln(c[t]/c[t−5])؛ vol63 = الانحراف المعياري العيّني لـ63 عائداً يومياً لوغاريتمياً حتى t. الرتبة المقطعية لكل تاريخ لكل سوق على الأسهم المؤهلة عند t: rankNormalized − 0.5 ∈ [−0.5, 0.5] (رتب متوسطة للتعادل).'},
  {id: 'I05', topic: 'target', note_ar: 'actualUp = 1 إذا close[t+h]/close[t] − 1 > 0 (العائد الصفري = 0)، h بجلسات تقويم السوق؛ الإغلاق الغائب عند t+h = آخر إغلاق عنده أو قبله (كما NEGSEL).'},
  {id: 'I06', topic: 'folds', note_ar: 'سنوات الاختبار = السنوات التقويمية في تقويم السوق بعد القطع بدءاً من الثالثة (2019 جزئية = الأولى). مجمّع التدريب = كل تواريخ اللوحة t ≤ y0−1−h (y0 أول جلسة في السنة Y)، فكل هدف تدريب ≤ cal[y0−1] = قطع الطية. التقسيم 80/20 على التواريخ (لا على الصفوف) حتى لا ينقسم تاريخ واحد.'},
  {id: 'I07', topic: 'train/calibration gap', note_ar: 'المحرّك يشترط أن يكون asOf لكل صف معايرة > trainedThrough (= تاريخ آخر هدف تدريب). لذا تُحذف من الـ20% مرشحات المعايرة المؤرخة ≤ trainedThrough (فجوة h جلسة فعلياً). calibratedThrough = قطع الطية. يُسجَّل عدد التواريخ قبل وبعد الحذف لكل طية.'},
  {id: 'I08', topic: 'non-overlap', note_ar: 'تواريخ الاختبار: انتقاء جشع عالمي على كل تواريخ سنوات الاختبار المؤهلة (تباعد ≥ h جلسة حتى عبر حدود السنوات)، ثم تُوزَّع على الطيات حسب سنة t. الأكثر تحفظاً من إعادة البدء كل سنة.'},
  {id: 'I09', topic: 'top-q', note_ar: 'عدد المختارين = ⌊N×q⌋ (حساب صحيح كما NEGSEL)؛ أعلى P̂، والتعادل يُكسر بترتيب الرمز. خط mom126_5 = أعلى ⌊N×q⌋ بحسب القيمة الخام لـmom126_5 (تكافئ الرتبة). lift لكل تاريخ = إصابة المختارين − نسبة صعود كل المؤهلين في نفس التاريخ؛ المتوسط عبر التواريخ.'},
  {id: 'I10', topic: 'bootstrap', note_ar: 'Bootstrap بكتل دائرية على تواريخ الاختبار غير المتداخلة، طول الكتلة ⌈n^(1/3)⌉ (لم يحدده البروتوكول؛ كما NEGSEL)، 2000 إعادة، فترة 95% بالمئينات، نفس مجموعات الفهارس لـlift النموذج وlift الزخم والفرق.'},
  {id: 'I11', topic: 'permutation', note_ar: 'لكل تاريخ اختيار عشوائي منتظم بنفس الحجم ⌊N×q⌋، مستقل بين التواريخ، 2000 تكرار (permutationBaseline من negsel-lib مع fwd = actualUp). p أحادي = (1+#{null ≥ observed})/(B+1)؛ التعادلات تُحسب ضد الفرضية (محافظ مع بيانات 0/1).'},
  {id: 'I12', topic: 'n_eff', note_ar: 'n_eff = n×(1−ρ̂)/(1+ρ̂) حيث ρ̂ = الارتباط الذاتي العيّني من الدرجة الأولى لسلسلة lift لكل تاريخ غير متداخل (للتركيبة نفسها)، مقصوص عند ≥ 0 (AMEND-1).'},
  {id: 'I13', topic: 'Brier & climatology', note_ar: 'Brier مجمّع على كل الأسهم في تواريخ الاختبار المختارة (مستقل عن q). المناخ لكل طية = نسبة الصعود في كل صفوف مجمّع ما قبل الطية (تدريب + مرشحات المعايرة)، وكلها أهدافها ≤ قطع الطية. BSS = 1 − Brier_model/Brier_clim. القرار يستعمل BSS المجمّع للأساسي > 0 (قيمة نقطية؛ البروتوكول لا يطلب فترة ثقة له)، وتُعرض فترة ثقة لتحسّن Brier لكل تاريخ للإفصاح فقط.'},
  {id: 'I14', topic: 'calibration table', note_ar: '«5 شرائح احتمال» غامضة: الجدول الأساسي = شرائح متساوية العرض [0,0.2,…,1]؛ ويُضاف جدول خُمسيات متساوية العدد للإفصاح لأن الاحتمالات منضغطة قرب 0.5 (نمط الفشل 6). لا يدخل أي منهما القرار.'},
  {id: 'I15', topic: 'fold sign rule', note_ar: 'حصة الطيات الموجبة = عدد الطيات ذات متوسط lift > 0 ÷ كل سنوات الاختبار؛ الطية غير القابلة للتقييم (لا تدريب/معايرة ممكن أو بلا تواريخ) تُحسب غير موجبة (محافظ). الشرط ≥ 70%.'},
  {id: 'I16', topic: 'secondary & Holm', note_ar: 'الثانوية حسب البروتوكول = 3 تركيبات عند top_q=0.2: السعودي h21، الأمريكي h5، الأمريكي h21. p لكل منها = p التبديل الأحادي؛ Holm على الثلاث؛ «دال» = p بعد Holm < 0.05 والحد الأدنى لفترة الثقة > 0. يُعرض Holm تكميلي على كل التركيبات الـ11 غير الأساسية (حساسية فقط). q=0.1 و0.3 حساسية فقط ولا تدخل القرار.'},
  {id: 'I17', topic: 'decision', note_ar: 'جدول البند 8 حرفياً: أي من (CI>0، p<0.05، BSS>0، ≥70% طيات موجبة) فاشل → REJECTED؛ معيار غير قابل للتقييم → INCONCLUSIVE؛ n_eff < 60 → INCONCLUSIVE؛ وإلا ELIGIBLE_SHADOW_RUN_ONLY (تسجيل P̂ ظلياً فقط). لا تغيير على forecasts() أو الواجهة في أي حالة. سقف الحالة SHADOW-VALIDATED.'},
  {id: 'I18', topic: 'three-category split', note_ar: 'توزيع صاعد/محايد/هابط من P̂ (حساسية) غير محسوب: البروتوكول لم يعلن عتبات الفئات، واختيارها بعد رؤية P̂ ضبطٌ على النتائج.'},
  {id: 'I19', topic: 'engine path', note_ar: 'البروتوكول يذكر research/aziz/src/probability.mjs؛ الملف الفعلي في المستودع mizan-v45/research/aziz/src/probability.mjs، مستورد دون تعديل بالإعدادات الافتراضية (لا يُمرَّر optimizer).'},
  {id: 'I20', topic: 'old metric', note_ar: 'المقياس القديم (إصابة forecasts() على غير المحايد وتغطيته) يُحسب بسكربت منفصل dir-0001-legacy.mts (يتطلب tsx لأن المحرك TypeScript) على نفس أزواج (سهم، تاريخ) في تواريخ الاختبار، بسلسلة السهم حتى t فقط من البيانات المقطوعة، دون سياق سوق/قطاع/أخبار (كما run-forecast-replay). يُضاف تحت legacy_metric.'},
];

// ------------------------------------------------------------------ main entry
async function runDev(inputSeries, opts = {}) {
  const B = opts.B || B_DEFAULT;
  const input = inputSeries.slice().sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  const rowsBefore = {sa: 0, us: 0};
  for (const s of input) rowsBefore[marketOf(s.symbol)] += (s.rows || []).length;

  // 1) cut FIRST
  const {cutoff, perCalendar, cut} = NS.applyDevCut(input);
  NS.assertNoHoldout(cut, cutoff);
  const rowsAfter = {sa: 0, us: 0};
  for (const s of cut) rowsAfter[marketOf(s.symbol)] += s.rows.length;

  // 2) contexts
  const ctxs = {};
  for (const m of MARKETS) ctxs[m] = buildContext(m, cut.filter((x) => marketOf(x.symbol) === m));
  for (const m of MARKETS) if (ctxs[m].cal.length && ctxs[m].cal[ctxs[m].cal.length - 1] > cutoff) throw new Error('calendar beyond cutoff');

  // 3) market x horizon runs, then combos
  const mhs = {}, combos = [], internals = {};
  for (const m of MARKETS) for (const h of HS) {
    const mh = await runMarketHorizon(ctxs[m], m, h, B);
    mhs[`${m}|h${h}`] = mh;
    for (const q of QS) {
      const r = analyzeCombo(mh, m, h, q, B);
      combos.push(r.out);
      internals[r.out.key] = r.internals;
    }
  }

  // 4) primary
  const pKey = comboKey(PRIMARY.market, PRIMARY.h, PRIMARY.q);
  const PO = combos.find((c) => c.key === pKey), PI = internals[pKey];
  const criteria = {
    primary_ci_lower_gt_0: PI.n >= 5 ? PI.sL.ci95[0] > 0 : null,
    primary_permutation_p_lt_0_05: PI.perm ? PI.perm.p_one_sided < 0.05 : null,
    primary_bss_gt_0: L.isNum(PI.bss) ? PI.bss > 0 : null,
    lift_positive_in_ge_70pct_folds: PI.posShare === null ? null : PI.posShare >= FOLD_POSITIVE_MIN,
  };
  const dec = decide({criteria, nEffPrimary: PI.ne});

  // 5) secondary (Holm over the 3 protocol secondaries) + supplementary Holm over all 11 non-primary
  const pOf = (k) => (internals[k].perm ? internals[k].perm.p_one_sided : 1);
  const secKeys = SECONDARY.map((s) => comboKey(s.market, s.h, s.q));
  const secAdj = L.holm(secKeys.map(pOf));
  const secondary = secKeys.map((k, i) => {
    const c = combos.find((x) => x.key === k);
    return {key: k, n_dates: c.power.n_nonoverlapping_dates, n_eff: c.power.n_eff, lift_pts: c.lift_pts.mean, ci95: c.lift_pts.ci95, permutation_p: rnd(pOf(k), 5), p_holm: rnd(secAdj[i], 5), bss: c.brier.bss, folds_positive_share: c.folds_positive_share,
      significant_after_holm: secAdj[i] < 0.05 && c.lift_pts.ci95[0] > 0};
  });
  const allKeys = combos.map((c) => c.key).filter((k) => k !== pKey);
  const allAdj = L.holm(allKeys.map(pOf));
  const supplementary = allKeys.map((k, i) => ({key: k, permutation_p: rnd(pOf(k), 5), p_holm_11: rnd(allAdj[i], 5)}));

  // 6) provenance
  const perMarket = {};
  for (const m of MARKETS) {
    const c = ctxs[m];
    perMarket[m] = {
      n_symbols_input: input.filter((x) => marketOf(x.symbol) === m).length,
      symbols_input: input.filter((x) => marketOf(x.symbol) === m).map((x) => x.symbol),
      n_symbols_accepted: c.syms.length,
      identity_rejected: c.rejections, split_guard_rejected: c.splitRejected,
      rows_before_cut: rowsBefore[m], rows_after_cut: rowsAfter[m], rows_removed_by_cut: rowsBefore[m] - rowsAfter[m],
      dev_calendar: {n_dates: c.cal.length, first: c.cal[0] || null, last: c.cal[c.cal.length - 1] || null},
      test_years: testYearsOf(c.cal),
      horizons: Object.fromEntries(HS.map((h) => { const mh = mhs[`${m}|h${h}`]; return [`h${h}`, {panel_dates: mh.panelDates, test_dates_selected: mh.nTestDatesSelected, test_dates_predicted: mh.preds.length, folds: mh.folds}]; })),
    };
  }

  return {
    experiment: 'DIR-0001', phase: 'development_only_shadow', holdout_opened: false,
    code_status: 'CODE-TESTED (unit tests are not predictive evidence)',
    protocol: {file: 'research/PROTOCOL-DIR-0001.md', frozen_commit: PROTOCOL_COMMIT_FROZEN, commit_found: opts.protocolCommit || null, sha256: opts.protocolSha256 || null, file_matches_frozen_commit: opts.protocolMatches === undefined ? null : opts.protocolMatches},
    engine: {file: 'mizan-v45/research/aziz/src/probability.mjs', sha256: opts.engineSha256 || null, optimizer: 'engine defaults (600 iterations, lr 0.1, reg 0.01)', calibration: 'Platt (fitProbabilityCalibration)', minSamples: 30},
    seed: SEED, bootstrap_resamples: B, permutation_iterations: B,
    dev_cutoff: {date: cutoff, rule: 'NEGSEL-0002 determineDevCutoff: dev = n - ceil(0.3 n) dates; earliest of SA / US / union calendar cutoffs', per_calendar: perCalendar},
    data: {n_files: input.length, rows_removed_by_cut_total: (rowsBefore.sa + rowsBefore.us) - (rowsAfter.sa + rowsAfter.us), markets: perMarket},
    parameters: {features: FEATURES, horizons: HS, top_q: QS, primary: PRIMARY, secondary: SECONDARY, train_fraction: TRAIN_FRACTION, min_history_sessions: MIN_HISTORY, min_universe: MIN_UNIVERSE, liq_fraction: NS.CONSTANTS.LIQ_FRAC, power_min_n_eff: POWER_MIN_N_EFF, folds_positive_min: FOLD_POSITIVE_MIN, split_jump_ratio: SPLIT_JUMP_RATIO},
    primary_test: {
      key: pKey, power: PO.power, base_rate_pct: PO.base_rate_pct, hit_top_pct: PO.hit_top_pct, lift_pts: PO.lift_pts, permutation: PO.permutation,
      brier: PO.brier, folds: PO.folds, folds_positive_share: PO.folds_positive_share,
      baseline_mom126_5: PO.baseline_mom126_5, model_minus_mom126_5_pts: PO.model_minus_mom126_5_pts,
      criteria, per_date: PI.evPerDate,
    },
    secondary_tests: {family: 'protocol secondaries at top_q=0.2, Holm on one-sided permutation p', tests: secondary},
    supplementary_holm_all_non_primary: supplementary,
    results: combos,
    decision: {decision: dec.decision, reasons: dec.reasons, criteria, n_eff_primary: rnd(PI.ne, 2), power_min_n_eff: POWER_MIN_N_EFF, status_ceiling: 'SHADOW-VALIDATED', forecasts_unchanged: true, note: 'development sample only; no change to forecasts() or the UI in any case'},
    implementation_notes: IMPLEMENTATION_NOTES,
  };
}

module.exports = {
  runDev, buildContext, buildPanel, universeAt, engineRows, testYearsOf, selectTestRecords, planFold,
  extraFeaturesAt, featuresAllAt, allFinite, rankScaled, detectUnadjustedSplits, selectTop, evalTop,
  lag1Autocorr, nEff, brier, calibrationTable, decide, loadEngine,
  SEED, CONSTANTS: {MARKETS, HS, QS, PRIMARY, SECONDARY, B_DEFAULT, POWER_MIN_N_EFF, FOLD_POSITIVE_MIN, TRAIN_FRACTION, FEATURES, MIN_HISTORY, MIN_UNIVERSE, PROTOCOL_COMMIT_FROZEN},
};

// ------------------------------------------------------------------ CLI
if (require.main === module) {
  (async () => {
    const [, , dir, outArg] = process.argv;
    if (!dir) { console.error('usage: node dir-0001.cjs <prices-dir> [out.json]'); process.exit(2); }
    const series = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    const root = path.join(__dirname, '..', '..');
    const protoPath = path.join(__dirname, '..', 'PROTOCOL-DIR-0001.md');
    const sha = crypto.createHash('sha256').update(fs.readFileSync(protoPath)).digest('hex');
    const engineSha = crypto.createHash('sha256').update(fs.readFileSync(ENGINE_PATH)).digest('hex');
    let commit = null, matches = null;
    const cp = require('child_process');
    try { commit = cp.execSync('git log -1 --format=%H -- research/PROTOCOL-DIR-0001.md', {cwd: root, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim() || null; } catch (e) { commit = null; }
    try { cp.execSync(`git diff --quiet ${PROTOCOL_COMMIT_FROZEN} -- research/PROTOCOL-DIR-0001.md`, {cwd: root, stdio: 'ignore'}); matches = true; } catch (e) { matches = false; }
    const res = await runDev(series, {protocolSha256: sha, protocolCommit: commit, protocolMatches: matches, engineSha256: engineSha});
    const out = outArg || path.join(__dirname, '..', 'results', 'DIR-0001-dev.json');
    fs.mkdirSync(path.dirname(out), {recursive: true});
    fs.writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
    const p = res.primary_test;
    console.log(JSON.stringify({out, dev_cutoff: res.dev_cutoff.date, primary: {n: p.power.n_nonoverlapping_dates, n_eff: p.power.n_eff, lift_pts: p.lift_pts, perm_p: p.permutation && p.permutation.p_one_sided, bss: p.brier.bss, folds: p.folds.map((f) => [f.year, f.lift_pts]), folds_positive_share: p.folds_positive_share}, decision: res.decision}, null, 1));
  })().catch((e) => { console.error(e); process.exit(1); });
}

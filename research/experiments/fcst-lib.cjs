'use strict';
/**
 * fcst-lib.cjs — pure helpers for PROTOCOL-FCST-0001 (forecast-centre evaluation).
 * No I/O, no Math.random, no Date.now. Deterministic given inputs. CODE-TESTED only (see __tests__/fcst-0001.test.cjs);
 * tests are NOT predictive evidence.
 */
const N = require('./negsel-lib.cjs');
const {isNum, mean, sd} = N;

const DEV_CUTOFF = '2024-09-04';           // NEGSEL-0002 dev cutoff; rows after it are physically removed before any computation
const WARMUP = 504;                         // sessions of history before the first origin (as run-forecast-replay.cjs)
const STEP = 5;                             // origin spacing in sessions
const HORIZONS = [1, 5, 21, 63, 126, 252];
const PRIMARY_H = 5;
const FOLDS = [                             // test blocks by ORIGIN date; label must also be realised <= DEV_CUTOFF
  {id: '2022H2', start: '2022-07-01', end: '2022-12-31'},
  {id: '2023H1', start: '2023-01-01', end: '2023-06-30'},
  {id: '2023H2', start: '2023-07-01', end: '2023-12-31'},
  {id: '2024H1', start: '2024-01-01', end: DEV_CUTOFF},
];
const DESIGN_END = '2022-06-30';            // design window: label realised <= this date; never part of any test fold
const RIDGE_LAMBDA_PER_N = 1;               // lambda = RIDGE_LAMBDA_PER_N * n_train (fixed in the protocol, never tuned)
const NEUTRAL_PCT = (h) => (h === 1 ? 0.1 : h <= 5 ? 0.25 : 0.5);   // the engine's own display thresholds (research-model.ts)
const ALPHA_INTERVAL = 0.2;                 // nominal 80% central interval (10th–90th percentile)
const Q_LO = 0.1, Q_HI = 0.9;
const BOOT_B = 2000, BOOT_SEED = 2026102701;
const DELTA_REL_MAE = 0.01;                 // practical threshold: >= 1% relative reduction of normalised MAE
const MIN_N_EFF = 60;                       // owner's operational floor (AMEND-1), not a power guarantee
const MIN_FOLD_SHARE = 0.7;

// ------------------------------------------------------------------ series / features / sigma (all use rows <= i only)
function logRet(c, i) { return Math.log(c[i] / c[i - 1]); }
/** Sample std of the 63 daily log returns ending at i (point-in-time). */
function sigma63(c, i) {
  if (i < 63) return NaN;
  const r = [];
  for (let k = i - 62; k <= i; k++) r.push(logRet(c, k));
  return sd(r);
}
/** Features of the frozen set (mom126_5, trend50_200, mom252_21) at i; NaN-bearing object if history is insufficient. */
function featureVector(c, i) {
  const f = N.featuresAt(c, i);
  return [f.mom126_5, f.trend50_200, f.mom252_21];
}
const featsFinite = (x) => x.length === 3 && x.every(isNum);

// ------------------------------------------------------------------ ridge (intercept not penalised)
/** Solve A x = b by Gaussian elimination with partial pivoting; A is p x p. Returns null if singular. */
function solve(A, b) {
  const p = b.length, M = A.map((r, i) => r.slice().concat([b[i]]));
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < p; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(p).fill(0);
  for (let r = p - 1; r >= 0; r--) {
    let s = M[r][p];
    for (let k = r + 1; k < p; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}
/**
 * Fit z ~ a + x.beta with ridge penalty lambda on standardised features.
 * X: array of feature vectors (training only), z: standardised targets. Returns {mu, sdv, beta, a, n} or null.
 */
function fitRidge(X, z, lambda) {
  const n = X.length;
  if (n < 30) return null;
  const p = X[0].length, mu = new Array(p).fill(0), sdv = new Array(p).fill(0);
  for (let j = 0; j < p; j++) { mu[j] = mean(X.map((r) => r[j])); sdv[j] = sd(X.map((r) => r[j])); if (!(sdv[j] > 1e-12)) return null; }
  const Xs = X.map((r) => r.map((v, j) => (v - mu[j]) / sdv[j]));
  const zbar = mean(z), zc = z.map((v) => v - zbar);
  const A = Array.from({length: p}, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) { b[j] += Xs[i][j] * zc[i]; for (let k = 0; k < p; k++) A[j][k] += Xs[i][j] * Xs[i][k]; }
  for (let j = 0; j < p; j++) A[j][j] += lambda;
  const beta = solve(A, b);
  if (!beta) return null;
  return {mu, sdv, beta, a: zbar, n};
}
function predictRidge(model, x) {
  let s = model.a;
  for (let j = 0; j < x.length; j++) s += model.beta[j] * ((x[j] - model.mu[j]) / model.sdv[j]);
  return s;
}
/** Empirical quantile with linear interpolation (type 7). */
function quantile(a, q) {
  const b = Array.from(a).filter(isNum).sort((x, y) => x - y), n = b.length;
  if (!n) return NaN;
  const pos = (n - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return b[lo] + (b[hi] - b[lo]) * (pos - lo);
}

// ------------------------------------------------------------------ metrics (all in sigma*sqrt(h) units unless stated)
const scale = (sigma, h) => sigma * Math.sqrt(h);
const nae = (y, yhat, sigma, h) => Math.abs(y - yhat) / scale(sigma, h);
const nse = (y, yhat, sigma, h) => ((y - yhat) / scale(sigma, h)) ** 2;
/** Winkler interval score in log space, normalised: width + (2/alpha) * shortfall. */
function intervalScore(y, lo, hi, sigma, h, alpha = ALPHA_INTERVAL) {
  const s = scale(sigma, h);
  let v = hi - lo;
  if (y < lo) v += (2 / alpha) * (lo - y); else if (y > hi) v += (2 / alpha) * (y - hi);
  return v / s;
}
/** Display direction from a forecast log return using the engine's own neutral thresholds (percent of price). */
function directionOfLog(yhat, h) {
  const pct = 100 * (Math.exp(yhat) - 1), thr = NEUTRAL_PCT(h);
  return Math.abs(pct) < thr ? 0 : pct > 0 ? 1 : -1;
}
function wilson(k, n, z = 1.96) {
  if (!n) return [NaN, NaN];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

// ------------------------------------------------------------------ inference over origin DATES
/** Group per-record values by date and average (cross-sectional dependence: one observation per date). */
function perDateMeans(records, valueFn) {
  const m = new Map();
  for (const r of records) {
    const v = valueFn(r);
    if (!isNum(v)) continue;
    const e = m.get(r.date) || {s: 0, n: 0};
    e.s += v; e.n++; m.set(r.date, e);
  }
  const dates = Array.from(m.keys()).sort();
  return {dates, values: dates.map((d) => m.get(d).s / m.get(d).n)};
}
/** Lag-1 autocorrelation clipped at >= 0 (no extra credit for negative dependence), as in AMEND-1. */
function rho1(v) {
  const n = v.length;
  if (n < 4) return 0;
  const m = mean(v);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { den += (v[i] - m) ** 2; if (i) num += (v[i] - m) * (v[i - 1] - m); }
  return den > 0 ? Math.max(0, num / den) : 0;
}
/** Effective independent observations: non-overlapping count adjusted by AR(1). dates are ORIGIN dates spaced STEP sessions. */
function effectiveN(nDates, h, rho) {
  const nonOverlap = Math.max(0, Math.floor((nDates * STEP) / Math.max(h, STEP)));
  return nonOverlap * (1 - rho) / (1 + rho);
}
/** Circular block bootstrap of the mean of a date-ordered series. Block >= ceil(h/STEP) so overlapping targets stay together. */
function bootstrapMean(values, h, seedKey) {
  const n = values.length;
  if (n < 5) return {n, mean: n ? mean(values) : NaN, ci95: [NaN, NaN], pBetter: NaN, L: NaN};
  const L = Math.max(N.blockLength(n), Math.ceil(h / STEP));
  const rng = N.seededRng(BOOT_SEED, seedKey);
  const sets = N.makeBootIndexSets(n, BOOT_B, L, rng);
  const means = N.bootMeans(values, sets, BOOT_B);
  // one-sided p for H1: mean < 0 (the model's error is smaller). Null imposed by centring, (1+#)/(B+1).
  const obs = mean(values);
  let c = 0;
  for (let b = 0; b < means.length; b++) if (means[b] - obs <= obs) c++;
  return {n, mean: obs, ci95: N.percentileCI(means), pBetter: (1 + c) / (means.length + 1), L};
}

module.exports = {
  DEV_CUTOFF, WARMUP, STEP, HORIZONS, PRIMARY_H, FOLDS, DESIGN_END, RIDGE_LAMBDA_PER_N, NEUTRAL_PCT, ALPHA_INTERVAL, Q_LO, Q_HI,
  BOOT_B, BOOT_SEED, DELTA_REL_MAE, MIN_N_EFF, MIN_FOLD_SHARE,
  logRet, sigma63, featureVector, featsFinite, solve, fitRidge, predictRidge, quantile,
  scale, nae, nse, intervalScore, directionOfLog, wilson, perDateMeans, rho1, effectiveN, bootstrapMean,
};

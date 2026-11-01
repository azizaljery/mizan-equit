// FCST-0005 research module (NOT imported by production). Pure functions, deterministic, no clock, no Math.random.
// Estimand: conditional MEDIAN of y = ln(C[t+h]/C[t]); trained with pinball(tau=.5) on z = y/S, S = sigma63*sqrt(h);
// the acceptance metric NAE = |y - yhat|/S = |z - zhat| is the SAME loss (see PROTOCOL-FCST-0005 section 2).
export const KAPPA = 0.5;                       // fixed shrinkage, never tuned
export const HORIZONS = [1, 5, 21, 63, 126, 252];
export const DELTA = 0.01;                      // practical improvement (relative NAE reduction), never lowered

// ---------- point-in-time inputs (only prices up to index t are read) ----------
export function sigma63(closes, t) {
  if (t < 63) return null;
  const r = []; for (let i = t - 62; i <= t; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
}
const sma = (c, t, n) => { let s = 0; for (let i = t - n + 1; i <= t; i++) s += c[i]; return s / n; };
/** Frozen feature bundle @negsel-v1: mom126_5, trend50_200, mom252_21. Null until 252 sessions exist. */
export function features(closes, t) {
  if (t < 252) return null;
  return [Math.log(closes[t - 5] / closes[t - 126]), Math.log(sma(closes, t, 50) / sma(closes, t, 200)), Math.log(closes[t - 21] / closes[t - 252])];
}

// ---------- weighted median and deterministic LAD ----------
export function weightedMedian(v, w) {
  const idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b] || a - b);
  const tot = w.reduce((a, b) => a + b, 0); let acc = 0;
  for (const i of idx) { acc += w[i]; if (acc >= tot / 2) return v[i]; }
  return v[idx[idx.length - 1]];
}
function solve(A, b) { // Gaussian elimination with partial pivoting, small systems
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-14) M[c][c] = 1e-14;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k]; x[i] = s / M[i][i]; }
  return x;
}
function wls(X, y, w) {
  const p = X[0].length, A = Array.from({ length: p }, () => Array(p).fill(0)), b = Array(p).fill(0);
  X.forEach((x, i) => { for (let a = 0; a < p; a++) { b[a] += w[i] * x[a] * y[i]; for (let c = 0; c < p; c++) A[a][c] += w[i] * x[a] * x[c]; } });
  return solve(A, b);
}
/** LAD by IRLS: eps=1e-6, 200 iterations, start from least squares. X rows already include the intercept column. */
export function lad(X, y, w, { eps = 1e-6, iters = 200 } = {}) {
  let beta = wls(X, y, w);
  for (let it = 0; it < iters; it++) {
    const rw = X.map((x, i) => w[i] / Math.max(eps, Math.abs(y[i] - x.reduce((s, v, k) => s + v * beta[k], 0))));
    beta = wls(X, y, rw);
  }
  return beta;
}
export const pinballHalf = (z, zhat, w) => z.reduce((s, v, i) => s + w[i] * Math.abs(v - zhat[i]), 0) / w.reduce((a, b) => a + b, 0);

// ---------- candidates (all predict zhat; yhat = S * zhat) ----------
export function fitQ0(z, w, kappa = KAPPA) { const m = weightedMedian(z, w); return { predict: () => kappa * m, median: m }; }
function standardiser(X, w) {
  const p = X[0].length, tot = w.reduce((a, b) => a + b, 0), mu = Array(p).fill(0), sd = Array(p).fill(0);
  X.forEach((x, i) => x.forEach((v, k) => { mu[k] += w[i] * v / tot; }));
  X.forEach((x, i) => x.forEach((v, k) => { sd[k] += w[i] * (v - mu[k]) ** 2 / tot; }));
  return { mu, sd: sd.map(v => Math.sqrt(v) || 1) };
}
export function fitQ1(X, z, w, kappa = KAPPA) {
  const st = standardiser(X, w), Z = X.map(x => [1, ...x.map((v, k) => (v - st.mu[k]) / st.sd[k])]);
  const beta = lad(Z, z, w);
  return { beta, standardiser: st, predict: x => kappa * beta.reduce((s, b, k) => s + b * (k === 0 ? 1 : (x[k - 1] - st.mu[k - 1]) / st.sd[k - 1]), 0) };
}
/** Q2: one coefficient set shared by all horizons: z_h ~ sqrt(h)*(a + b.x). rows: {h,z,x,w}. */
export function fitQ2(rows, kappa = KAPPA) {
  const st = standardiser(rows.map(r => r.x), rows.map(r => r.w));
  const Z = rows.map(r => [1, ...r.x.map((v, k) => (v - st.mu[k]) / st.sd[k])]);
  // |z - sqrt(h) f| = sqrt(h) |z/sqrt(h) - f|  ->  LAD on z/sqrt(h) with weight w*sqrt(h)
  const beta = lad(Z, rows.map(r => r.z / Math.sqrt(r.h)), rows.map(r => r.w * Math.sqrt(r.h)));
  return { beta, predict: (x, h) => kappa * Math.sqrt(h) * beta.reduce((s, b, k) => s + b * (k === 0 ? 1 : (x[k - 1] - st.mu[k - 1]) / st.sd[k - 1]), 0) };
}

// ---------- evaluation arithmetic ----------
export const nae = (y, yhat, S) => Math.abs(y - yhat) / S;
export const relReduction = (maeCand, maeRef) => 1 - maeCand / maeRef;
export function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Circular block bootstrap CI of the mean of a series (the per-date paired difference d_t). Deterministic given the seed. */
export function blockBootstrapCI(d, block, B, seed, level = 0.95) {
  const n = d.length, rnd = mulberry32(seed), means = [];
  for (let b = 0; b < B; b++) { let s = 0, c = 0; while (c < n) { const st = Math.floor(rnd() * n); for (let k = 0; k < block && c < n; k++, c++) s += d[(st + k) % n]; } means.push(s / n); }
  means.sort((a, b) => a - b); const lo = means[Math.floor((1 - level) / 2 * (B - 1))], hi = means[Math.ceil((1 + level) / 2 * (B - 1))];
  return { lo, hi, mean: d.reduce((a, b) => a + b, 0) / n };
}
export function normInv(p) { // Acklam's rational approximation
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239], b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1],
    c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) return -normInv(1 - p);
  q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
/** Testability of a (market, horizon) cell from TRAINING data only: n_no >= 60 and delta_min <= delta. */
export function testability({ nNoOverlap, sigmaLR, maeRef, nDates, m = 36, alpha = 0.05, power = 0.8, delta = DELTA }) {
  const mult = normInv(1 - alpha / m) + normInv(power);
  const deltaMin = Number.isFinite(sigmaLR) && sigmaLR > 0 ? mult * sigmaLR / (Math.sqrt(nDates) * maeRef) : Infinity;
  return { multiplier: mult, deltaMin, testable: nNoOverlap >= 60 && deltaMin <= delta };
}
/** Number of non-overlapping target periods that a calendar of `sessions` sessions offers for horizon h. */
export const nonOverlapping = (sessions, h) => Math.floor(sessions / h);
/** Fewest sessions a trainable cell needs: 30 non-overlapping training periods (draft rule) plus the 252-session feature warm-up. */
export const minTrainSessions = h => 252 + 30 * h;

// ---------- per-horizon decision (independent per horizon) ----------
/** Returns 'proven' | 'undecided' | 'rejected'. `cleanData` must be true for 'proven': exposed windows can only reject or leave undecided. */
export function decideHorizon({ testable, cleanData, holmP, relImprovement, ciUpper, ciLower, stableOk, controlsOk, delta = DELTA }) {
  if (!testable) return { status: 'undecided', reason: 'not-testable' };
  if (controlsOk === false) return { status: 'undecided', reason: 'control-failed' };
  // rejected: the interval says the improvement cannot reach the practical size (upper bound of improvement < delta)
  if (Number.isFinite(ciLower) && -ciLower < delta) return { status: 'rejected', reason: 'improvement-below-delta' };
  const proven = holmP <= 0.05 && ciUpper < 0 && relImprovement >= delta && stableOk === true;
  if (proven && !cleanData) return { status: 'undecided', reason: 'exposed-data-cannot-prove' };
  return proven ? { status: 'proven', reason: 'all-criteria' } : { status: 'undecided', reason: 'criteria-not-met' };
}
/** Display rule: only a proven horizon may show a forecast PRICE as approved; every other horizon shows the current price + an uncalibrated range label. */
export function displayStatus(decision) {
  return decision?.status === 'proven' ? { showApprovedPrice: true, label: 'معتمد' } : { showApprovedPrice: false, label: decision?.status === 'rejected' ? 'مرفوض' : 'غير معتمد' };
}

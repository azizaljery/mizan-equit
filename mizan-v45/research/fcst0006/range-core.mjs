// FCST-0006 range experiment: pure, deterministic building blocks. All constants are fixed in advance (FCST-0006-RANGE-DESIGN + SPEC addendum) and never tuned.
export const ALPHA = 0.2, Z80 = 1.28155, DELTA_R = 0.02, COVER_FLOOR = 0.78, YEAR_FLOOR = 0.70, YEAR_MIN_DATES = 10;
export const HAR_MIN_TRAIN = 500, HAR_LAGS = [1, 5, 22], PK_FLOOR = 1e-8;
export const CONF_TARGET = 0.8, CONF_MIN = 30, CONF_MAX = 250;
export const H = [1, 5, 21], GRID = 5, B = 2000, SEED = 20261110, FAMILY = 18, MIN_NONOVERLAP = 60;

/** Parkinson daily variance from the day's high and low, floored so its log is finite. */
export const parkinson = (high, low) => Math.max(PK_FLOOR, Math.log(high / low) ** 2 / (4 * Math.LN2));

/** Solve the 4x4 (or kxk) normal equations by Gaussian elimination with partial pivoting; null if singular. */
export function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / M[i][i]);
}

/** Direct log-HAR for horizon h on a daily variance series v[0..]. Training pairs use targets fully realised by index t (i + h <= t).
 *  Returns the forecast standard deviation of the h-session log return at origin t, or null when fewer than HAR_MIN_TRAIN pairs exist. */
export function harForecaster(v, h) {
  const n = v.length, pre = [0]; for (let i = 0; i < n; i++) pre.push(pre[i] + v[i]);
  const avg = (a, b) => (pre[b + 1] - pre[a]) / (b - a + 1);                       // mean of v[a..b]
  const x = i => [1, Math.log(v[i]), Math.log(avg(i - 4, i)), Math.log(avg(i - 21, i))];
  const first = 21; let next = first, cnt = 0, syy = 0; const XtX = [0, 1, 2, 3].map(() => [0, 0, 0, 0]), Xty = [0, 0, 0, 0];
  return t => {                                                                     // t must be non-decreasing across calls
    for (; next + h <= t; next++) { const xi = x(next), y = Math.log(avg(next + 1, next + h)); cnt++; syy += y * y;
      for (let a = 0; a < 4; a++) { Xty[a] += xi[a] * y; for (let b = 0; b < 4; b++) XtX[a][b] += xi[a] * xi[b]; } }
    if (cnt < HAR_MIN_TRAIN || t < first) return null;
    const beta = solve(XtX, Xty); if (!beta) return null;
    let sse = syy; for (let a = 0; a < 4; a++) { sse -= 2 * beta[a] * Xty[a]; for (let b = 0; b < 4; b++) sse += beta[a] * beta[b] * XtX[a][b]; }
    const s2 = Math.max(0, sse / Math.max(1, cnt - 4)), xt = x(t), pred = xt.reduce((s, q, a) => s + q * beta[a], 0);
    const varH = h * Math.exp(pred + s2 / 2);
    return Number.isFinite(varH) && varH > 0 ? {sigma: Math.sqrt(varH), train: cnt} : null;
  };
}

/** Interval (Winkler) score for [lo, hi] and outcome y at level alpha; lower is better. */
export const intervalScore = (lo, hi, y, alpha = ALPHA) => (hi - lo) + (2 / alpha) * Math.max(0, lo - y) + (2 / alpha) * Math.max(0, y - hi);

/** Nonconformity score of outcome y against [lo, hi] with centre m: 1 at the bound, 0 at the centre. */
export const confScore = (lo, m, hi, y) => y >= m ? (y - m) / (hi - m) : (m - y) / (m - lo);

/** Exact finite-sample conformal quantile (rank ceil((n+1)*target)), same rule as production conformalQuantile; null if the rank exceeds n. */
export function confQuantile(scores, target = CONF_TARGET) {
  const n = scores.length, rank = Math.ceil((n + 1) * target); if (!n || rank > n) return null;
  return [...scores].sort((a, b) => a - b)[rank - 1];
}
/** Calibrated range from past resolved scores (most recent CONF_MAX); null below CONF_MIN. */
export function confAdjust(lo, m, hi, pastScores) {
  const s = pastScores.slice(-CONF_MAX); if (s.length < CONF_MIN) return null;
  const q = confQuantile(s); if (q === null || !(q > 0)) return null;
  return [m - q * (m - lo), m + q * (hi - m)];
}

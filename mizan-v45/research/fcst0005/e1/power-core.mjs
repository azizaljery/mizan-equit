// FCST-0005 E1 power/count library (pure, deterministic). Used by design.mjs (scenarios) and testable-cells.mjs (actual coverage).
// Nothing here reads price data. Planning noise comes from variance-estimate.ts (development slice C only) or from the declared conservative fallback.
import {normInv, DELTA, mulberry32} from '../candidate.mjs';
export const H = [1, 5, 21], MK = ['sa', 'us'], M_FAMILY = 24, N_SIM = 200000, SEED = 20261104;
export const C_CRIT = normInv(1 - 0.05 / M_FAMILY);
export const CASES = {optimistic: {infl: 1, rho: 0.9}, moderate: {infl: 1.5, rho: 0.5}, severe: {infl: 3, rho: 0}};
export const THETA = [0.01, 0.015, 0.02], TARGET = {theta: 0.015, power: 0.8};
export const V_END = Date.UTC(2019, 9, 13);
const rnd = mulberry32(SEED), gauss = () => { let s = 0; for (let i = 0; i < 12; i++) s += rnd(); return s - 6; };
const G1 = new Float64Array(N_SIM), G2 = new Float64Array(N_SIM); for (let i = 0; i < N_SIM; i++) { G1[i] = gauss(); G2[i] = gauss(); }
/** P(both references pass): e_i ~ N(theta, (infl*se)^2) correlated rho; pass = e >= max(delta, C_CRIT*se) where se is the analyst's (non-inflated) SE. */
export function jointPower(theta, se, rho, infl) {
  const thr = Math.max(DELTA, C_CRIT * se), sd = infl * se, a = Math.sqrt(1 - rho * rho); let hit = 0;
  for (let i = 0; i < N_SIM; i++) { const e1 = theta + sd * G1[i], e2 = theta + sd * (rho * G1[i] + a * G2[i]); if (e1 >= thr && e2 >= thr) hit++; }
  return hit / N_SIM;
}
export function mde80(se, rho, infl) { let lo = 0, hi = 0.2; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (jointPower(mid, se, rho, infl) >= 0.8) hi = mid; else lo = mid; } return hi; }
export function originsNeeded(theta, nC, seC, rho, infl) {
  if (jointPower(theta, 1e-6, rho, infl) < 0.8) return null; let lo = 1e-6, hi = 0.2;
  if (jointPower(theta, hi, rho, infl) >= 0.8) return Math.ceil(nC * (seC / hi) ** 2);
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (jointPower(theta, mid, rho, infl) >= 0.8) lo = mid; else hi = mid; } return Math.ceil(nC * (seC / lo) ** 2);
}
/** Origins/non-overlapping periods an earlier window gives under the runner's split rule. startMs = first usable calendar instant of the market's history. */
export function windowCounts(startMs, sessionsPerYear, h) {
  const idx = t => Math.round((t - startMs) / 864e5 / 365.25 * sessionsPerYear), end = idx(V_END) - h; let n = 0, firstYear = null;
  for (let Y = new Date(startMs).getUTCFullYear(); Y <= 2019; Y++) { const f = idx(Date.UTC(Y, 0, 1)), need = 252 + 32 * h, last = Math.min(idx(Date.UTC(Y, 11, 31)), end); if (f < need) continue; n += Math.max(0, last - f + 1); if (firstYear === null && last >= f) firstYear = Y; }
  return {nOrigins: n, nonOverlap: Math.floor(n / h), firstTestYear: firstYear};
}
/** One cell. noise = {n, sePlan} from the development slice (or the declared conservative fallback, flagged). */
export function cell(startMs, sessionsPerYear, h, noise) {
  const wc = windowCounts(startMs, sessionsPerYear, h), se = wc.nOrigins > 0 ? noise.sePlan * Math.sqrt(noise.n / wc.nOrigins) : Infinity, grid = {};
  for (const [name, c] of Object.entries(CASES)) grid[name] = {...Object.fromEntries(THETA.map(t => ['power_' + t, jointPower(t, se, c.rho, c.infl)])), mde80: mde80(se, c.rho, c.infl)};
  const countOk = wc.nonOverlap >= 60, powerOk = grid.moderate['power_' + TARGET.theta] >= TARGET.power;
  return {...wc, se, grid, noiseFallback: !!noise.fallback, testableByCount: countOk, meetsPowerTarget: powerOk, status: !countOk ? 'not-testable (fewer than 60 non-overlapping periods)' : !powerOk ? 'not-testable (power target 80% at 1.5% not met, moderate case)' : 'testable',
    originsNeeded_severe_at_1_5pct: originsNeeded(0.015, noise.n, noise.sePlan, CASES.severe.rho, CASES.severe.infl)};
}

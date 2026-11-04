// FCST-0005 E1 PLANNING v2 (no V data is read; none is assumed to exist). From the exposed-window stage-1 result file only:
//  (1) origin dates / non-overlapping periods an earlier window would give per market and horizon under the runner's split rule;
//  (2) power of the JOINT acceptance test against BOTH references (intersection-union), Holm family fixed at m = 24 (Bonferroni critical value, exact for the best cell,
//      conservative otherwise; untestable cells stay in the family), with the protocol's extra requirement estimate >= delta (1%, never lowered),
//      under sensitivity to (a) the correlation between the two estimates and (b) under-estimated sampling variability (temporal dependence / regime change).
// Planning estimates only: noise is taken from the EXPOSED window C. Deterministic (seeded Monte Carlo, common random numbers). Not a guarantee of any outcome.
import {readFileSync, writeFileSync} from 'node:fs';
import {normInv, DELTA, mulberry32} from '../candidate.mjs';

const [, , resultPath, outPath] = process.argv;
const R = JSON.parse(readFileSync(resultPath, 'utf8'));
const H = [1, 5, 21], MK = ['sa', 'us'], M_FAMILY = 24, N_SIM = 200000, SEED = 20261104;
const C_CRIT = normInv(1 - 0.05 / M_FAMILY);
const RHO = [0, 0.5, 0.9], INFLATE = [1, 1.5, 3];            // sensitivity grid; (inflate 3, rho 0) is the severe case (least favourable)
const THETA = [0.01, 0.015, 0.02];

const years = (Date.parse('2024-09-04') - Date.parse('2019-10-14')) / 864e5 / 365.25;
const spy = {}; for (const m of MK) { const rows = R.manifest.filter(f => (f.file.endsWith('.SR.json')) === (m === 'sa')).map(f => f.rows).sort((a, b) => a - b); spy[m] = rows[Math.floor(rows.length / 2)] / years; }
const noise = {};
for (const m of MK) for (const h of H) {
  const cs = R.cells.filter(c => c.market === m && c.h === h && c.vsR0 && c.vsCpub), ses = [];
  for (const c of cs) for (const k of ['vsR0', 'vsCpub']) { const w = (c[k].hi - c[k].lo) / 2 / 1.96; if (w > 1e-9) ses.push({model: c.model, ref: k, se: w}); }
  const worst = ses.reduce((a, b) => b.se > a.se ? b : a, ses[0]);
  noise[`${m}/${h}`] = {nDatesC: cs[0].nDates, seC: worst.se, from: `${worst.model} ${worst.ref}`};
}
const ymd = (y, m, d) => Date.UTC(y, m - 1, d), V_END = ymd(2019, 10, 13);
function scenario(start, m, h) {
  const S = ymd(start, 1, 1), sp = spy[m], idx = t => Math.round((t - S) / 864e5 / 365.25 * sp), end = idx(V_END) - h;
  let n = 0, firstYear = null;
  for (let Y = start; Y <= 2019; Y++) {
    const f = idx(ymd(Y, 1, 1)), need = 252 + 32 * h, last = Math.min(idx(ymd(Y, 12, 31)), end);
    if (f < need) continue;
    n += Math.max(0, last - f + 1); if (firstYear === null && last >= f) firstYear = Y;
  }
  return {nOrigins: n, nonOverlap: Math.floor(n / h), firstTestYear: firstYear};
}
// common random numbers for the bivariate normal: (g1, g2) iid N(0,1)
const rnd = mulberry32(SEED), gauss = () => { let s = 0; for (let i = 0; i < 12; i++) s += rnd(); return s - 6; };
const G1 = new Float64Array(N_SIM), G2 = new Float64Array(N_SIM); for (let i = 0; i < N_SIM; i++) { G1[i] = gauss(); G2[i] = gauss(); }
/** P(both references pass): e_i ~ N(theta, (infl*se)^2) with corr rho; pass_i = e_i > crit*se (the analyst's se) AND e_i >= delta. */
function jointPower(theta, se, rho, infl) {
  const thr = Math.max(DELTA, C_CRIT * se), sd = infl * se, a = Math.sqrt(1 - rho * rho); let hit = 0;
  for (let i = 0; i < N_SIM; i++) { const e1 = theta + sd * G1[i], e2 = theta + sd * (rho * G1[i] + a * G2[i]); if (e1 >= thr && e2 >= thr) hit++; }
  return hit / N_SIM;
}
/** Smallest true improvement with joint power >= 0.8 (bisection; power is increasing in theta). */
function mde80(se, rho, infl) { let lo = 0, hi = 0.2; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (jointPower(mid, se, rho, infl) >= 0.8) hi = mid; else lo = mid; } return hi; }
/** Origins needed for joint power 0.8 at theta (se scales with 1/sqrt(n)); null if impossible. */
function originsNeeded(theta, nC, seC, rho, infl) {
  if (jointPower(theta, 1e-6, rho, infl) < 0.8) return null; let lo = 1e-6, hi = 0.2;
  if (jointPower(theta, hi, rho, infl) >= 0.8) return Math.ceil(nC * (seC / hi) ** 2);
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (jointPower(theta, mid, rho, infl) >= 0.8) lo = mid; else hi = mid; }
  return Math.ceil(nC * (seC / lo) ** 2);
}
const SCEN = {V_only_2015: 2015, A_plus_V_2010: 2010, A_plus_V_2005: 2005};
const out = {kind: 'planning only; noise estimated on the EXPOSED window C; no earlier data read; powers are model-based estimates, not guarantees', delta: DELTA, familyM: M_FAMILY, critZ: C_CRIT,
  jointRule: 'both references: estimate >= max(delta, critZ*se); Bonferroni critical value for the fixed family of 24 (untestable cells stay in the family)', nSim: N_SIM, seed: SEED, rhoGrid: RHO, inflateGrid: INFLATE, thetaGrid: THETA,
  sessionsPerYear: spy, noise, scenarios: {}};
for (const [name, start] of Object.entries(SCEN)) {
  out.scenarios[name] = {};
  for (const m of MK) for (const h of H) {
    const sc = scenario(start, m, h), nz = noise[`${m}/${h}`], se = nz.seC * Math.sqrt(nz.nDatesC / sc.nOrigins), grid = {};
    for (const infl of INFLATE) for (const rho of RHO) grid[`infl${infl}_rho${rho}`] = {...Object.fromEntries(THETA.map(t => ['power_' + t, jointPower(t, se, rho, infl)])), mde80: mde80(se, rho, infl)};
    out.scenarios[name][`${m}/${h}`] = {...sc, testableByCount: sc.nonOverlap >= 60, se, grid, originsNeeded_severe_at_1_5pct: originsNeeded(0.015, nz.nDatesC, nz.seC, 0, 3), originsNeeded_optimistic_at_1_5pct: originsNeeded(0.015, nz.nDatesC, nz.seC, 0.9, 1)};
  }
}
writeFileSync(outPath, JSON.stringify(out, null, 1));
const f = x => (100 * x).toFixed(1) + '%';
for (const [n, s] of Object.entries(out.scenarios)) { console.log(n); for (const [k, v] of Object.entries(s)) console.log(' ', k, `origins=${v.nOrigins} no=${v.nonOverlap}${v.testableByCount ? '' : '(<60)'} se=${f(v.se)} P(1.5%) opt=${f(v.grid['infl1_rho0.9']['power_0.015'])} mid=${f(v.grid['infl1.5_rho0.5']['power_0.015'])} severe=${f(v.grid['infl3_rho0']['power_0.015'])} MDE80 opt=${f(v.grid['infl1_rho0.9'].mde80)} severe=${f(v.grid['infl3_rho0'].mde80)} need(severe,1.5%)=${v.originsNeeded_severe_at_1_5pct}`); }

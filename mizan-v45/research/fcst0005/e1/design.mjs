// FCST-0005 E1 PLANNING (no V data is read; none is assumed to exist). Computes, from the exposed-window stage-1 result file only:
//   (1) how many origin dates / non-overlapping periods an earlier window would give per market and horizon under the protocol's own split rule;
//   (2) power and minimum detectable improvement under Holm families of size 24 / 8 / 4, INCLUDING the protocol's extra requirement
//       that the point estimate be >= delta (so a true improvement of exactly delta can never exceed 50% power).
// Planning estimates of noise come from the exposed window C and are labelled as such. Deterministic; no I/O except reading the result JSON.
import {readFileSync, writeFileSync} from 'node:fs';
import {normInv, DELTA} from '../candidate.mjs';

const [, , resultPath, outPath] = process.argv;
const R = JSON.parse(readFileSync(resultPath, 'utf8'));
const Phi = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const H = [1, 5, 21], MK = ['sa', 'us'], FAM = {fixed24: 24, perHorizon8: 8, perCell4: 4};

// sessions per year per market, from the stored manifest (rows between 2019-10-14 and 2024-09-04 inclusive)
const years = (Date.parse('2024-09-04') - Date.parse('2019-10-14')) / 864e5 / 365.25;
const spy = {}; for (const m of MK) { const rows = R.manifest.filter(f => (f.file.endsWith('.SR.json')) === (m === 'sa')).map(f => f.rows).sort((a, b) => a - b); spy[m] = rows[Math.floor(rows.length / 2)] / years; }

// noise: standard error of the mean relative improvement at the exposed window's own n (block bootstrap CI half-width / 1.96), worst of the two references, worst of the four models with a non-degenerate CI
const noise = {};
for (const m of MK) for (const h of H) {
  const cs = R.cells.filter(c => c.market === m && c.h === h && c.vsR0 && c.vsCpub);
  const ses = []; for (const c of cs) for (const k of ['vsR0', 'vsCpub']) { const w = (c[k].hi - c[k].lo) / 2 / 1.96; if (w > 1e-9) ses.push({model: c.model, ref: k, se: w}); }
  const worst = ses.reduce((a, b) => b.se > a.se ? b : a, ses[0]);
  noise[`${m}/${h}`] = {nDatesC: cs[0].nDates, seC: worst.se, from: `${worst.model} ${worst.ref}`, degenerate: cs.length - new Set(ses.map(s => s.model)).size};
}
// number of test origins for an earlier-window scenario under the runner's split rule: a test year Y is used only if
// the training origins available before it (purged by 2h+1, warm-up 252) number at least 30*h.
const ymd = (y, m, d) => Date.UTC(y, m - 1, d), V_END = ymd(2019, 10, 13);
function scenario(start, m, h) {
  const S = ymd(start, 1, 1), sp = spy[m], idx = t => Math.round((t - S) / 864e5 / 365.25 * sp), end = idx(V_END) - h;  // last origin whose target is still inside the window
  let n = 0, firstYear = null;
  for (let Y = start; Y <= 2019; Y++) {
    const f = idx(ymd(Y, 1, 1)), need = 252 + 32 * h, last = Math.min(idx(ymd(Y, 12, 31)), end);
    if (f < need) continue;  // runner skips the year
    n += Math.max(0, last - f + 1); if (firstYear === null && last >= f) firstYear = Y;
  }
  return {nOrigins: n, nonOverlap: Math.floor(n / h), firstTestYear: firstYear};
}
const SCEN = {V_only_2015: 2015, A_plus_V_2010: 2010, A_plus_V_2005: 2005};
const delta = DELTA, z80 = normInv(0.8);
const out = {kind: 'planning only; noise estimated on the EXPOSED window C; no earlier data read', delta, sessionsPerYear: spy, noise, scenarios: {}};
for (const [name, start] of Object.entries(SCEN)) {
  out.scenarios[name] = {};
  for (const m of MK) for (const h of H) {
    const sc = scenario(start, m, h), nz = noise[`${m}/${h}`];
    const se = sc.nOrigins > 0 ? nz.seC * Math.sqrt(nz.nDatesC / sc.nOrigins) : Infinity;
    const fam = {};
    for (const [fn, mm] of Object.entries(FAM)) {
      const c = normInv(1 - 0.05 / mm), thr = Math.max(delta, c * se);               // 'proven' needs z > c (Bonferroni, conservative for Holm) AND estimate >= delta
      const P = th => 1 - Phi((thr - th) / se);
      fam[fn] = {critZ: c, power_true_0_5pct: P(0.005), power_true_1pct: P(0.01), power_true_1_5pct: P(0.015), power_true_2pct: P(0.02), mde80: thr + z80 * se,
        rejectProb_true_0: Phi((delta - 1.96 * se - 0) / se), rejectProb_true_0_5pct: Phi((delta - 1.96 * se - 0.005) / se)};
    }
    // origins needed (on the exposed-window noise) for 80% power at a true improvement th, family of 8: smallest se* with mde(se*) = th, by bisection (mde is increasing in se)
    const need = th => { const c = normInv(1 - 0.05 / 8), mde = s => Math.max(delta, c * s) + z80 * s; if (mde(1e-9) >= th) return null; let lo = 1e-9, hi = 1; for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (mde(mid) <= th) lo = mid; else hi = mid; } return Math.ceil(nz.nDatesC * (nz.seC / lo) ** 2); };
    out.scenarios[name][`${m}/${h}`] = {...sc, nonOverlapOk: sc.nonOverlap >= 60, se, families: fam, originsNeeded_80pct_at_1_5pct: need(0.015), originsNeeded_80pct_at_2pct: need(0.02)};
  }
}
writeFileSync(outPath, JSON.stringify(out, null, 1));
const f = x => (100 * x).toFixed(2) + '%';
for (const [n, s] of Object.entries(out.scenarios)) { console.log(n); for (const [k, v] of Object.entries(s)) console.log(' ', k, `origins=${v.nOrigins} no=${v.nonOverlap}${v.nonOverlapOk ? '' : '(<60)'} se=${v.se === Infinity ? 'inf' : f(v.se)} MDE80[24/8/4]=${['fixed24', 'perHorizon8', 'perCell4'].map(q => f(v.families[q].mde80)).join('/')} P(1%)@8=${(100 * v.families.perHorizon8.power_true_1pct).toFixed(0)}% P(2%)@8=${(100 * v.families.perHorizon8.power_true_2pct).toFixed(0)}%`); }

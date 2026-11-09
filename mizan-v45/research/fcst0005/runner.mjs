// FCST-0005 evaluation runner (research only; NOT imported by production). Implements PROTOCOL-FCST-0005 sections 2-8 exactly:
// frozen candidates, yearly rolling-origin retrain with purge, common cases, paired per-date differences, circular block bootstrap,
// intersection-union over {R0, C_pub}, Holm over a FIXED family (m = 30), per-horizon decision, negative controls.
// Pure and deterministic: no clock, no Math.random, no I/O. Data arrive as arguments (see run-c.mjs for the guarded loading).
import * as C from './candidate.mjs';

export const RUN_HORIZONS = [1, 5, 21];
export const MODELS = ['Q0', 'Q1', 'Q2', 'QE', 'MZ1'];
export const FAMILY_M = 30;                  // 5 candidates (Q0, Q1, Q2, QE, MZ1) x 2 markets x 3 horizons, fixed in advance (AMEND-2)
export const SEEDS = {boot: 20261101, shuffle: 20261102};
export const B_DEFAULT = 2000;
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const year = d => +d.slice(0, 4);

/** stocks: [{symbol, market, dates[], close[]}]; eng(si, t, h) -> {bias, centre} | null  (centre = published price-only centre as a log return).
 *  gridStep: engine values exist only on t % gridStep === 0; those rows are the COMMON CASES used for every comparison. */
export function buildRows(stocks, {gridStep = 5} = {}) {
  const rows = [];
  stocks.forEach((s, si) => {
    const n = s.close.length;
    for (let t = 252; t < n; t++) {
      const sig = C.sigma63(s.close, t), x = C.features(s.close, t);
      if (!(sig > 0) || !x || !x.every(Number.isFinite)) continue;
      for (const h of RUN_HORIZONS) {
        if (t + h >= n) continue;
        const y = Math.log(s.close[t + h] / s.close[t]), S = sig * Math.sqrt(h);
        const y2 = t + 2 * h < n ? Math.log(s.close[t + 2 * h] / s.close[t + h]) : null; // displaced target (control only)
        rows.push({si, market: s.market, t, h, date: s.dates[t], tdate: s.dates[t + h], S, sig, y, z: y / S, z2: y2 === null ? null : y2 / S, x, xr: 0, grid: t % gridStep === 0});
      }
    }
  });
  // QM input: cross-sectional rank of mom252_21 among the rows of the same (market, h, date); uses only prices up to t.
  const groups = new Map(); rows.forEach((r, i) => { const k = r.market + '|' + r.h + '|' + r.date; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
  for (const idx of groups.values()) { const rk = C.rankFeature(idx.map(i => rows[i].x[2])); idx.forEach((ri, k) => { rows[ri].xr = rk[k]; }); }
  return rows;
}
function weightByDate(rows) { // each origin date has total weight 1 inside its (market, h) block
  const cnt = new Map(); for (const r of rows) cnt.set(r.date, (cnt.get(r.date) || 0) + 1);
  return rows.map(r => 1 / cnt.get(r.date));
}
function shuffleWithinDate(rows, seed) { // negative control A: features permuted across stocks inside each date
  const rnd = C.mulberry32(seed), byDate = new Map();
  rows.forEach((r, i) => { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(i); });
  const xs = rows.map(r => r.x), xrs = rows.map(r => r.xr);
  for (const idx of [...byDate.keys()].sort().map(d => byDate.get(d))) {
    const perm = idx.slice(); for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    idx.forEach((ri, k) => { xs[ri] = rows[perm[k]].x; xrs[ri] = rows[perm[k]].xr; });
  }
  return rows.map((r, i) => ({...r, x: xs[i], xr: xrs[i]}));
}

/** Core evaluation for ONE market. Returns per-horizon results. eng provides C_pub and the engine bias for QE. */
export function evaluateMarket({market, stocks, eng, calendar, gridStep = 5, B = B_DEFAULT, variant = 'real'}) {
  const idxOf = new Map(calendar.map((d, i) => [d, i]));
  let all = buildRows(stocks.filter(s => s.market === market).map((s, i) => ({...s})), {gridStep}); // si indexes the filtered list
  const list = stocks.filter(s => s.market === market);
  if (variant === 'shuffle') all = RUN_HORIZONS.flatMap(h => shuffleWithinDate(all.filter(r => r.h === h), SEEDS.shuffle));
  const out = {};
  const years = [...new Set(all.map(r => year(r.date)))].sort();
  for (const h of RUN_HORIZONS) {
    const rowsH = all.filter(r => r.h === h);
    const zOf = r => variant === 'displace' ? r.z2 : r.z;
    const usable = rowsH.filter(r => zOf(r) !== null);
    const perModel = {R0: [], CPUB: [], Q0: [], Q1: [], Q2: [], QE: [], MZ1: []}; // arrays of {date, nae, year, si}
    const testYears = []; let trainStats = null;
    for (const Y of years) {
      const test = usable.filter(r => year(r.date) === Y && r.grid);
      if (!test.length) continue;
      const firstIdx = Math.min(...test.map(r => idxOf.get(r.date)));
      const trainOk = r => idxOf.get(r.tdate) <= firstIdx - h - 1;            // purge + gap of h sessions
      const train = usable.filter(trainOk);
      const trainDates = new Set(train.map(r => r.date));
      if (trainDates.size < 30 * h) continue;                                   // fewer than 30 non-overlapping periods: not trainable yet
      const w = weightByDate(train);
      const q0 = C.fitQ0(train.map(zOf), w), q1 = C.fitQ1(train.map(r => r.x), train.map(zOf), w);
      // Q2 pools all three horizons with the same purge rule per horizon
      const pool = [];
      for (const hh of RUN_HORIZONS) {
        const rh = usable.length ? all.filter(r => r.h === hh && (variant === 'displace' ? r.z2 !== null : true) && idxOf.get(r.tdate) <= firstIdx - hh - 1) : [];
        const wh = weightByDate(rh); rh.forEach((r, i) => pool.push({h: hh, z: variant === 'displace' ? r.z2 : r.z, x: r.x, w: wh[i]}));
      }
      const q2 = C.fitQ2(pool);
      const qm = C.fitQ1(train.map(r => [r.xr]), train.map(zOf), w), sigTrainMed = C.weightedMedian(train.map(r => r.sig), w);
      // QE: z ~ a + b * engine_bias on GRID training rows only
      const gtrain = train.filter(r => r.grid), eb = gtrain.map(r => eng(r.si, r.t, h)), keep = gtrain.map((r, i) => i).filter(i => eb[i]);
      let qe = null;
      if (keep.length >= 30 * h) { const gw = weightByDate(keep.map(i => gtrain[i])); qe = C.fitQ1(keep.map(i => [eb[i].bias]), keep.map(i => zOf(gtrain[i])), gw); }
      if (!trainStats) { // training-only inputs of the testability rule (first window that can be trained)
        const bd = new Map(); train.forEach((r, i) => { const v = bd.get(r.date) || {a: [], b: []}; v.a.push(Math.abs(zOf(r))); v.b.push(Math.abs(zOf(r) - q0.predict()) - Math.abs(zOf(r))); bd.set(r.date, v); });
        const A = [...bd.values()].map(v => mean(v.a)), D = [...bd.values()].map(v => mean(v.b));
        trainStats = {maeRef: mean(A), sigmaLR: sd(D), nTrainDates: bd.size};
      }
      testYears.push({Y, nTrainDates: trainDates.size, nTest: test.length});
      for (const r of test) {
        const e = eng(r.si, r.t, h); if (!e || !qe) continue;                   // COMMON CASES only
        const z = zOf(r), cpub = e.centre / r.S;
        const rec = (k, zh) => perModel[k].push({date: r.date, nae: Math.abs(z - zh), year: Y, si: r.si});
        rec('R0', 0); rec('CPUB', cpub); rec('Q0', q0.predict()); rec('Q1', q1.predict(r.x)); rec('Q2', q2.predict(r.x, h)); rec('QE', qe.predict([e.bias]));
        rec('MZ1', C.mz1Combine([q0.predict(), q1.predict(r.x), q2.predict(r.x, h), qm.predict([r.xr])], r.sig, sigTrainMed));
      }
    }
    out[h] = {perModel, testYears, trainStats};
  }
  return {market, list: list.map(s => s.symbol), out};
}

/** Per-date paired statistics of candidate vs reference over the common cases. */
export function pairStats(perModel, cand, ref, h, B = B_DEFAULT, gridStep = 5) {
  const byDate = (k) => { const m = new Map(); for (const r of perModel[k]) { if (!m.has(r.date)) m.set(r.date, []); m.get(r.date).push(r.nae); } return m; };
  const mc = byDate(cand), mr = byDate(ref), dates = [...mc.keys()].filter(d => mr.has(d)).sort();
  if (dates.length < 10) return {n: dates.length, ok: false};
  const naeC = dates.map(d => mean(mc.get(d))), naeR = dates.map(d => mean(mr.get(d)));
  const maeC = mean(naeC), maeR = mean(naeR), d = dates.map((_, i) => (naeC[i] - naeR[i]) / maeR);
  const ac = L => { const m = mean(d); let a = 0, b = 0; for (let i = 0; i < d.length; i++) { b += (d[i] - m) ** 2; if (i >= L) a += (d[i] - m) * (d[i - L] - m); } return b ? a / b : 0; };
  let L = 1; while (L < 20 && Math.abs(ac(L)) >= 0.1) L++;
  const block = Math.max(Math.ceil(h / gridStep), L), means = C.blockBootstrapMeans(d, block, B, SEEDS.boot);
  const lo = means[Math.floor(0.025 * (B - 1))], hi = means[Math.ceil(0.975 * (B - 1))];
  const byYear = new Map(); dates.forEach((dt, i) => { const y = year(dt); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push([naeC[i], naeR[i]]); });
  const yearly = [...byYear.entries()].sort().map(([y, v]) => ({year: y, relImprovement: 1 - mean(v.map(a => a[0])) / mean(v.map(a => a[1]))}));
  return {ok: true, n: dates.length, block, maeC, maeR, relImprovement: 1 - maeC / maeR, ciLower: lo, ciUpper: hi, p: C.bootstrapP(means), yearly};
}

/** Testability inputs from TRAINING data only (the last training window before the first test year). */
export function cellTestability(perHorizon, h, trainStats, gridStep = 5) {
  const nDates = new Set(perHorizon.perModel.R0.map(r => r.date)).size;
  const nNo = Math.floor((perHorizon.testYears.reduce((s, y) => s + y.nTest, 0) > 0 ? nDates * gridStep : 0) / h); // grid step 5: sessions spanned ~ 5 * dates
  return C.testability({nNoOverlap: nNo, sigmaLR: trainStats.sigmaLR, maeRef: trainStats.maeRef, nDates, m: FAMILY_M});
}

/** Run both markets, all cells, Holm over the fixed family, and the per-horizon decision. `trainStatsFn(market,h)` supplies training-only sigma/MAE. */
export function decideAll(results, {B = B_DEFAULT, controls, gridStep = 5}) {
  const cells = [];
  for (const res of results) for (const h of RUN_HORIZONS) for (const model of MODELS) {
    const ph = res.out[h];
    const vsR0 = pairStats(ph.perModel, model, 'R0', h, B, gridStep), vsC = pairStats(ph.perModel, model, 'CPUB', h, B, gridStep);
    const ts = ph.trainStats ?? {maeRef: NaN, sigmaLR: NaN}, test = cellTestability(ph, h, ts, gridStep);
    const ok = vsR0.ok && vsC.ok;
    cells.push({market: res.market, h, model, ok, testable: ok && test.testable, deltaMin: test.deltaMin, nDates: vsR0.n ?? 0,
      p: ok && test.testable ? Math.max(vsR0.p, vsC.p) : 1,
      relImprovement: ok ? Math.min(vsR0.relImprovement, vsC.relImprovement) : null,
      ciUpper: ok ? Math.max(vsR0.ciUpper, vsC.ciUpper) : null, ciLower: ok ? Math.max(vsR0.ciLower, vsC.ciLower) : null,
      vsR0, vsC, stableOk: ok ? stability(vsR0, vsC) : false});
  }
  if (cells.length !== FAMILY_M) throw new Error('family size must be ' + FAMILY_M + ', got ' + cells.length);
  const adj = C.holmAdjust(cells.map(c => c.p)); cells.forEach((c, i) => { c.holmP = adj[i]; });
  const decisions = [];
  for (const res of results) for (const h of RUN_HORIZONS) {
    const mine = cells.filter(c => c.market === res.market && c.h === h);
    const best = mine.slice().sort((a, b) => a.holmP - b.holmP || (b.relImprovement ?? -9) - (a.relImprovement ?? -9))[0];
    const ctl = controls?.[res.market]?.[h];
    const dec = C.decideHorizon({testable: best.testable, cleanData: false, holmP: best.holmP, relImprovement: best.relImprovement ?? -1,
      ciUpper: best.ciUpper ?? 1, ciLower: best.ciLower ?? 1, stableOk: best.stableOk, controlsOk: ctl?.ok});
    decisions.push({market: res.market, h, bestModel: best.model, ...dec, display: C.displayStatus(dec)});
  }
  return {cells, decisions};
}
function stability(a, b) {
  const ys = a.yearly.map((y, i) => Math.min(y.relImprovement, b.yearly[i]?.relImprovement ?? -1));
  return ys.length >= 3 && ys.filter(v => v > 0).length / ys.length >= 2 / 3;
}
export const controlOk = (relImprovementQ1vsQ0) => ({ok: !(relImprovementQ1vsQ0 >= C.DELTA / 2), relImprovementQ1vsQ0});

/** Full protocol run for both markets. engFor(market) returns eng(listIndex, t, h) for that market's stock list. */
export function runAll({stocks, calendars, engFor, gridStep = 5, B = B_DEFAULT}) {
  const markets = ['sa', 'us'], real = [], controls = {};
  for (const m of markets) {
    const args = {market: m, stocks, eng: engFor(m), calendar: calendars[m], gridStep, B};
    real.push(evaluateMarket({...args, variant: 'real'}));
    controls[m] = {};
    const sh = evaluateMarket({...args, variant: 'shuffle'}), dp = evaluateMarket({...args, variant: 'displace'});
    for (const h of RUN_HORIZONS) {
      const a = pairStats(sh.out[h].perModel, 'Q1', 'Q0', h, B, gridStep), b = pairStats(dp.out[h].perModel, 'Q1', 'Q0', h, B, gridStep);
      const ca = a.ok ? controlOk(a.relImprovement) : {ok: null}, cb = b.ok ? controlOk(b.relImprovement) : {ok: null};
      controls[m][h] = {ok: ca.ok === null || cb.ok === null ? undefined : ca.ok && cb.ok, shuffled: ca, displaced: cb};
    }
  }
  // DESCRIPTIVE ONLY (added after the first run, decisions unaffected and verified identical): does the published price-only centre beat 'no move'?
  const cpubVsR0 = Object.fromEntries(real.map(r => [r.market, Object.fromEntries(RUN_HORIZONS.map(h => { const q = pairStats(r.out[h].perModel, 'CPUB', 'R0', h, B, gridStep);
    return [h, q.ok ? {n: q.n, rel: q.relImprovement, lo: q.ciLower, hi: q.ciUpper, maeCpub: q.maeC, maeR0: q.maeR, block: q.block} : null]; }))]));
  const res = decideAll(real, {B, controls, gridStep});
  return {...res, controls, cpubVsR0, testYears: Object.fromEntries(real.map(r => [r.market, Object.fromEntries(RUN_HORIZONS.map(h => [h, r.out[h].testYears]))])),
    trainStats: Object.fromEntries(real.map(r => [r.market, Object.fromEntries(RUN_HORIZONS.map(h => [h, r.out[h].trainStats]))]))};
}

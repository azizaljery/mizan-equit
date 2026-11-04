// FCST-0005 E0-b: reproducible derivation of the neutral-zone constraint from the PRODUCTION equation (functions imported, not copied).
// What is derived: for each horizon h, the smallest |bias| that moves the published direction out of "محايد", UP and DOWN separately,
// with and without the 0.6 positive-tilt multiplier, the volatility-scale (clip) condition, and the largest |bias| the inputs allow.
// Method: closed form from scenarioCenter's definition, then verified by bisection THROUGH the production functions
// (scenarioCenter -> expected change % -> directionOf with the production neutral threshold read from forecasts()).
import {researchFactors, forecastWeights, forecasts} from '../../../lib/research-model';
import {DEFAULT_SETTINGS, adjustedWeights} from '../../../lib/site-settings';
import {scenarioCenter} from '../../../lib/forecast-diagnostics';
import {directionOf} from '../../../lib/forecast-metrics';
import {horizonCondition} from '../../../lib/forecast-conditions';
import {mulberry32} from '../candidate.mjs';

export const HORIZONS = [1, 5, 21, 63, 126, 252];
const gauss = (rnd: () => number) => { let s = 0; for (let i = 0; i < 12; i++) s += rnd(); return s - 6; };

/** Deterministic synthetic price-only historical report (no facts, no context): the same shape the E0/FCST-0005 runs feed to production. */
export function syntheticReport(seed: number, n = 600, annualDrift = 0, annualVol = 0.3, zeroVolDays = 0) {
  const rnd = mulberry32(seed), prices: any[] = []; let p = 100, d0 = Date.UTC(2018, 0, 1), k = 0;
  while (prices.length < n) {
    const dt = new Date(d0 + k * 864e5); k++; const w = dt.getUTCDay(); if (w === 0 || w === 6) continue;
    const r = annualDrift / 252 + annualVol / Math.sqrt(252) * gauss(rnd), o = p; p = p * Math.exp(r);
    const hi = Math.max(o, p) * (1 + 0.004 * rnd()), lo = Math.min(o, p) * (1 - 0.004 * rnd()), vol = prices.length < zeroVolDays ? 0 : Math.round(1e6 * Math.exp(0.4 * gauss(rnd)));
    prices.push({date: dt.toISOString().slice(0, 10), open: o, high: hi, low: lo, close: p, volume: vol});
  }
  const last = prices[prices.length - 1];
  return {company: {symbol: 'SYN' + seed, name: 'SYN', exchange: 'RESEARCH', sector: 'x', industry: 'x', source: 'research://synthetic'}, currency: 'USD', asOf: last.date, retrievedAt: last.date + 'T20:00:00.000Z',
    quoteTime: null, priceSource: 'research://synthetic', prices, facts: [], official: null, news: [], peers: [], checks: [], warnings: [], mode: 'historical'} as any;
}
const nowOf = (r: any) => Date.parse(r.asOf + 'T20:00:00Z');

/** Input bounds: every factor signal lies in [-1, 1] (checked by property on an ensemble through the production researchFactors). */
export function inputBounds(nSeries = 240) {
  let lo = Infinity, hi = -Infinity; const live = new Set<string>(), all = new Set<string>();
  for (let s = 1; s <= nSeries; s++) {
    const rep = syntheticReport(s, 600, (s % 9 - 4) * 0.2, 0.08 + (s % 13) * 0.08, s % 7 === 0 ? 40 : 0);
    for (const f of researchFactors(rep, nowOf(rep)).factors) { all.add(f.key); if (f.signal !== null) { live.add(f.key); lo = Math.min(lo, f.signal); hi = Math.max(hi, f.signal); } }
  }
  return {nSeries, minSignal: lo, maxSignal: hi, withinUnit: lo >= -1 && hi <= 1, factorKeys: [...all].sort(), priceOnlyLiveKeys: [...live].sort(), priceOnlyOnly: [...all].filter(k => !live.has(k)).sort()};
}

/** Neutral threshold (%) per horizon, READ from the production forecasts() output (not copied). */
export function productionThresholds() {
  const rep = syntheticReport(7, 600, 0.1, 0.3), rows = forecasts(rep, null, nowOf(rep), DEFAULT_SETTINGS, HORIZONS.map(s => ({name: 'h' + s, sessions: s}))).rows as any[];
  const out: Record<number, number> = {};
  for (const r of rows) { if (typeof r.neutralThresholdPct !== 'number') throw new Error('threshold unavailable for h=' + r.sessions + ': ' + (r.reasons?.[0] ?? '?')); out[r.sessions] = r.neutralThresholdPct; }
  return out;
}
/** Tilt multiplier values the production condition can return, read by calling horizonCondition on two controlled conditions. */
export function tiltMultipliers() {
  const rep = syntheticReport(11, 600, 0, 0.3), c: any = researchFactors(rep, nowOf(rep)).conditioning;
  const m = (rv: number | null) => horizonCondition({...c, relativeVolume: rv}, 21).positiveTiltMultiplier;
  return {lowVolume: m(0.5), normalVolume: m(1.5), unavailableVolume: m(null)};
}
export function weightsFor(h: number) { const w = adjustedWeights(forecastWeights(h), DEFAULT_SETTINGS); return {w, sum: Object.values(w).reduce((a, b) => a + b, 0)}; }

const centrePct = (bias: number, h: number, dailySigma: number, expectedScale: number, mult: number) =>
  100 * (Math.exp(scenarioCenter({bias, sessions: h, dailySigma, expectedScale, positiveTiltMultiplier: mult}).centerLogReturn) - 1);
export const directionAt = (bias: number, h: number, thr: number, dailySigma: number, expectedScale: number, mult: number) => directionOf(centrePct(bias, h, dailySigma, expectedScale, mult), thr);
/** Smallest |bias| in [0, cap] that changes the direction (bisection through production code). Returns null when none exists. */
export function bisectExit(side: 'up' | 'down', h: number, thr: number, dailySigma: number, expectedScale: number, mult: number, cap = 1) {
  const want = side === 'up' ? 'صاعد' : 'هابط', sgn = side === 'up' ? 1 : -1;
  if (directionAt(sgn * cap, h, thr, dailySigma, expectedScale, mult) !== want) return null;
  let a = 0, b = cap; for (let i = 0; i < 80; i++) { const mid = (a + b) / 2; if (directionAt(sgn * mid, h, thr, dailySigma, expectedScale, mult) === want) b = mid; else a = mid; }
  return b;
}
/** Closed forms from scenarioCenter: request = bias*g(h) (g = .25*dailySigma for h=1, .15*h/252 otherwise); clip = +-E/2; up centre multiplied by m. */
export function closedForm(h: number, thr: number, dailySigma: number, mult: number) {
  const g = h === 1 ? 0.25 * dailySigma : 0.15 * h / 252, cu = Math.log(1 + thr / 100), cd = Math.log(1 - thr / 100);
  return {g, cu, cd, upBias: cu / (mult * g), downBias: cd / g, upMinHalfScale: cu / mult, downMinHalfScale: -cd};  // clip needs E/2 above the *MinHalfScale values
}

export function deriveNeutrality() {
  const bounds = inputBounds(), thr = productionThresholds(), mult = tiltMultipliers();
  const priceOnly = bounds.priceOnlyLiveKeys, perH: any[] = [];
  for (const h of HORIZONS) {
    const {w, sum} = weightsFor(h), wPrice = priceOnly.reduce((s, k) => s + (w[k] ?? 0), 0);
    const bAll = 1, bPrice = wPrice / 100;  // |bias| <= (sum of weights of factors that carry a signal) / 100, attained only if every such signal is +-1
    const sigmas = h === 1 ? [0.005, 0.01, 0.02, 0.03] : [0.01];  // daily sigma: only h=1 depends on it
    const rows = sigmas.map(sd => {
      const E = Math.max(sd * Math.sqrt(h), 0) * 1000;  // large expected scale so the clip cannot bind: isolates the bias requirement
      const cf1 = closedForm(h, thr[h], sd, 1), cf6 = closedForm(h, thr[h], sd, mult.lowVolume);
      const num = {up1: bisectExit('up', h, thr[h], sd, E, 1, 10), up6: bisectExit('up', h, thr[h], sd, E, mult.lowVolume, 10), down: bisectExit('down', h, thr[h], sd, E, 1, 10)};
      for (const [a, b, name] of [[cf1.upBias, num.up1, 'up x1'], [cf6.upBias, num.up6, 'up x0.6'], [-cf1.downBias, num.down, 'down']] as const)
        if (b === null || Math.abs((a as number) - (b as number)) > 1e-9) throw new Error(`closed form != production bisection (h=${h}, sigma=${sd}, ${name}): ${a} vs ${b}`);
      return {dailySigma: sd, upBias_x1: cf1.upBias, upBias_x06: cf6.upBias, downBias_abs: -cf1.downBias,
        upFeasible_all: cf1.upBias <= bAll, upFeasible_x06_all: cf6.upBias <= bAll, downFeasible_all: -cf1.downBias <= bAll,
        upFeasible_priceOnly: cf1.upBias <= bPrice, upFeasible_x06_priceOnly: cf6.upBias <= bPrice, downFeasible_priceOnly: -cf1.downBias <= bPrice,
        clipHalfScaleNeededUp_x1: cf1.upMinHalfScale, clipHalfScaleNeededUp_x06: cf6.upMinHalfScale, clipHalfScaleNeededDown: cf1.downMinHalfScale,
        minDailySigmaForClipUp_x06: 2 * cf6.upMinHalfScale / Math.sqrt(h), minDailySigmaForClipDown: 2 * cf1.downMinHalfScale / Math.sqrt(h)};
    });
    perH.push({h, neutralThresholdPct: thr[h], weightsSum: sum, weightOfPriceOnlyFactors: wPrice, maxAbsBias_allFactors: bAll, maxAbsBias_priceOnly: bPrice, rows});
  }
  return {inputBounds: bounds, tiltMultipliers: mult, perHorizon: perH};
}
if (import.meta.main) { const fs = await import('node:fs'); const r = deriveNeutrality(); fs.writeFileSync(process.argv[2], JSON.stringify(r, null, 1)); console.log(JSON.stringify(r.perHorizon.map((p: any) => ({h: p.h, thr: p.neutralThresholdPct, bPrice: +p.maxAbsBias_priceOnly.toFixed(3), up1: +p.rows[0].upBias_x1.toFixed(3), up06: +p.rows[0].upBias_x06.toFixed(3), down: +p.rows[0].downBias_abs.toFixed(3)})))); }

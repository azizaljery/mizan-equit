// Price-only PUBLISHED engine centre (C_pub) and bias, computed with the production functions (imported, not copied):
// researchFactors -> signals, forecastWeights/adjustedWeights -> weights, bias = sum(signal*weight)/100 with missing factors = 0,
// scenarioCenter -> centre log return. Fundamentals are absent (facts: []), so only price/market-derived factors carry a signal.
// Window: the last WINDOW sessions up to and including t (a research parameter, disclosed in the results).
import {researchFactors, forecastWeights} from '../../lib/research-model';
import {DEFAULT_SETTINGS, adjustedWeights} from '../../lib/site-settings';
import {horizonCondition} from '../../lib/forecast-conditions';
import {scenarioCenter} from '../../lib/forecast-diagnostics';

export const WINDOW = 504;
const dev = (v: number[]) => { if (v.length < 2) return null; const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); };

export type Series = {symbol: string; currency: string; dates: string[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[]};
export function engineAt(s: Series, t: number, horizons: number[]): Record<number, {bias: number; centre: number}> | null {
  const from = Math.max(0, t - WINDOW + 1);
  const prices = [] as any[];
  for (let i = from; i <= t; i++) prices.push({date: s.dates[i], open: s.open[i], high: s.high[i], low: s.low[i], close: s.close[i], volume: s.volume[i]});
  const last = prices[prices.length - 1];
  const report: any = {company: {symbol: s.symbol, name: s.symbol, exchange: 'RESEARCH', sector: 'x', industry: 'x', source: 'research://truncated'}, currency: s.currency,
    asOf: last.date, retrievedAt: last.date + 'T20:00:00.000Z', quoteTime: null, priceSource: 'research://truncated', prices, facts: [], official: null, news: [], peers: [], checks: [], warnings: [], mode: 'historical'};
  const now = Date.parse(last.date + 'T20:00:00Z');
  let rf: any; try { rf = researchFactors(report, now); } catch { return null; }
  const {factors, conditioning} = rf;
  if (!conditioning?.pricesValid) return null;
  const daily = prices.slice(1).map((p, i) => Math.log(p.close / prices[i].close));
  const recent = dev(daily.slice(-63)) ?? 0, long = dev(daily.slice(-252)) ?? recent, short = dev(daily.slice(-20)) ?? recent;
  const out: Record<number, {bias: number; centre: number}> = {};
  for (const h of horizons) {
    const cond = horizonCondition(conditioning, h);
    const weights = adjustedWeights(forecastWeights(h), DEFAULT_SETTINGS);
    const avail = factors.filter((f: any) => f.signal !== null), coverage = avail.reduce((a: number, f: any) => a + weights[f.key], 0);
    const bias = coverage ? avail.reduce((a: number, f: any) => a + f.signal * weights[f.key], 0) / 100 : 0;
    const rets: number[] = []; for (let i = h; i < prices.length; i++) rets.push(Math.log(prices[i].close / prices[i - h].close));
    const emp = dev(rets) ?? 0, base = h <= 21 ? recent : (recent + long) / 2, day = cond.shockWarning ? Math.max(base, short) : base;
    const expectedScale = Math.max(day * Math.sqrt(h), emp);
    if (!(expectedScale > 0)) return null;
    out[h] = {bias, centre: scenarioCenter({bias, sessions: h, dailySigma: day, expectedScale, positiveTiltMultiplier: cond.positiveTiltMultiplier}).centerLogReturn};
  }
  return out;
}

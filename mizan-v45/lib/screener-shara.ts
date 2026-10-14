/**
 * SHARA gate layer for the screener (selection only; forecasts() remains the sole prediction engine).
 *
 * Two pipelines per candidate:
 *  1. PARITY  — the existing eligibility rules (candidateExclusion) re-expressed as veto gates with an audit trail.
 *               It never changes who is selected: tests/shara-screener.test.ts proves survivors == candidateExclusion()===null.
 *  2. MARKET  — NEW financial veto gates (liquidity, zero-volume days, volatility, evidence freshness).
 *               PROVISIONAL: thresholds are engineering defaults, NOT validated on outcomes. They run in SHADOW mode
 *               (recorded, never removing a candidate) until SHARA_ENFORCE_MARKET_GATES is switched on after review.
 *
 * Semantics (owner-proposed SHARA, formerly named VOSA — Veto-Only Survival Architecture): PASS = permission to be ranked only; KILL = veto with proof; SUSPEND = missing/invalid
 * evidence (not rankable, not a permanent rejection); the ranker only ever sees survivors; nothing resurrects a KILL.
 */
import {SharaEngine} from './shara/engine';
import {defineGate, fingerprint, maximumGate, minimumGate, readNumber, readString, readValue} from './shara/gates';
import type {CandidateEvidenceEnvelope, EvidenceRecord, JsonValue, SharaEvaluation, SharaGate, SharaStatus} from './shara/contracts';
import type {ScreenerCandidate} from './screener-policy';
import type {Price} from './analysis';

export const SHARA_SCREENER_VERSION = 'shara-screener-1';
/** Switch to true only after the owner reviews the shadow report. Default keeps selection identical to before. */
export const SHARA_ENFORCE_MARKET_GATES = false;

/** PROVISIONAL thresholds (unvalidated). Kept in one place so a validation study can replace them. */
export const SHARA_MARKET_THRESHOLDS = {
  sa: {minMedianTradedValue: 1_000_000, currency: 'SAR'},
  us: {minMedianTradedValue: 2_000_000, currency: 'USD'},
  maxZeroVolumeDays20: 3,
  maxAtrPct20: 8,
  maxLastBarAgeDays: 7,
} as const;

type Item = {candidate: ScreenerCandidate; report: {prices?: Price[]; retrievedAt?: string}};
export type SharaVerdict = {symbol: string; parity: SharaStatus; parityRule?: string; market: SharaStatus | 'NOT_RUN'; marketRules: string[]};
export type SharaScreenerSummary = {
  version: string; mode: 'shadow' | 'enforce'; provisionalThresholds: true;
  evaluated: number; parityPass: number; marketPass: number; marketKill: number; marketSuspend: number;
  byGate: Record<string, {kill: number; suspend: number}>;
  wouldRemoveSymbols: string[]; removedSymbols: string[]; verdicts: SharaVerdict[];
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/* ---------------- evidence ---------------- */
function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function marketEvidence(prices: Price[] | undefined, retrievedAt: string | undefined): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  if (!Array.isArray(prices) || prices.length < 21) return out; // too short => evidence missing => SUSPEND
  const last21 = prices.slice(-21), last20 = last21.slice(1);
  if (!last21.every((p) => finite(p.close) && finite(p.high) && finite(p.low) && finite(p.volume) && p.close > 0)) return out;
  out.medianTradedValue20 = median(last20.map((p) => p.close * p.volume));
  out.zeroVolumeDays20 = last20.filter((p) => p.volume <= 0).length;
  const tr = last20.map((p, i) => Math.max(p.high - p.low, Math.abs(p.high - last21[i].close), Math.abs(p.low - last21[i].close)));
  out.atrPct20 = (100 * tr.reduce((a, b) => a + b, 0) / tr.length) / prices[prices.length - 1].close;
  const t = Date.parse(retrievedAt ?? ''), b = Date.parse(prices[prices.length - 1].date);
  if (Number.isFinite(t) && Number.isFinite(b)) out.lastBarAgeDays = (t - b) / 86_400_000;
  return out;
}
export function candidateEnvelope(item: Item): CandidateEvidenceEnvelope {
  const c = item.candidate, observedAt = finite(Date.parse(item.report.retrievedAt ?? '')) ? (item.report.retrievedAt as string) : new Date(0).toISOString();
  const values: Record<string, JsonValue> = {};
  const put = (key: string, v: unknown) => {
    if (typeof v === 'string' || typeof v === 'boolean' || finite(v)) values[key] = v as JsonValue;
  };
  put('available', c.available); put('direction', c.direction); put('confidence', c.confidence);
  put('price', c.price); put('predictedPrice', c.predictedPrice); put('expectedChangePct', c.expectedChangePct);
  put('priceTime', c.priceTime); put('currency', c.currency);
  if (Array.isArray(c.range) && c.range.length === 2 && c.range.every(finite)) values.range = [c.range[0], c.range[1]];
  Object.assign(values, marketEvidence(item.report.prices, item.report.retrievedAt));
  const evidence: Record<string, EvidenceRecord> = {};
  for (const [key, value] of Object.entries(values)) {
    evidence[key] = {evidenceId: `${c.symbol}:${key}`, providerId: key in c ? 'screener-candidate' : 'market-report', providerVersion: '1', observedAt, value};
  }
  return {identity: {candidateId: c.symbol, version: 1, payloadHash: fingerprint(values)}, assembledAt: observedAt, evidence};
}

/* ---------------- parity gates (mirror of candidateExclusion, same order) ---------------- */
const kill = (ruleId: string, message: string, observed?: JsonValue, required?: JsonValue) =>
  ({status: 'KILL' as const, findings: [{ruleId, message, ...(observed === undefined ? {} : {observed}), ...(required === undefined ? {} : {required})}]});
const suspend = (finding: {ruleId: string; message: string; observed?: JsonValue; required?: JsonValue}) => ({status: 'SUSPEND' as const, findings: [finding]});
const PASS = {status: 'PASS' as const};

export function parityGates(): SharaGate[] {
  return [
    defineGate({id: 'model_unavailable', description: 'Forecast row must be available', run: (c) => {
      const r = readValue(c, 'available');
      if (!r.ok) return suspend(r.finding);
      return r.value === true ? PASS : suspend({ruleId: 'model_unavailable', message: 'model produced no usable forecast', observed: r.value, required: true});
    }}),
    defineGate({id: 'not_rising', description: 'Screener nominates rising forecasts only', run: (c) => {
      const r = readString(c, 'direction');
      if (!r.ok) return suspend(r.finding);
      return r.value === 'صاعد' ? PASS : kill('not_rising', 'forecast direction is not rising', r.value, 'صاعد');
    }}),
    defineGate({id: 'low_or_unknown_confidence', description: 'Confidence must be medium or high', run: (c) => {
      const r = readString(c, 'confidence');
      if (!r.ok) return suspend(r.finding);
      return ['متوسط', 'مرتفع'].includes(r.value) ? PASS : kill('low_or_unknown_confidence', 'confidence below medium', r.value, ['متوسط', 'مرتفع']);
    }}),
    defineGate({id: 'invalid_range', description: 'Range must be a valid ascending positive pair', run: (c) => {
      const r = readValue(c, 'range');
      if (!r.ok) return suspend(r.finding);
      const v = r.value;
      return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) && (v[0] as number) > 0 && (v[1] as number) > (v[0] as number)
        ? PASS : kill('invalid_range', 'range is not a positive ascending pair', v);
    }}),
    defineGate({id: 'invalid_positive_target', description: 'Target must be above a positive price with positive expected change', run: (c) => {
      const price = readNumber(c, 'price'), target = readNumber(c, 'predictedPrice'), change = readNumber(c, 'expectedChangePct');
      for (const r of [price, target, change]) if (!r.ok) return suspend(r.finding);
      const p = (price as {value: number}).value, t = (target as {value: number}).value, e = (change as {value: number}).value;
      return p > 0 && t > p && e > 0 ? PASS : kill('invalid_positive_target', 'target is not a positive upside', {price: p, predictedPrice: t, expectedChangePct: e});
    }}),
    defineGate({id: 'target_outside_range', description: 'Target must lie inside the range', run: (c) => {
      const target = readNumber(c, 'predictedPrice'), range = readValue(c, 'range');
      if (!target.ok) return suspend(target.finding);
      if (!range.ok) return suspend(range.finding);
      const v = range.value as number[];
      return Array.isArray(v) && target.value >= v[0] && target.value <= v[1] ? PASS : kill('target_outside_range', 'target outside forecast range', target.value, v as JsonValue);
    }}),
    defineGate({id: 'inconsistent_target', description: 'expectedChangePct must equal the change implied by price and target', run: (c) => {
      const price = readNumber(c, 'price'), target = readNumber(c, 'predictedPrice'), change = readNumber(c, 'expectedChangePct');
      for (const r of [price, target, change]) if (!r.ok) return suspend(r.finding);
      const p = (price as {value: number}).value, t = (target as {value: number}).value, e = (change as {value: number}).value;
      const actual = 100 * (t / p - 1);
      return Math.abs(actual - e) > Math.max(0.00001, Math.abs(actual) * 0.000001)
        ? kill('inconsistent_target', 'expectedChangePct disagrees with price and target', e, actual) : PASS;
    }}),
    defineGate({id: 'missing_price_provenance', description: 'Price time and supported currency are required', run: (c) => {
      const time = readString(c, 'priceTime'), currency = readString(c, 'currency');
      if (!time.ok) return suspend(time.finding);
      if (!currency.ok) return suspend(currency.finding);
      return Number.isFinite(Date.parse(time.value)) && ['SAR', 'USD'].includes(currency.value)
        ? PASS : kill('missing_price_provenance', 'price time or currency invalid', {priceTime: time.value, currency: currency.value});
    }}),
  ];
}

/* ---------------- market gates (PROVISIONAL, shadow by default) ---------------- */
export function marketGates(market: 'sa' | 'us'): SharaGate[] {
  const t = SHARA_MARKET_THRESHOLDS;
  return [
    defineGate({id: 'fresh_price_series', description: 'Last bar must be recent; stale evidence suspends (never kills)', config: {maxAgeDays: t.maxLastBarAgeDays}, run: (c) => {
      const r = readNumber(c, 'lastBarAgeDays');
      if (!r.ok) return suspend(r.finding);
      return r.value <= t.maxLastBarAgeDays ? PASS : suspend({ruleId: 'fresh_price_series', message: 'last bar is stale', observed: r.value, required: t.maxLastBarAgeDays});
    }}),
    minimumGate('liquidity_min_traded_value', 'medianTradedValue20', t[market].minMedianTradedValue, `Median daily traded value (20 sessions) in ${t[market].currency}`),
    maximumGate('liquidity_zero_volume_days', 'zeroVolumeDays20', t.maxZeroVolumeDays20, 'Zero-volume sessions in the last 20'),
    maximumGate('risk_atr_pct', 'atrPct20', t.maxAtrPct20, 'ATR(20) as % of last close'),
  ];
}

/* ---------------- orchestration ---------------- */
const emptySummary = (enforce: boolean): SharaScreenerSummary => ({
  version: SHARA_SCREENER_VERSION, mode: enforce ? 'enforce' : 'shadow', provisionalThresholds: true,
  evaluated: 0, parityPass: 0, marketPass: 0, marketKill: 0, marketSuspend: 0, byGate: {}, wouldRemoveSymbols: [], removedSymbols: [], verdicts: [],
});
const lastRule = (e: SharaEvaluation) => e.gateResults.at(-1)?.gateId;

export async function evaluateScreenerShara(items: Item[], enforce = SHARA_ENFORCE_MARKET_GATES): Promise<{summary: SharaScreenerSummary; removed: Set<string>}> {
  const parity = new SharaEngine(parityGates(), {pipelineId: 'screener-parity', pipelineVersion: SHARA_SCREENER_VERSION});
  const markets = {
    sa: new SharaEngine(marketGates('sa'), {pipelineId: 'screener-market-sa', pipelineVersion: SHARA_SCREENER_VERSION}),
    us: new SharaEngine(marketGates('us'), {pipelineId: 'screener-market-us', pipelineVersion: SHARA_SCREENER_VERSION}),
  };
  const summary = emptySummary(enforce), removed = new Set<string>();
  for (const item of items) {
    const envelope = candidateEnvelope(item), symbol = item.candidate.symbol;
    const p = await parity.evaluate(envelope);
    const verdict: SharaVerdict = {symbol, parity: p.finalStatus, market: 'NOT_RUN', marketRules: []};
    summary.evaluated++;
    if (p.finalStatus === 'PASS') {
      summary.parityPass++;
      const m = await markets[item.candidate.market === 'sa' ? 'sa' : 'us'].evaluate(envelope);
      verdict.market = m.finalStatus;
      verdict.marketRules = m.gateResults.filter((g) => g.status !== 'PASS').map((g) => g.gateId);
      if (m.finalStatus === 'PASS') summary.marketPass++;
      else {
        if (m.finalStatus === 'KILL') summary.marketKill++; else summary.marketSuspend++;
        const gate = lastRule(m) ?? 'unknown', slot = (summary.byGate[gate] ??= {kill: 0, suspend: 0});
        if (m.finalStatus === 'KILL') slot.kill++; else slot.suspend++;
        summary.wouldRemoveSymbols.push(symbol);
        if (enforce) {removed.add(symbol); summary.removedSymbols.push(symbol);}
      }
    } else verdict.parityRule = lastRule(p);
    summary.verdicts.push(verdict);
  }
  summary.verdicts = summary.verdicts.slice(0, 200);
  return {summary, removed};
}

export function mergeSharaSummaries(a?: SharaScreenerSummary, b?: SharaScreenerSummary): SharaScreenerSummary | undefined {
  if (!a || !b) return b ?? a;
  const byGate: SharaScreenerSummary['byGate'] = {};
  for (const src of [a.byGate, b.byGate]) for (const [k, v] of Object.entries(src)) {
    const slot = (byGate[k] ??= {kill: 0, suspend: 0}); slot.kill += v.kill; slot.suspend += v.suspend;
  }
  return {
    ...b, evaluated: a.evaluated + b.evaluated, parityPass: a.parityPass + b.parityPass, marketPass: a.marketPass + b.marketPass,
    marketKill: a.marketKill + b.marketKill, marketSuspend: a.marketSuspend + b.marketSuspend, byGate,
    wouldRemoveSymbols: [...a.wouldRemoveSymbols, ...b.wouldRemoveSymbols].slice(0, 200),
    removedSymbols: [...a.removedSymbols, ...b.removedSymbols].slice(0, 200),
    verdicts: [...a.verdicts, ...b.verdicts].slice(0, 200),
  };
}

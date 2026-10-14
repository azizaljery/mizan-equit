import test from 'node:test';
import assert from 'node:assert/strict';
import {SharaEngine} from '../lib/shara/engine';
import {defineGate, maximumGate, minimumGate} from '../lib/shara/gates';
import type {CandidateEvidenceEnvelope, EvidenceRecord, JsonValue, SharaGate} from '../lib/shara/contracts';
import {candidateEnvelope, evaluateScreenerShara, marketEvidence, mergeSharaSummaries, parityGates, SHARA_MARKET_THRESHOLDS} from '../lib/screener-shara';
import {candidateExclusion, mergeScreenerResults, type ScreenerCandidate} from '../lib/screener-policy';
import type {Price} from '../lib/analysis';

const env = (id: string, values: Record<string, JsonValue>, version = 1): CandidateEvidenceEnvelope => ({
  identity: {candidateId: id, version, payloadHash: 'h'}, assembledAt: '2026-01-01T00:00:00.000Z',
  evidence: Object.fromEntries(Object.entries(values).map(([k, value]): [string, EvidenceRecord] =>
    [k, {evidenceId: `${id}:${k}`, providerId: 'test', providerVersion: '1', observedAt: '2026-01-01T00:00:00.000Z', value}])),
});
const engine = (gates: SharaGate[], mode: 'EXECUTION' | 'AUDIT' = 'EXECUTION') => new SharaEngine(gates, {pipelineId: 't', pipelineVersion: '1', mode});

/* ---------- engine semantics (archive test list 1-14) ---------- */
test('PASS only when every gate passes; first KILL stops the pipeline', async () => {
  const gates = [maximumGate('A', 'x', 1, 'x<=1'), minimumGate('B', 'y', 1, 'y>=1')];
  assert.equal((await engine(gates).evaluate(env('c', {x: 0, y: 2}))).finalStatus, 'PASS');
  const e = await engine(gates).evaluate(env('c', {x: 2, y: 0}));
  assert.equal(e.finalStatus, 'KILL');
  assert.equal(e.gateResults.length, 1);
  assert.equal(e.auditTrail.length, 1);
});
test('KILL carries proof; a KILL without proof fails closed to SUSPEND', async () => {
  const e = await engine([maximumGate('A', 'x', 1, 'x<=1')]).evaluate(env('c', {x: 5}));
  assert.deepEqual(e.gateResults[0].findings[0].observed, 5);
  const bad: SharaGate = {gateId: 'NOPROOF', gateVersion: '1', pure: true, configHash: 'x', evaluate: () => ({gateId: 'NOPROOF', gateVersion: '1', status: 'KILL', findings: []})};
  const r = await engine([bad]).evaluate(env('c', {}));
  assert.equal(r.finalStatus, 'SUSPEND');
  assert.equal(r.gateResults[0].findings[0].ruleId, 'KILL-WITHOUT-PROOF');
});
test('NaN / Infinity / missing evidence => SUSPEND, never PASS, never an exception', async () => {
  const g = [maximumGate('A', 'x', 1, 'x<=1')];
  for (const v of [Number.NaN, Infinity, -Infinity]) assert.equal((await engine(g).evaluate(env('c', {x: v as unknown as number}))).finalStatus, 'SUSPEND');
  assert.equal((await engine(g).evaluate(env('c', {}))).finalStatus, 'SUSPEND');
  assert.equal((await engine(g).evaluate(env('c', {x: 'bad'}))).finalStatus, 'SUSPEND');
});
test('SUSPEND never reaches the ranker; KILLed candidates never return; survivors only are ranked', async () => {
  const seen: string[] = [];
  const sel = await engine([maximumGate('A', 'x', 1, 'x<=1')]).select(
    [env('ok1', {x: 0, s: 5}), env('killed', {x: 9, s: 999}), env('susp', {s: 998}), env('ok2', {x: 1, s: 7})],
    (c) => {seen.push(c.identity.candidateId); return c.evidence.s.value as number;});
  assert.deepEqual(seen.sort(), ['ok1', 'ok2']);
  assert.deepEqual(sel.ranking.map((r) => r.candidate.identity.candidateId), ['ok2', 'ok1']);
});
test('no least-bad fallback: empty survivor set stays empty', async () => {
  const sel = await engine([maximumGate('A', 'x', 1, 'x<=1')]).select([env('a', {x: 5}), env('b', {x: 6})], () => 1);
  assert.equal(sel.ranking.length, 0);
});
test('new immutable version is evaluated from scratch; KILL on v1 is not inherited by v2', async () => {
  const e = engine([maximumGate('A', 'x', 1, 'x<=1')]);
  assert.equal((await e.evaluate(env('c', {x: 5}, 1))).finalStatus, 'KILL');
  assert.equal((await e.evaluate(env('c', {x: 0}, 2))).finalStatus, 'PASS');
});
test('non-finite rank score is a hard error; gate identity conflict and exceptions fail closed', async () => {
  await assert.rejects(engine([maximumGate('A', 'x', 1, 'x<=1')]).select([env('a', {x: 0})], () => Number.NaN), /non-finite/);
  const liar: SharaGate = {gateId: 'L', gateVersion: '1', pure: true, configHash: 'x', evaluate: () => ({gateId: 'OTHER', gateVersion: '1', status: 'PASS', findings: []})};
  assert.equal((await engine([liar]).evaluate(env('c', {}))).finalStatus, 'SUSPEND');
  const boom: SharaGate = {gateId: 'B', gateVersion: '1', pure: true, configHash: 'x', evaluate: () => {throw new Error('boom');}};
  assert.equal((await engine([boom]).evaluate(env('c', {}))).finalStatus, 'SUSPEND');
});
test('duplicate gate identity and impure gates in AUDIT mode are rejected; AUDIT runs every gate with KILL precedence', () => {
  assert.throws(() => engine([maximumGate('A', 'x', 1, 'd'), maximumGate('A', 'x', 1, 'd')]), /Duplicate/);
  const impure: SharaGate = {...maximumGate('I', 'x', 1, 'd'), pure: false};
  assert.throws(() => engine([impure], 'AUDIT'), /AUDIT/);
});
test('AUDIT mode runs all gates and final status uses KILL > SUSPEND > PASS; audit export is valid JSON', async () => {
  const rows: unknown[] = [];
  const e = new SharaEngine([maximumGate('A', 'x', 1, 'd'), minimumGate('B', 'y', 1, 'd')], {pipelineId: 't', pipelineVersion: '1', mode: 'AUDIT', auditSink: {append: (ev) => {rows.push(ev);}}});
  const r = await e.evaluate(env('c', {x: 2}));
  assert.equal(r.gateResults.length, 2);
  assert.equal(r.finalStatus, 'KILL');
  assert.equal(rows.length, 2);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(rows)));
});
test('envelope with non-finite evidence is SUSPENDed before any gate runs (fail closed, no throw)', async () => {
  const bad = env('c', {x: 0});
  (bad.evidence.x as {value: unknown}).value = Number.NaN;
  const r = await engine([maximumGate('A', 'x', 1, 'd')]).evaluate(bad);
  assert.equal(r.finalStatus, 'SUSPEND');
  assert.equal(r.gateResults[0].findings[0].ruleId, 'NON-FINITE-OR-INVALID-EVIDENCE');
});

/* ---------- screener parity: SHARA survivors == candidateExclusion()===null ---------- */
const base = (over: Partial<ScreenerCandidate> = {}): ScreenerCandidate => ({
  symbol: 'T', name: 'Fixture', market: 'us', exchange: 'NASDAQ', currency: 'USD', price: 100, predictedPrice: 110, direction: 'صاعد',
  expectedChangePct: 10, range: [90, 120], confidence: 'مرتفع', dataQuality: 'جيدة', coverage: 80, sample: 40, independent: 10, riskLevel: 'متوسط', available: true,
  reasons: [], basis: [], risks: [], invalidation: [], priceTime: '2026-01-01T10:00:00.000Z', retrievedAt: '2026-01-01T10:00:00.000Z', source: 'fixture', ...over,
});
const variants: Partial<ScreenerCandidate>[] = [
  {}, {available: false}, {direction: 'هابط'}, {direction: 'محايد'}, {direction: 'غير متاح'}, {confidence: 'منخفض'}, {confidence: 'متوسط'}, {confidence: 'غير متاحة'},
  {range: null}, {range: [100, 90]}, {range: [0, 120]}, {range: [Number.NaN, 120]}, {price: null}, {price: 0}, {price: -5}, {predictedPrice: null}, {predictedPrice: 100}, {predictedPrice: 99},
  {expectedChangePct: null}, {expectedChangePct: 0}, {expectedChangePct: 9.9}, {expectedChangePct: 10.0000001}, {predictedPrice: 130, expectedChangePct: 30},
  {predictedPrice: 85, expectedChangePct: -15}, {priceTime: ''}, {priceTime: 'nonsense'}, {currency: 'EUR'}, {currency: 'SAR'}, {price: Number.POSITIVE_INFINITY},
];
test('SHARA parity gates select exactly the candidates candidateExclusion() keeps (29 variants)', async () => {
  const e = engine(parityGates());
  for (const v of variants) {
    const c = base(v), expected = candidateExclusion(c) === null;
    const r = await e.evaluate(candidateEnvelope({candidate: c, report: {prices: [], retrievedAt: c.retrievedAt}}));
    assert.equal(r.finalStatus === 'PASS', expected, `variant ${JSON.stringify(v)} => ${r.finalStatus} vs exclusion ${candidateExclusion(c)}`);
  }
});

/* ---------- market gates ---------- */
const bars = (n: number, over: Partial<Price> = {}, startClose = 100): Price[] => Array.from({length: n}, (_, i) => {
  const d = new Date(Date.UTC(2025, 11, 31) - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10);
  return {date: d, open: startClose, high: startClose * 1.01, low: startClose * 0.99, close: startClose, volume: 100_000, ...over};
});
const report = (prices: Price[]) => ({prices, retrievedAt: '2026-01-01T10:00:00.000Z'});

test('market evidence: traded value, zero-volume days, ATR% and age are computed from completed bars', () => {
  const m = marketEvidence(bars(40), '2026-01-01T10:00:00.000Z');
  assert.equal(m.medianTradedValue20, 100 * 100_000);
  assert.equal(m.zeroVolumeDays20, 0);
  assert.ok(Math.abs((m.atrPct20 as number) - 2) < 1e-9);
  assert.ok(Math.abs((m.lastBarAgeDays as number) - 1.4166666) < 0.01);
  assert.deepEqual(marketEvidence(bars(20), '2026-01-01T10:00:00.000Z'), {});
});
test('liquid, calm, fresh candidate survives; illiquid one is vetoed with proof (shadow keeps it, enforce removes it)', async () => {
  const good = {candidate: base({symbol: 'GOOD'}), report: report(bars(40))};
  const thin = {candidate: base({symbol: 'THIN'}), report: report(bars(40, {volume: 10}))};
  const shadow = await evaluateScreenerShara([good, thin], false);
  assert.equal(shadow.summary.mode, 'shadow');
  assert.equal(shadow.removed.size, 0);
  assert.deepEqual(shadow.summary.wouldRemoveSymbols, ['THIN']);
  assert.equal(shadow.summary.byGate.liquidity_min_traded_value.kill, 1);
  const enforce = await evaluateScreenerShara([good, thin], true);
  assert.deepEqual([...enforce.removed], ['THIN']);
  assert.equal(enforce.summary.marketPass, 1);
});
test('missing price history => SUSPEND (not rankable, not a permanent rejection); stale last bar => SUSPEND', async () => {
  const none = await evaluateScreenerShara([{candidate: base({symbol: 'NOHIST'}), report: {prices: [], retrievedAt: '2026-01-01T10:00:00.000Z'}}], false);
  assert.equal(none.summary.marketSuspend, 1);
  const stale = await evaluateScreenerShara([{candidate: base({symbol: 'OLD'}), report: report(bars(40).map((p, i, a) => ({...p, date: new Date(Date.parse(a[i].date) - 30 * 86_400_000).toISOString().slice(0, 10)})))}], false);
  assert.equal(stale.summary.byGate.fresh_price_series.suspend, 1);
});
test('volatility veto uses ATR% and a candidate failing parity is never sent to market gates', async () => {
  const wild = {candidate: base({symbol: 'WILD'}), report: report(bars(40, {high: 130, low: 70}))};
  const r1 = await evaluateScreenerShara([wild], false);
  assert.equal(r1.summary.byGate.risk_atr_pct.kill, 1);
  const falling = {candidate: base({symbol: 'DOWN', direction: 'هابط'}), report: report(bars(40))};
  const r2 = await evaluateScreenerShara([falling], false);
  assert.equal(r2.summary.verdicts[0].market, 'NOT_RUN');
  assert.equal(r2.summary.verdicts[0].parityRule, 'not_rising');
});
test('Saudi candidates use the SAR threshold; summaries merge additively', async () => {
  assert.equal(SHARA_MARKET_THRESHOLDS.sa.currency, 'SAR');
  const a = (await evaluateScreenerShara([{candidate: base({symbol: '1010.SR', market: 'sa', currency: 'SAR'}), report: report(bars(40, {volume: 5}))}], false)).summary;
  const b = (await evaluateScreenerShara([{candidate: base({symbol: 'GOOD'}), report: report(bars(40))}], false)).summary;
  const m = mergeSharaSummaries(a, b)!;
  assert.equal(m.evaluated, 2);
  assert.equal(m.marketKill, 1);
  assert.equal(m.marketPass, 1);
});
test('gate configuration hash changes when a threshold changes (audit can tell versions apart)', () => {
  const g1 = defineGate({id: 'G', description: 'd', config: {max: 1}, run: () => ({status: 'PASS'})});
  const g2 = defineGate({id: 'G', description: 'd', config: {max: 2}, run: () => ({status: 'PASS'})});
  assert.notEqual(g1.configHash, g2.configHash);
});

/* ---------- rename compatibility (VOSA -> SHARA) ---------- */
test('legacy archives that carry the summary under the old "vosa" key still merge, and output uses only "shara"', async () => {
  const summary = (await evaluateScreenerShara([], false)).summary;
  const base = {modelVersion: 'm', market: 'sa', horizonSessions: 21, requestedResultCount: 5, scanned: 1, analyzed: 1, eligible: 0, failed: 0, excluded: 0, returned: 0, missingCount: 5, candidates: [], failures: [], exclusionCounts: {}, durationMs: 1};
  const merged = mergeScreenerResults({...base, vosa: summary} as never, {...base, vosa: summary} as never) as unknown as Record<string, unknown>;
  assert.ok(merged.shara, 'merged summary is stored under the new key');
  assert.equal(JSON.stringify(merged).includes('"vosa"'), false, 'legacy key is never written');
});

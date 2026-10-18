/**
 * Unit + offline integration tests for the agent-picks pipeline.
 *   node --test research/tests/agent-picks.test.mjs
 * No network: Yahoo and the live analyze endpoint are replaced by fakes. CODE-TESTED status only — passing these
 * tests says nothing about predictive quality.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../experiments/agent-picks-lib.mjs';
import { runAgentPicks, analyzeWithRetry, writeExclusive } from '../experiments/agent-picks-run.mjs';
import { evaluateAll, decideOutcome, cmpRunName, pendingEntries, readRuns } from '../experiments/agent-picks-evaluate.mjs';
import { runMonthly, previousMonth, abstentionReasons, proposedExperiments } from '../experiments/agent-picks-monthly.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-picks-'));
const noSleep = async () => {};

// ------------------------------------------------------------------ synthetic data
function sessions(market, end, n) {
  const out = []; let d = end;
  while (out.length < n) { if (!L.WEEKEND[market].includes(L.weekday(d))) out.unshift(d); d = L.addDays(d, -1); }
  return out;
}
function chartJson(symbol, market, dates, closes, { splits = [], meta = {} } = {}) {
  const hour = market === 'sa' ? 'T09:00:00Z' : 'T15:00:00Z';
  const exch = market === 'sa' ? 'SAU' : symbol === 'SPY' ? 'PCX' : 'NMS';
  return {
    chart: {
      result: [{
        meta: { symbol, currency: market === 'sa' ? 'SAR' : 'USD', exchangeName: exch, instrumentType: symbol === 'SPY' ? 'ETF' : 'EQUITY', dataGranularity: '1d', regularMarketTime: Date.parse(dates[dates.length - 1] + hour) / 1000, ...meta },
        timestamp: dates.map((d) => Date.parse(d + hour) / 1000),
        indicators: { quote: [{ close: closes }] },
        events: splits.length ? { splits: Object.fromEntries(splits.map((d) => [String(Date.parse(d + hour) / 1000), { date: Date.parse(d + hour) / 1000, numerator: 2, denominator: 1 }])) } : undefined,
      }],
      error: null,
    },
  };
}
/** Fake Yahoo: series(symbol) → {dates, closes} or null (404). */
function fakeNet(series, calls = []) {
  return {
    async get(url) {
      calls.push(url);
      const sym = decodeURIComponent(url.match(/chart\/([^?]+)/)[1]);
      const market = sym.endsWith('.SR') ? 'sa' : 'us';
      const s = series(sym);
      if (!s) return { status: 404, text: '{"chart":{"result":null,"error":{"code":"Not Found"}}}' };
      return { status: 200, text: JSON.stringify(chartJson(sym, market, s.dates, s.closes, s)) };
    },
  };
}
function forecastResponse(symbol, { price = 100, priceTime = '2026-10-18T07:15:00.000Z', dirs = { 1: 'صاعد', 5: 'محايد', 21: 'هابط' }, version = 'mizan-scenarios-7-abcd' } = {}) {
  const rows = [1, 5, 21, 63].map((h) => {
    const d = dirs[h] || 'محايد';
    if (d === 'غير متاح') return { sessions: h, period: 'x', available: false, direction: d, price, range: null, confidence: 'منخفض', reasons: ['السيولة أقل من الحد المطلوب أو غير متاحة.'], window: { anchorDate: '2026-10-18', estimatedEndAt: '2026-10-19T12:00:00.000Z' } };
    const pct = d === 'صاعد' ? 1 : d === 'هابط' ? -1 : 0;
    return { sessions: h, period: 'x', available: true, direction: d, price, predictedPrice: price * (1 + pct / 100), expectedChangePct: pct, neutralThresholdPct: L.NEUTRAL_THRESHOLD_PCT[h] ?? 0.5, range: [price * 0.95, price * 1.05], confidence: 'منخفض', window: { anchorDate: '2026-10-18', estimatedEndAt: '2026-10-19T12:00:00.000Z' } };
  });
  return { company: { symbol }, forecast: { createdAt: '2026-10-18T07:20:00Z', version, price, currency: 'SAR', priceTime, rows, recorded: true, snapshotId: 'snap-' + symbol } };
}

// ------------------------------------------------------------------ universe parity
test('universe copy equals the frozen mizan-v45/lib/daily-picks-universe.ts', () => {
  const ts = fs.readFileSync(path.join(ROOT, 'mizan-v45/lib/daily-picks-universe.ts'), 'utf8');
  const sa = ts.match(/SA_UNIVERSE=Object\.freeze\(\[([\s\S]*?)\]\.map/)[1].match(/'(\d+)'/g).map((s) => s.slice(1, -1) + '.SR');
  const us = ts.match(/US_UNIVERSE=Object\.freeze\(\[([\s\S]*?)\]\)/)[1].match(/'([A-Z.]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual([...L.SA_UNIVERSE], sa);
  assert.deepEqual([...L.US_UNIVERSE], us);
  assert.equal(sa.length, 40); assert.equal(us.length, 40);
});

// ------------------------------------------------------------------ momentum / ranking / selection
test('mom126_5 uses close[t-5]/close[t-131]-1 and needs 132 bars', () => {
  const bars = Array.from({ length: 140 }, (_, i) => ({ date: L.addDays('2026-01-01', i), close: 100 + i }));
  const m = L.momentum126_5(bars);
  assert.equal(m.value, bars[134].close / bars[8].close - 1); // n=140: t=139, t-5=134, t-131=8
  assert.equal(m.t, bars[139].date);
  assert.equal(L.momentum126_5(bars.slice(0, 131)).value, null);
  assert.equal(L.momentum126_5(bars.slice(0, 131)).reason, 'insufficient_history');
  assert.notEqual(L.momentum126_5(bars.slice(0, 132)).value, null);
});

test('ranking: descending, deterministic ties, percentile, top 20%, exclusions', () => {
  const items = [{ symbol: 'B', value: 0.1 }, { symbol: 'A', value: 0.1 }, { symbol: 'C', value: 0.3 }, { symbol: 'D', value: null, reason: 'chart_not_found' }, { symbol: 'E', value: -0.2 }];
  const r = L.rankByMomentum(items);
  assert.deepEqual(r.ranked.map((x) => x.symbol), ['C', 'A', 'B', 'E']);
  assert.deepEqual(r.ranked.map((x) => x.rank), [1, 2, 3, 4]);
  assert.equal(r.ranked[0].percentile, 100); assert.equal(r.ranked[3].percentile, 0);
  assert.deepEqual(r.ranked.map((x) => x.top20), [true, false, false, false]); // ceil(4*0.2)=1
  assert.deepEqual(r.excluded, [{ symbol: 'D', reason: 'chart_not_found' }]);
  assert.deepEqual(L.selectPicks(r, 2, ['A', 'B', 'C', 'D', 'E']), ['C', 'A']);
  assert.deepEqual(L.selectPicks(r, 5, ['A', 'B', 'C', 'D', 'E']), ['C', 'A', 'B', 'E', 'D']); // whole universe, unranked last
});

// ------------------------------------------------------------------ parsing / identity
test('parseChart validates identity and converts to exchange-local dates', () => {
  const j = chartJson('2222.SR', 'sa', ['2026-10-15', '2026-10-16'], [27, null]);
  const p = L.parseChart(j, '2222.SR', 'sa');
  assert.deepEqual(p.bars, [{ date: '2026-10-15', close: 27 }]); // null close dropped
  assert.throws(() => L.parseChart(j, '1120.SR', 'sa'), L.IdentityError);
  const bad = chartJson('2222.SR', 'sa', ['2026-10-15'], [27], { meta: { currency: 'USD' } });
  assert.throws(() => L.parseChart(bad, '2222.SR', 'sa'), /currency/);
  const idx = chartJson('AAPL', 'us', ['2026-10-15'], [1], { meta: { instrumentType: 'INDEX' } });
  assert.throws(() => L.parseChart(idx, 'AAPL', 'us'), /instrument_type/);
  // a US bar at 23:30 UTC is still the same New York date
  const late = { chart: { result: [{ meta: { symbol: 'SPY', currency: 'USD', exchangeName: 'PCX', instrumentType: 'ETF' }, timestamp: [Date.parse('2026-10-16T23:30:00Z') / 1000], indicators: { quote: [{ close: [500] }] } }] } };
  assert.equal(L.parseChart(late, 'SPY', 'us').bars[0].date, '2026-10-16');
});

test('fetchChart: retries 5xx, final on 404, never throws', async () => {
  let n = 0;
  const flaky = { async get() { n++; return n < 3 ? { status: 503, text: '' } : { status: 200, text: JSON.stringify(chartJson('KO', 'us', ['2026-10-16'], [60])) }; } };
  const r = await L.fetchChart({ net: flaky, symbol: 'KO', market: 'us', sleep: noSleep });
  assert.equal(r.ok, true); assert.equal(r.attempts, 3);
  const nf = await L.fetchChart({ net: fakeNet(() => null), symbol: 'KO', market: 'us', sleep: noSleep });
  assert.equal(nf.ok, false); assert.equal(nf.reason, 'not_found'); assert.equal(nf.final, true); assert.equal(nf.attempts, 1);
  const thrower = { async get() { const e = new Error('t'); e.name = 'TimeoutError'; throw e; } };
  const t = await L.fetchChart({ net: thrower, symbol: 'KO', market: 'us', sleep: noSleep });
  assert.equal(t.reason, 'timeout'); assert.equal(t.attempts, 4);
});

// ------------------------------------------------------------------ analyze extraction
test('extractForecasts reads horizons 1/5/21 from the analyze response', () => {
  const ex = L.extractForecasts(forecastResponse('2222.SR', { dirs: { 1: 'صاعد', 5: 'غير متاح', 21: 'هابط' } }));
  assert.equal(ex.ok, true);
  assert.equal(ex.modelVersion, 'mizan-scenarios-7-abcd');
  assert.deepEqual(Object.keys(ex.forecasts), ['1', '5', '21']);
  assert.equal(ex.forecasts[1].direction, 'صاعد');
  assert.equal(ex.forecasts[1].price, 100);
  assert.equal(ex.forecasts[1].predictedPrice, 101);
  assert.deepEqual(ex.forecasts[1].range, [95, 105]);
  assert.equal(ex.forecasts[1].estimatedEndAt, '2026-10-19T12:00:00.000Z');
  assert.equal(ex.forecasts[1].priceTime, '2026-10-18T07:15:00.000Z');
  assert.equal(ex.forecasts[5].available, false);
  assert.equal(ex.forecasts[5].predictedPrice, null);
  assert.equal(ex.forecasts[5].reasons.length, 1);
  assert.equal(L.extractForecasts({ error: 'رمز غير صالح.' }).reason, 'api_error');
  const partial = forecastResponse('X'); partial.forecast.rows = partial.forecast.rows.filter((r) => r.sessions !== 21);
  assert.equal(L.extractForecasts(partial).forecasts[21].missingRow, true);
});

test('refDateOf converts an ISO instant to the exchange date', () => {
  assert.equal(L.refDateOf('2026-10-16', 'sa'), '2026-10-16');
  assert.equal(L.refDateOf('2026-10-18T22:30:00Z', 'sa'), '2026-10-19'); // 01:30 Riyadh next day
  assert.equal(L.refDateOf('2026-10-19T02:00:00Z', 'us'), '2026-10-18'); // 22:00 New York
  assert.equal(L.refDateOf('', 'us'), null);
});

test('analyzeWithRetry: 5xx retried up to 2 times, 4xx final, timeout retried', async () => {
  let n = 0;
  const r1 = await analyzeWithRetry({ analyze: async () => { n++; return n < 3 ? { status: 502, text: 'bad gateway' } : { status: 200, text: '{"forecast":{"rows":[]}}' }; }, symbol: 'X', sleep: noSleep });
  assert.equal(r1.ok, true); assert.equal(r1.attempts, 3);
  let m = 0;
  const r2 = await analyzeWithRetry({ analyze: async () => { m++; return { status: 503, text: '' }; }, symbol: 'X', sleep: noSleep });
  assert.equal(r2.ok, false); assert.equal(m, 3); assert.equal(r2.reason, 'http_503');
  const r3 = await analyzeWithRetry({ analyze: async () => ({ status: 422, text: '{"error":"رمز غير صالح."}' }), symbol: 'X', sleep: noSleep });
  assert.equal(r3.attempts, 1); assert.equal(r3.detail, 'رمز غير صالح.');
  const r4 = await analyzeWithRetry({ analyze: async () => { const e = new Error(); e.name = 'TimeoutError'; throw e; }, symbol: 'X', sleep: noSleep });
  assert.equal(r4.reason, 'timeout'); assert.equal(r4.attempts, 3);
});

// ------------------------------------------------------------------ calendar / outcomes
test('targetSession = h-th session strictly after the reference date', () => {
  const cal = ['2026-10-15', '2026-10-18', '2026-10-19', '2026-10-20'];
  assert.equal(L.targetSession(cal, '2026-10-18', 1), '2026-10-19');
  assert.equal(L.targetSession(cal, '2026-10-17', 1), '2026-10-18'); // non-session reference date
  assert.equal(L.targetSession(cal, '2026-10-18', 2), '2026-10-20');
  assert.equal(L.targetSession(cal, '2026-10-18', 3), null);
});

test('evaluateOutcome uses the model neutral thresholds and conservative unavailability', () => {
  const e = (direction, extra = {}) => ({ direction, available: direction !== 'غير متاح', price: 100, predictedPrice: 101, range: [95, 105], ...extra });
  const o1 = L.evaluateOutcome({ entry: e('صاعد'), h: 1, refDate: 'a', targetDate: 'b', actual: { close: 100.05, date: 'b' } });
  assert.equal(o1.actualDirection, 'محايد'); // +0.05% < 0.1%
  assert.equal(o1.directionCorrect, false); assert.equal(o1.hit, true); assert.equal(o1.rose, true);
  const o5 = L.evaluateOutcome({ entry: e('محايد'), h: 5, refDate: 'a', targetDate: 'b', actual: { close: 100.2, date: 'b' } });
  assert.equal(o5.actualDirection, 'محايد'); assert.equal(o5.directionCorrect, true); assert.equal(o5.hit, null);
  const o21 = L.evaluateOutcome({ entry: e('هابط'), h: 21, refDate: 'a', targetDate: 'b', actual: { close: 99.4, date: 'b' } });
  assert.equal(o21.actualDirection, 'هابط'); assert.equal(o21.directionCorrect, true); assert.equal(o21.inRange, true);
  const na = L.evaluateOutcome({ entry: e('غير متاح'), h: 5, refDate: 'a', targetDate: 'b', actual: { close: 110, date: 'b' } });
  assert.equal(na.directionCorrect, null); assert.equal(na.rose, true); assert.equal(na.inRange, false);
  const gone = L.evaluateOutcome({ entry: e('صاعد'), h: 5, refDate: 'a', targetDate: 'b', actual: null });
  assert.equal(gone.status, 'unavailable'); assert.equal(gone.hit, false); assert.equal(gone.rose, false); assert.equal(gone.directionCorrect, null);
});

test('decideOutcome: waits before maturity, needs a final close, unavailable only late and with a healthy provider', () => {
  const cal = sessions('sa', '2026-11-12', 40);
  const p = { h: 1, refDate: '2026-10-18', entry: { direction: 'صاعد', available: true, price: 100 } };
  const chart = { ok: true, parsed: { bars: [{ date: '2026-10-19', close: 101 }], splits: [] } };
  assert.equal(decideOutcome({ p, calendar: cal, todayLocal: '2026-10-19', chart, providerHealthy: true }), null); // target is today → not final
  const o = decideOutcome({ p, calendar: cal, todayLocal: '2026-10-20', chart, providerHealthy: true });
  assert.equal(o.actualPrice, 101); assert.equal(o.targetDate, '2026-10-19');
  const empty = { ok: true, parsed: { bars: [], splits: [] } };
  assert.equal(decideOutcome({ p, calendar: cal.filter((d) => d <= '2026-10-25'), todayLocal: '2026-10-26', chart: empty, providerHealthy: true }), null); // < 10 sessions after
  assert.equal(decideOutcome({ p, calendar: cal, todayLocal: '2026-11-13', chart: empty, providerHealthy: false }), null); // outage
  assert.equal(decideOutcome({ p, calendar: cal, todayLocal: '2026-11-13', chart: empty, providerHealthy: true }).status, 'unavailable');
  assert.equal(decideOutcome({ p, calendar: cal, todayLocal: '2026-11-13', chart: { ok: false, reason: 'rate_limited' }, providerHealthy: true }), null);
  assert.equal(decideOutcome({ p, calendar: cal, todayLocal: '2026-11-13', chart: { ok: false, reason: 'not_found', final: true }, providerHealthy: true }).unavailableReason, 'not_found');
  const split = { ok: true, parsed: { bars: [{ date: '2026-10-19', close: 50 }], splits: ['2026-10-19'] } };
  assert.equal(decideOutcome({ p, calendar: cal, todayLocal: '2026-10-20', chart: split, providerHealthy: true }).splitBetween, true);
});

test('append-only: mergeOutcomes never changes an existing key; file names never collide', () => {
  const a = { k1: { x: 1 } };
  const { merged, added } = L.mergeOutcomes(a, { k1: { x: 1 }, k2: { x: 2 } });
  assert.deepEqual(added, ['k2']); assert.deepEqual(merged.k1, { x: 1 });
  assert.throws(() => L.mergeOutcomes(a, { k1: { x: 9 } }), /append-only/);
  assert.throws(() => L.assertAppendOnly(a, { k1: { x: 2 } }), /append-only/);
  assert.throws(() => L.assertAppendOnly(a, {}), /append-only/);
  assert.equal(L.nextFreeName([], '2026-10-18'), '2026-10-18.json');
  assert.equal(L.nextFreeName(['2026-10-18.json', '2026-10-18-2.json'], '2026-10-18'), '2026-10-18-3.json');
  const d = tmp();
  assert.equal(writeExclusive(d, '2026-10-18', { a: 1 }), '2026-10-18.json');
  assert.equal(writeExclusive(d, '2026-10-18', { a: 2 }), '2026-10-18-2.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, '2026-10-18.json'), 'utf8')), { a: 1 });
  assert.deepEqual(['2026-10-18-10.json', '2026-10-19.json', '2026-10-18-2.json', '2026-10-18.json'].sort(cmpRunName), ['2026-10-18.json', '2026-10-18-2.json', '2026-10-18-10.json', '2026-10-19.json']);
});

// ------------------------------------------------------------------ statistics
test('isoWeek, business days, non-overlap and n_eff (AMEND-1)', () => {
  assert.equal(L.isoWeek('2026-10-18'), '2026-W42'); // Sunday
  assert.equal(L.isoWeek('2026-10-19'), '2026-W43');
  assert.equal(L.isoWeek('2021-01-03'), '2020-W53');
  assert.equal(L.isoWeek('2024-12-30'), '2025-W01');
  assert.equal(L.businessDaysBetween('2026-10-15', '2026-10-18', 'sa'), 1); // Thu → Sun
  assert.equal(L.businessDaysBetween('2026-10-16', '2026-10-19', 'us'), 1); // Fri → Mon
  const daily = sessions('us', '2026-10-30', 15);
  assert.equal(L.nonOverlappingDates(daily, 1, 'us').length, 15);
  assert.equal(L.nonOverlappingDates(daily, 5, 'us').length, 3);
  assert.deepEqual(L.nEff(8, [1, 2]), { nNonOverlap: 8, rho: null, nEff: 8, rhoEstimated: false });
  const trend = L.nEff(20, Array.from({ length: 20 }, (_, i) => i));
  assert.ok(trend.rho > 0 && trend.nEff < 20);
  const alt = L.nEff(20, Array.from({ length: 20 }, (_, i) => (i % 2 ? 1 : -1)));
  assert.equal(alt.rho, 0); assert.equal(alt.nEff, 20); // negative ρ̂ clipped: no extra credit
});

test('summarize: accuracy, up-hit vs base rate, momentum halves', () => {
  const mk = (sym, rank, dir, rose, correct) => ({ runFile: 'sa/x.json', runDate: '2026-10-18', market: 'sa', symbol: sym, h: 5, momentumRank: rank, entry: { direction: dir }, outcome: { status: 'evaluated', refDate: '2026-10-18', rose, hit: dir === 'صاعد' ? rose : null, directionCorrect: correct, inRange: null, splitBetween: false } });
  const rows = [mk('A', 1, 'صاعد', true, true), mk('B', 2, 'صاعد', true, true), mk('C', 3, 'هابط', true, false), mk('D', 4, 'محايد', false, false), { ...mk('E', 5, 'غير متاح', false, null), outcome: null }];
  const s = L.summarize(rows, 'sa', 5);
  assert.equal(s.recorded, 5); assert.equal(s.matured, 4);
  assert.deepEqual(s.byDirection, { 'صاعد': 2, 'محايد': 1, 'هابط': 1, 'غير متاح': 1 });
  assert.equal(s.nonNeutralAccuracy.pct, 200 / 3);
  assert.equal(s.upHit.pct, 100); assert.equal(s.baseRate.pct, 75); assert.equal(s.liftPp, 25);
  assert.deepEqual([s.topHalfRise.k, s.topHalfRise.n], [2, 2]); // ranks 1,2 of 5 (floor(5/2)=2)
  assert.deepEqual([s.bottomHalfRise.k, s.bottomHalfRise.n], [1, 2]); // C rose, D not (E unmatured)
  assert.equal(s.neff.nNonOverlap, 1);
});

// ------------------------------------------------------------------ offline integration
function saWorld(end) {
  const dates = sessions('sa', end, 250);
  const idx = Object.fromEntries(L.SA_UNIVERSE.map((s, i) => [s, i]));
  return (sym) => {
    if (sym === '4263.SR') return null; // one symbol 404 → excluded from ranking
    const i = idx[sym] ?? 0;
    return { dates, closes: dates.map((_, k) => 10 * (1 + (i + 1) * 0.001 * k)) }; // higher index = stronger trend
  };
}

test('run (SA): ranks 39/40, picks top 20, calls analyze sequentially, writes append-only files', async () => {
  const dir = tmp();
  const calls = [];
  const sleeps = [];
  const now = () => Date.parse('2026-10-18T07:20:00Z');
  const analyze = async (symbol) => { calls.push(symbol); return symbol === '7020.SR' ? { status: 500, text: 'x' } : { status: 200, text: JSON.stringify(forecastResponse(symbol)) }; };
  const res = await runAgentPicks({ market: 'sa', count: 20, outDir: dir, net: fakeNet(saWorld('2026-10-18')), analyze, sleep: async (ms) => sleeps.push(ms), now, spacingMs: 500, requireSessionToday: true, meta: { gitSha: 'abc' } });
  assert.equal(res.status, 'written'); assert.equal(res.file, 'sa/2026-10-18.json');
  const doc = JSON.parse(fs.readFileSync(path.join(dir, res.file), 'utf8'));
  assert.equal(doc.schema, L.SCHEMA_RUN); assert.equal(doc.gitSha, 'abc');
  assert.equal(doc.selection.rankedCount, 39);
  assert.deepEqual(doc.selection.excluded, [{ symbol: '4263.SR', reason: 'chart_not_found' }]);
  assert.equal(doc.picks.length, 20);
  assert.equal(doc.picks[0].symbol, '7020.SR'); // strongest synthetic trend
  assert.deepEqual(doc.picks.map((p) => p.momentum.rank), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(doc.counts.failed, 1); assert.equal(doc.counts.ok, 19);
  assert.equal(doc.counts.failures[0].reason, 'http_500');
  assert.equal(calls.filter((s) => s === '7020.SR').length, 3); // 1 + 2 retries
  assert.ok(sleeps.filter((ms) => ms === 2000).length >= 19); // spacing clamped to >= 2 s between calls
  assert.deepEqual(doc.modelVersions, ['mizan-scenarios-7-abcd']);
  assert.equal(doc.picks[1].forecasts[1].refDate, '2026-10-18');
  assert.equal(doc.universeRanking.length, 40);
  // second run the same day → new file, first untouched
  const before = fs.readFileSync(path.join(dir, res.file), 'utf8');
  const res2 = await runAgentPicks({ market: 'sa', count: 20, outDir: dir, net: fakeNet(saWorld('2026-10-18')), analyze, sleep: noSleep, now });
  assert.equal(res2.file, 'sa/2026-10-18-2.json');
  assert.equal(fs.readFileSync(path.join(dir, res.file), 'utf8'), before);
});

test('run: no session today (holiday) → nothing written when required', async () => {
  const dir = tmp();
  const res = await runAgentPicks({ market: 'sa', count: 20, outDir: dir, net: fakeNet(saWorld('2026-10-15')), analyze: async () => { throw new Error('must not be called'); }, sleep: noSleep, now: () => Date.parse('2026-10-18T07:20:00Z'), requireSessionToday: true, sessionWaitMs: 1 });
  assert.equal(res.status, 'no_session');
  assert.equal(fs.existsSync(path.join(dir, 'sa')), false);
});

test('run: rank coverage < 75% → gap file, no analyze calls', async () => {
  const dir = tmp();
  const world = saWorld('2026-10-18');
  const res = await runAgentPicks({ market: 'sa', count: 20, outDir: dir, net: fakeNet((s) => (L.SA_UNIVERSE.indexOf(s) < 15 ? null : world(s))), analyze: async () => { throw new Error('must not be called'); }, sleep: noSleep, now: () => Date.parse('2026-10-18T07:20:00Z') });
  assert.equal(res.status, 'gap');
  const doc = JSON.parse(fs.readFileSync(path.join(dir, res.file), 'utf8'));
  assert.equal(doc.picks.length, 0); assert.equal(doc.selection.coverageOk, false);
});

test('run (US, count 40) keeps the whole universe with ranks', async () => {
  const dir = tmp();
  const dates = sessions('us', '2026-10-16', 250);
  const net = fakeNet((s) => ({ dates, closes: dates.map((_, k) => 50 + (s.charCodeAt(0) % 7) * 0.01 * k) }));
  const res = await runAgentPicks({ market: 'us', count: 40, outDir: dir, net, analyze: async (s) => ({ status: 200, text: JSON.stringify(forecastResponse(s, { priceTime: '2026-10-16' })) }), sleep: noSleep, now: () => Date.parse('2026-10-16T14:00:00Z') });
  const doc = JSON.parse(fs.readFileSync(path.join(dir, res.file), 'utf8'));
  assert.equal(doc.picks.length, 40);
  assert.ok(doc.picks.every((p) => Number.isInteger(p.momentum.rank)));
  assert.deepEqual(new Set(doc.picks.map((p) => p.symbol)), new Set(L.US_UNIVERSE));
});

test('evaluate + weekly + monthly end-to-end (offline), outcomes append-only across runs', async () => {
  const dir = tmp();
  const now0 = () => Date.parse('2026-10-18T07:20:00Z');
  const dirsFor = (s) => ({ 1: L.SA_UNIVERSE.indexOf(s) % 2 ? 'صاعد' : 'هابط', 5: 'صاعد', 21: L.SA_UNIVERSE.indexOf(s) % 3 ? 'محايد' : 'غير متاح' });
  await runAgentPicks({ market: 'sa', count: 20, outDir: dir, net: fakeNet(saWorld('2026-10-18')), analyze: async (s) => ({ status: 200, text: JSON.stringify(forecastResponse(s, { price: 10, dirs: dirsFor(s) })) }), sleep: noSleep, now: now0 });
  // evaluation world: calendar through 2026-10-22 (Thu); each stock's close after the 18th is 10.5 (rose) or 9.5
  const dates = sessions('sa', '2026-10-22', 260);
  const series = (sym) => {
    if (sym === '4263.SR') return null;
    const up = L.SA_UNIVERSE.indexOf(sym) % 2 === 1;
    return { dates, closes: dates.map((d) => (d <= '2026-10-18' ? 10 : up ? 10.5 : 9.5)) };
  };
  const r1 = await evaluateAll({ dir, net: fakeNet(series), sleep: noSleep, now: () => Date.parse('2026-10-23T18:00:00Z') });
  const sa1 = r1.evalResults.find((e) => e.market === 'sa');
  assert.equal(sa1.added, 20 * 1); // only h=1 matured (target 2026-10-19); h=5 target 2026-10-25 not yet
  const out1 = JSON.parse(fs.readFileSync(path.join(dir, 'outcomes/sa.json'), 'utf8'));
  const k = Object.keys(out1.outcomes)[0];
  assert.match(k, /^sa\/2026-10-18\.json\|.+\|h1$/);
  assert.equal(out1.outcomes[k].targetDate, '2026-10-19');
  // odd index: predicted صاعد and rose → correct; even: هابط and fell → correct
  assert.ok(Object.values(out1.outcomes).every((o) => o.directionCorrect === true));
  const w = fs.readFileSync(path.join(dir, 'reports', r1.reportFile), 'utf8');
  assert.equal(r1.reportFile, 'weekly-2026-W43.md');
  assert.match(w, /<div dir="rtl">/); assert.match(w, /n_eff/); assert.match(w, /AMEND-1/); assert.match(w, /80%/);
  assert.match(w, /## Decision/);
  // second evaluation later: h=5 matures; h=1 entries must be byte-identical
  const dates2 = sessions('sa', '2026-11-20', 280);
  const series2 = (sym) => { const s = series(sym); if (!s) return null; return { dates: dates2, closes: dates2.map((d) => (d <= '2026-10-18' ? 10 : L.SA_UNIVERSE.indexOf(sym) % 2 ? 10.5 : 9.5)) }; };
  const r2 = await evaluateAll({ dir, net: fakeNet(series2), sleep: noSleep, now: () => Date.parse('2026-11-21T18:00:00Z') });
  const out2 = JSON.parse(fs.readFileSync(path.join(dir, 'outcomes/sa.json'), 'utf8'));
  for (const [key, v] of Object.entries(out1.outcomes)) assert.deepEqual(out2.outcomes[key], v);
  assert.equal(Object.keys(out2.outcomes).length, 60); // 20 × (1, 5, 21)
  assert.equal(r2.evalResults.find((e) => e.market === 'sa').added, 40);
  // third evaluation: nothing new, nothing changed
  const r3 = await evaluateAll({ dir, net: fakeNet(series2), sleep: noSleep, now: () => Date.parse('2026-11-21T19:00:00Z'), report: false });
  assert.equal(r3.evalResults.find((e) => e.market === 'sa').added, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'outcomes/sa.json'), 'utf8')).outcomes, out2.outcomes);
  // monthly
  const m = runMonthly({ dir, month: '2026-10', now: () => Date.parse('2026-11-01T18:00:00Z') });
  assert.equal(m.reportFile, 'monthly-2026-10.md');
  const md = fs.readFileSync(path.join(dir, 'reports', m.reportFile), 'utf8');
  assert.match(md, /التجارب المقترحة/); assert.match(md, /الاستقرار حسب الأسبوع/); assert.match(md, /أسباب الامتناع/);
  assert.match(md, /السيولة أقل من الحد/);
  const m2 = runMonthly({ dir, month: '2026-10', now: () => Date.parse('2026-11-01T18:00:00Z') });
  assert.equal(m2.reportFile, 'monthly-2026-10-2.md'); // never overwritten
  assert.equal(readRuns(dir).length, 1);
  assert.equal(pendingEntries(readRuns(dir), 'sa', out2.outcomes).length, 0);
});

test('monthly helpers', () => {
  assert.equal(previousMonth(Date.parse('2026-11-01T18:00:00Z')), '2026-10');
  assert.equal(previousMonth(Date.parse('2027-01-01T18:00:00Z')), '2026-12');
  const rows = [{ entry: { direction: 'غير متاح', reasons: ['آخر جلسة بتاريخ 2026-10-01 قديمة'] } }, { entry: { direction: 'غير متاح', reasons: ['آخر جلسة بتاريخ 2026-10-05 قديمة'] } }, { entry: { direction: 'صاعد' } }];
  assert.deepEqual(abstentionReasons(rows), [['آخر جلسة بتاريخ #-#-# قديمة', 2]]);
  const s = { market: 'sa', h: 5, recorded: 10, byDirection: { 'صاعد': 0, 'محايد': 9, 'هابط': 0, 'غير متاح': 1 }, upHit: { n: 0, pct: null }, liftPp: null, topHalfRise: { n: 0, pct: null }, bottomHalfRise: { n: 0, pct: null }, neff: { nEff: 1 } };
  const c = proposedExperiments([s], { analyzeFailRate: 0.5 });
  assert.ok(c.some((x) => x.id === 'CAND-NEUTRAL-sa-h5'));
  assert.ok(c.some((x) => x.id === 'OPS-ANALYZE-FAILURES'));
});

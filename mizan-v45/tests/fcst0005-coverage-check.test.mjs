import test from 'node:test';
import assert from 'node:assert/strict';
import {runCheck, checkProfile, buildUrl, analyse, END_EXCLUSIVE, START_EPOCH, FIELDS_KEPT} from '../research/fcst0005/e1/coverage-check.mjs';
// Mock source only: no network. The fixture's close values are sentinel numbers that must never appear in the output.
const PROFILE = {host: 'example-source.test', urlTemplate: 'https://example-source.test/v8/finance/chart/{symbol}?interval=1d&period1={period1}&period2={period2}&events=splits%2Cdiv', format: 'yahoo-chart-v8',
  termsUrl: 'https://example-source.test/terms', termsReviewedAt: '2026-11-04', termsSuitability: 'documented as suitable by the owner', approvedBy: 'owner', approvedAt: '2026-11-05', accessPathRef: 'owner-approved path #1'};
const SENT = [731.4242, 733.4343, 735.4444];
const body = (symbol, ts, extra = {}) => ({chart: {result: [{meta: {symbol, currency: 'USD', exchangeName: 'NMS', exchangeTimezoneName: 'America/New_York', gmtoffset: -14400, ...extra.meta}, timestamp: ts,
  indicators: {quote: [{close: ts.map((_, i) => i === 1 && extra.nullAt ? null : SENT[i % 3]), volume: ts.map(() => 987654)}], adjclose: [{adjclose: ts.map(() => 5.5)}]}, events: {splits: {1: {}}, dividends: {1: {}, 2: {}}}}]}});
const mk = (map, calls) => async (url, opts) => { calls.push({url, opts}); const s = decodeURIComponent(/chart\/([^?]+)/.exec(url)[1]); const r = map[s]; return typeof r === 'function' ? r() : {status: 200, json: async () => r}; };
const ARMED = {COVERAGE_CHECK_ARMED: '1'};
test('refuses to run when not armed', async () => { await assert.rejects(() => runCheck({profile: PROFILE, symbols: ['AAA'], fetchImpl: async () => { throw new Error('must not be called'); }, env: {}}), /not armed/); });
test('refuses an incomplete profile (no terms review / approval / access path recorded)', () => {
  for (const k of ['termsReviewedAt', 'termsSuitability', 'approvedBy', 'approvedAt', 'accessPathRef', 'termsUrl']) assert.throws(() => checkProfile({...PROFILE, [k]: ''}), /profile incomplete/);
  assert.throws(() => checkProfile({...PROFILE, urlTemplate: 'https://example-source.test/x/{symbol}?range=1d&period1={period1}&period2={period2}'}), /relative ranges/);
  assert.throws(() => checkProfile({...PROFILE, urlTemplate: 'https://other.test/x/{symbol}?period1={period1}&period2={period2}'}), /urlTemplate/);
});
test('request URL carries the fixed bounds and nothing else can be requested', () => {
  const u = new URL(buildUrl(PROFILE, 'AAPL')); assert.equal(u.searchParams.get('period2'), String(END_EXCLUSIVE)); assert.equal(u.searchParams.get('period1'), String(START_EPOCH));
  assert.equal(END_EXCLUSIVE, Date.UTC(2019, 9, 14) / 1000); assert.throws(() => buildUrl(PROFILE, 'A/../B'), /bad symbol/); assert.throws(() => buildUrl(PROFILE, 'A B'), /bad symbol/);
});
test('a row after 2019-10-13 aborts the symbol; nothing else is requested; one host only', async () => {
  const ok = [Date.UTC(2019, 9, 10, 13, 30) / 1000, Date.UTC(2019, 9, 11, 13, 30) / 1000], late = [...ok, Date.UTC(2019, 9, 14, 13, 30) / 1000];
  const calls = []; const out = await runCheck({profile: PROFILE, symbols: ['AAA', 'BBB'], env: ARMED, fetchImpl: mk({AAA: body('AAA', ok), BBB: body('BBB', late)}, calls)});
  assert.equal(out.records.find(r => r.symbol === 'AAA').status, 'ok'); const b = out.records.find(r => r.symbol === 'BBB'); assert.equal(b.status, 'aborted'); assert.equal(b.anomaly, 'row-after-end-date'); assert.equal(b.firstDate, undefined);
  assert.equal(calls.length, 2); assert.ok(calls.every(c => new URL(c.url).host === PROFILE.host && c.opts.redirect === 'manual'));
});
test('a local date after the end date is rejected even if the UTC instant is earlier', () => {
  const t = Date.UTC(2019, 9, 13, 22, 0) / 1000; const a = analyse(body('X', [t], {meta: {gmtoffset: 10800}}), 'X');   // 2019-10-14 01:00 local
  assert.equal(a.ok, false); assert.equal(a.anomaly, 'row-after-end-date');
});
test('no redirect is followed and no alternative source is tried; failure is recorded, never retried elsewhere', async () => {
  const calls = []; const out = await runCheck({profile: PROFILE, symbols: ['AAA', 'BBB'], env: ARMED, fetchImpl: mk({AAA: () => ({status: 302, json: async () => ({})}), BBB: () => ({status: 503, json: async () => ({})})}, calls)});
  assert.equal(out.records[0].anomaly, 'redirect-not-followed'); assert.equal(out.records[1].status, 'failed'); assert.equal(calls.filter(c => /BBB/.test(c.url)).length, 2);  // one same-URL retry on 5xx
  assert.ok(calls.every(c => new URL(c.url).host === PROFILE.host));
});
test('output keeps only the declared fields and never contains a price, volume or return', async () => {
  const ts = [Date.UTC(2019, 9, 8) / 1000, Date.UTC(2019, 9, 9) / 1000, Date.UTC(2019, 9, 10) / 1000]; const calls = [];
  const out = await runCheck({profile: PROFILE, symbols: ['AAA'], env: ARMED, fetchImpl: mk({AAA: body('AAA', ts, {nullAt: true})}, calls)}); const rec = out.records[0];
  for (const k of Object.keys(rec)) assert.ok(FIELDS_KEPT.includes(k), 'unexpected field ' + k);
  assert.equal(rec.rows, 3); assert.equal(rec.nullCloseCount, 1); assert.equal(rec.hasAdjClose, true); assert.equal(rec.splitCount, 1); assert.equal(rec.dividendCount, 2); assert.equal(rec.firstDate, '2019-10-07'.replace('07', '07'));
  const text = JSON.stringify(out); for (const v of SENT) assert.ok(!text.includes(String(v))); assert.ok(!text.includes('987654')); assert.ok(!text.includes('5.5'));
});
test('rejects symbol-mismatch and unsorted timestamps; symbol list is capped at 80', async () => {
  const t = Date.UTC(2019, 9, 8) / 1000; assert.equal(analyse(body('Y', [t]), 'X').anomaly, 'symbol-mismatch'); assert.equal(analyse(body('X', [t + 86400, t]), 'X').anomaly, 'unsorted');
  await assert.rejects(() => runCheck({profile: PROFILE, symbols: Array.from({length: 81}, (_, i) => 'S' + i), env: ARMED, fetchImpl: async () => { throw new Error('x'); }}), /1\.\.80/);
});
import {cellsFromCoverage, medianStart} from '../research/fcst0005/e1/testable-cells.mjs';
test('testable-cell mapping is mechanical: median start per market, deterministic status, no cell for a market without coverage', () => {
  const rec = (symbol, firstDate, status = 'ok') => ({symbol, firstDate, status});
  const report = {records: [rec('A.SR', '2008-03-01'), rec('B.SR', '2010-05-01'), rec('C.SR', '2012-01-01'), rec('X', '2004-01-02'), rec('Y', '2006-01-02'), rec('Z', '2009-01-02', 'aborted')]};
  assert.equal(new Date(medianStart(report.records, 'sa')).toISOString().slice(0, 10), '2010-05-01'); assert.equal(new Date(medianStart(report.records, 'us')).toISOString().slice(0, 10), '2006-01-02');
  const noise = Object.fromEntries(['sa', 'us'].flatMap(m => [1, 5, 21].map(h => [`${m}/${h}`, {n: 900, sePlan: 0.002}]))), spy = {sa: 250, us: 252};
  const a = cellsFromCoverage(report, noise, spy), b = cellsFromCoverage(report, noise, spy); assert.deepEqual(a, b);
  assert.equal(a['sa/1'].status, 'testable'); assert.ok(a['us/21'].nonOverlap > a['sa/21'].nonOverlap);
  const none = cellsFromCoverage({records: [rec('A.SR', '2010-01-01')]}, noise, spy); assert.equal(none['us/5'].status, 'no coverage for this market');
});

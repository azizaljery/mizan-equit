'use strict';
/**
 * Tests for research/snapshot/collect.cjs. Run: node --test research/tests/snapshot-collect.test.cjs
 * STATE: CODE-TESTED on OFFLINE FIXTURES ONLY. Nothing here touches the network (the network layer is injected) and the
 * fixtures are synthetic: they prove the collector's own logic, NOT what Yahoo really returns. See research/snapshot/README.md
 * for the list of things that can only be checked on the first live run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const c = require('../snapshot/collect.cjs');

// ---------------------------------------------------------------------------------------------------------------------
// fixtures / helpers
// ---------------------------------------------------------------------------------------------------------------------
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const tmpDirs = [];
function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pit-snap-')); tmpDirs.push(d); return d; }
test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const U = [
  { symbol: 'AAPL', market: 'us' }, { symbol: 'MSFT', market: 'us' },
  { symbol: '2222.SR', market: 'sa' }, { symbol: '1120.SR', market: 'sa' },
];

function makeClock(iso, stepMs = 1000) { let t = Date.parse(iso); return () => { const v = t; t += stepMs; return v; }; }
const noSleep = () => { const calls = []; const f = async (ms) => { calls.push(ms); }; f.calls = calls; return f; };
const dn = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
const dayStr = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
/** n weekdays ending at (or before) endDate, ascending. */
function weekdays(endDate, n) {
  const out = []; let d = dn(endDate);
  while (out.length < n) { const wd = new Date(d * 86400000).getUTCDay(); if (wd !== 0 && wd !== 6) out.push(dayStr(d)); d--; }
  return out.reverse();
}
const isSA = (s) => s.endsWith('.SR');
const tsOf = (date, sa) => Date.parse(date + (sa ? 'T07:00:00Z' : 'T14:30:00Z')) / 1000;
function priceFor(symbol, date) { const base = 100 + (symbol.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) % 50); return base + (dn(date) % 7); }
const bar = (symbol, date) => { const c0 = priceFor(symbol, date); return { date, o: c0 - 0.5, h: c0 + 1, l: c0 - 1, c: c0, v: 1_000_000 + (dn(date) % 5) * 1000 }; };

/** Build the text of a Yahoo-chart-shaped response. Everything is overridable so tests can omit / corrupt fields. */
function chartText(o) {
  const sa = isSA(o.symbol);
  const meta = {
    symbol: o.symbol, exchangeName: sa ? 'SAU' : 'NMS', fullExchangeName: sa ? 'Saudi' : 'NasdaqGS', currency: sa ? 'SAR' : 'USD', instrumentType: 'EQUITY',
    longName: o.longName || (sa ? 'Saudi Fixture Company' : o.symbol + ' Fixture Inc.'), shortName: o.symbol + ' short',
    firstTradeDate: 345479400, exchangeTimezoneName: sa ? 'Asia/Riyadh' : 'America/New_York', timezone: sa ? '+03' : 'EST', gmtoffset: sa ? 10800 : -18000,
    dataGranularity: '1d', regularMarketTime: tsOf(o.bars[o.bars.length - 1] ? o.bars[o.bars.length - 1].date : '2026-11-02', sa) + 3600,
    ...(o.meta || {}),
  };
  for (const k of o.omitMeta || []) delete meta[k];
  const rows = o.bars;
  const result = { meta };
  if (!o.noSeries) {
    result.timestamp = rows.map((b) => tsOf(b.date, sa));
    const col = (k) => rows.map((b) => (o.override && o.override[k] ? o.override[k](b) : b[k]));
    result.indicators = { quote: [{ open: col('o'), high: col('h'), low: col('l'), close: col('c'), volume: col('v') }] };
    if (o.omitCols) for (const k of o.omitCols) delete result.indicators.quote[0][k];
    if (!o.noAdj) result.indicators.adjclose = [{ adjclose: rows.map((b) => b.c) }];
  }
  if (o.splits) { result.events = { splits: {} }; for (const s of o.splits) result.events.splits[tsOf(s.date, sa)] = { date: tsOf(s.date, sa), numerator: s.n, denominator: s.d, splitRatio: `${s.n}:${s.d}` }; }
  return JSON.stringify({ chart: { result: [result], error: null } });
}

/**
 * Fake network. `handler({symbol, range, host, attempt})` returns {status,text} or throws. `today` is the UTC date the clock shows.
 * Default handler = an ordinary healthy day: bars for the requested range ending on `today` (a weekday).
 */
function makeNet(handlerOverrides = {}, today = '2026-11-02') {
  const calls = [], attemptOf = {};
  const nBars = (range) => ({ '5d': 5, '1mo': 21, '3mo': 63 }[range] || 5);
  return {
    calls,
    async getChart({ url, symbol, range, host }) {
      attemptOf[symbol] = (attemptOf[symbol] || 0) + 1;
      calls.push({ symbol, range, host, attempt: attemptOf[symbol], url });
      const h = handlerOverrides[symbol] || handlerOverrides['*'];
      if (h) { const r = h({ symbol, range, host, attempt: attemptOf[symbol], today }); if (r) return r; }
      return { status: 200, text: chartText({ symbol, bars: weekdays(today, nBars(range)).map((d) => bar(symbol, d)) }) };
    },
  };
}
const run = (dir, net, iso, extra = {}) => c.runCollection({ dir, net, now: makeClock(iso), sleep: noSleep(), universe: U, delayMs: 0, ...extra });
const readDoc = (dir, date) => JSON.parse(fs.readFileSync(path.join(dir, c.snapshotRelPath(date)), 'utf8'));
const rec = (doc, symbol) => doc.records.find((r) => r.symbol === symbol);
const snapText = (dir) => {
  let s = '';
  for (const f of ['chain.jsonl', 'HEAD.json']) s += fs.readFileSync(path.join(dir, 'snapshots', f), 'utf8');
  for (const f of c.loadStore(dir).entries) s += fs.readFileSync(path.join(dir, f.file), 'utf8');
  return s;
};

// ---------------------------------------------------------------------------------------------------------------------
test('universe: 80 symbols (40 .SR + 40 US) identical to the list in fetch-research-prices.yml', () => {
  const u = c.buildUniverse();
  assert.equal(u.length, 80);
  assert.equal(u.filter((x) => x.market === 'sa').length, 40);
  assert.equal(u.filter((x) => x.market === 'us').length, 40);
  assert.ok(u.filter((x) => x.market === 'sa').every((x) => x.symbol.endsWith('.SR')));
  assert.ok(u.filter((x) => x.market === 'us').every((x) => !x.symbol.includes('.')));
  const yml = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'fetch-research-prices.yml'), 'utf8');
  const grab = (n) => [...yml.match(new RegExp(`const ${n} = \\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(u.filter((x) => x.market === 'sa').map((x) => x.symbol), grab('sa').map((s) => s + '.SR'));
  assert.deepEqual(u.filter((x) => x.market === 'us').map((x) => x.symbol), grab('us'));
  assert.equal(new Set(u.map((x) => x.symbol)).size, 80);
});

test('normal day: file layout, identity, bars, provenance, universe list, chain head', async () => {
  const dir = tmp();
  const net = makeNet();
  const text = net; // keep a reference for sha checks below
  const r = await run(dir, net, '2026-11-02T22:40:00Z');
  assert.equal(r.file, 'snapshots/2026/2026-11-02.json');
  assert.ok(fs.existsSync(path.join(dir, 'snapshots', '2026', '2026-11-02.json')));
  const doc = readDoc(dir, '2026-11-02');
  assert.equal(doc.format, c.FORMAT);
  assert.deepEqual(doc.universe, U);                                            // universe list of the run itself
  assert.equal(doc.header.status, 'complete');
  assert.equal(doc.header.ok_count, 4);
  assert.equal(doc.header.failed_count, 0);
  assert.equal(doc.header.quarantined_count, 0);
  assert.equal(doc.header.seq, 1);
  assert.equal(doc.chain.prev_hash, '0'.repeat(64));
  assert.deepEqual(doc.header.http_status_summary, { 200: 4 });
  assert.equal(doc.header.collector_version, c.COLLECTOR_VERSION);
  assert.equal(doc.header.source_endpoint, c.ENDPOINT_TEMPLATE);
  // identity ids: assigned on first sight in universe order, stable thereafter
  assert.deepEqual(doc.records.map((x) => x.instrument_id), [1, 2, 3, 4]);
  assert.ok(doc.records.every((x) => x.status === 'ok' && x.resolution.action === 'new' && !x.quarantined && x.failure === null));
  const a = rec(doc, 'AAPL');
  assert.equal(a.meta.exchangeName, 'NMS'); assert.equal(a.meta.fullExchangeName, 'NasdaqGS'); assert.equal(a.meta.currency, 'USD');
  assert.equal(a.meta.instrumentType, 'EQUITY'); assert.equal(a.meta.longName, 'AAPL Fixture Inc.'); assert.equal(a.meta.shortName, 'AAPL short');
  assert.equal(a.meta.firstTradeDate, 345479400); assert.equal(a.derived.first_trade_date, '1980-12-12');
  assert.equal(a.meta.exchangeTimezoneName, 'America/New_York');
  assert.equal(a.derived.regular_market_time_iso, '2026-11-02T15:30:00.000Z');
  assert.ok(a.meta_keys_seen.includes('exchangeName'));
  assert.equal(rec(doc, '2222.SR').meta.currency, 'SAR');
  assert.ok(doc.records.every((x) => !x.warnings.includes('exchange_unmapped')));          // NMS and SAU are in the alias table
  // bars: raw values, flags, first sight => all returned (21), backfill = older than first_seen
  assert.equal(a.bars.length, 21);
  const last = a.bars[a.bars.length - 1];
  assert.equal(last.date, '2026-11-02'); assert.equal(last.is_backfill, false); assert.equal(a.bars[0].is_backfill, true);
  assert.equal(last.close, priceFor('AAPL', '2026-11-02')); assert.equal(last.adjclose, last.close);
  assert.deepEqual(last.quality_flags, []);
  assert.equal(last.split_numerator, null); assert.equal(last.dividend_amount, null);
  // provenance: endpoint without secrets, status, hash of the response body, version
  const p = a.provenance;
  assert.equal(p.source, 'yahoo-chart'); assert.equal(p.http_status, 200); assert.equal(p.attempts, 1); assert.equal(p.requested_range, '1mo');
  assert.equal(p.source_endpoint, 'https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1mo&events=split');
  const expected = chartText({ symbol: 'AAPL', bars: weekdays('2026-11-02', 21).map((d) => bar('AAPL', d)) });
  assert.equal(p.response_sha256, sha(expected));
  assert.match(p.retrieved_at, /^2026-11-02T22:40:\d\d\.\d{3}Z$/);
  assert.equal(p.collector_version, c.COLLECTOR_VERSION);
  // chain index + head
  const chain = fs.readFileSync(path.join(dir, 'snapshots', 'chain.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(chain.length, 1);
  const head = JSON.parse(fs.readFileSync(path.join(dir, 'snapshots', 'HEAD.json'), 'utf8'));
  assert.equal(head.chain_hash, doc.chain.chain_hash); assert.equal(head.seq, 1);
  assert.equal(chain[0].file_sha256, sha(fs.readFileSync(path.join(dir, r.file))));
  assert.ok(c.verifyStore(dir).ok);
  void text;
});

test('second day: only bars since the last snapshot, stable instrument ids, chain links to day 1, day-1 file untouched', async () => {
  const dir = tmp();
  await run(dir, makeNet({}, '2026-11-02'), '2026-11-02T22:40:00Z');
  const before = fs.readFileSync(path.join(dir, c.snapshotRelPath('2026-11-02')));
  const net2 = makeNet({}, '2026-11-03');
  const r2 = await run(dir, net2, '2026-11-03T22:40:00Z');
  const d1 = readDoc(dir, '2026-11-02'), d2 = readDoc(dir, '2026-11-03');
  assert.deepEqual(d2.records.map((x) => x.instrument_id), [1, 2, 3, 4]);       // stable
  assert.ok(d2.records.every((x) => x.resolution.action === 'existing' && !x.quarantined));
  const a2 = rec(d2, 'AAPL');
  assert.deepEqual(a2.bars.map((b) => b.date), ['2026-11-03']);                 // only the new session
  assert.equal(a2.bars[0].is_backfill, false); assert.equal(a2.bars[0].restated, false);
  assert.equal(a2.bars_summary.returned, 5); assert.equal(a2.bars_summary.ignored_known_or_older, 4);
  assert.equal(a2.provenance.requested_range, '5d');                            // range follows the gap since the last stored session
  assert.ok(net2.calls.every((x) => x.range === '5d'));
  assert.equal(d2.header.seq, 2);
  assert.equal(d2.chain.prev_hash, d1.chain.chain_hash);
  assert.ok(before.equals(fs.readFileSync(path.join(dir, c.snapshotRelPath('2026-11-02')))), 'day-1 file must be byte-identical');
  assert.ok(c.verifyStore(dir).ok);
  // live state == state replayed from the stored files
  assert.deepEqual(r2.state, c.replayState(c.loadStore(dir).docs));
});

test('weekend gap: range grows with the gap since the last stored session', () => {
  assert.equal(c.chooseRange(null, '2026-11-02'), '1mo');
  assert.equal(c.chooseRange('2026-11-02', '2026-11-03'), '5d');
  assert.equal(c.chooseRange('2026-10-30', '2026-11-02'), '5d');
  assert.equal(c.chooseRange('2026-10-20', '2026-11-02'), '1mo');
  assert.equal(c.chooseRange('2026-08-01', '2026-11-02'), '6mo');
  assert.equal(c.chooseRange('2000-01-01', '2026-11-02'), 'max');
});

test('identity change (new name + currency): QUARANTINED, new instrument id, old ended, nothing merged', async () => {
  const dir = tmp();
  await run(dir, makeNet({}, '2026-11-02'), '2026-11-02T22:40:00Z');
  const changed = ({ symbol, range, today }) => ({ status: 200, text: chartText({ symbol, longName: 'Zeta Robotics Holdings', meta: { currency: 'EUR', firstTradeDate: 1723464000 }, bars: weekdays(today, 5).map((d) => bar(symbol, d)) }) });
  const r2 = await run(dir, makeNet({ AAPL: changed }, '2026-11-03'), '2026-11-03T22:40:00Z');
  const d2 = readDoc(dir, '2026-11-03');
  const a = rec(d2, 'AAPL');
  assert.equal(a.status, 'ok');
  assert.equal(a.resolution.action, 'split');
  assert.equal(a.instrument_id, 5);                                              // fresh id; 1 is never reused
  assert.equal(a.quarantined, true);
  assert.equal(a.resolution.ended_instrument.instrument_id, 1);
  assert.equal(a.resolution.ended_instrument.status, 'ended_identity_conflict');
  assert.equal(a.resolution.ended_instrument.ended_on, '2026-11-02');
  assert.equal(a.resolution.new_instrument.created_reason, 'identity_conflict_split');
  assert.equal(d2.quarantine.length, 1);
  const q = d2.quarantine[0];
  assert.equal(q.quarantine_id, a.quarantine_id); assert.equal(q.kind, 'hard_split'); assert.equal(q.status, 'open');
  assert.equal(q.old_instrument_id, 1); assert.equal(q.new_instrument_id, 5);
  for (const reason of ['name_change', 'currency_change']) assert.ok(q.reasons.includes(reason), reason);
  assert.ok(q.evidence.previous && q.evidence.incoming);                         // evidence of both sides is kept
  assert.equal(q.evidence.previous.name, 'AAPL Fixture Inc.'); assert.equal(q.evidence.incoming.name, 'Zeta Robotics Holdings');
  assert.equal(d2.header.quarantined_count, 1);
  assert.deepEqual(d2.records.filter((x) => x.symbol !== 'AAPL').map((x) => x.instrument_id), [2, 3, 4]);   // others unaffected
  assert.ok(a.bars.length > 0 && a.bars.every((b) => b.date <= '2026-11-03'));                              // bars recorded under the NEW id, not dropped
  // day 3: the symbol keeps the new id and is no longer flagged (the old instrument stays ended)
  const r3 = await run(dir, makeNet({ AAPL: ({ symbol, today }) => ({ status: 200, text: chartText({ symbol, longName: 'Zeta Robotics Holdings', meta: { currency: 'EUR', firstTradeDate: 1723464000 }, bars: weekdays(today, 5).map((d) => bar(symbol, d)) }) }) }, '2026-11-04'), '2026-11-04T22:40:00Z');
  const a3 = rec(readDoc(dir, '2026-11-04'), 'AAPL');
  assert.equal(a3.instrument_id, 5); assert.equal(a3.resolution.action, 'existing'); assert.equal(a3.quarantined, false);
  assert.equal(r3.state.instruments.find((i) => i.instrumentId === 1).status, 'ended_identity_conflict');
  assert.equal(r3.state.listings.filter((l) => l.symbol === 'AAPL' && l.validTo === null).length, 1);          // never two open listings for one ticker
  assert.ok(c.verifyStore(dir).ok);
  assert.deepEqual(r3.state, c.replayState(c.loadStore(dir).docs));
  void r2;
});

test('failed symbols are RECORDED with reason / status / attempts, never dropped; run continues; header partial', async () => {
  const dir = tmp();
  const uni = [
    { symbol: 'AAPL', market: 'us' }, { symbol: 'MSFT', market: 'us' }, { symbol: '2222.SR', market: 'sa' }, { symbol: '1120.SR', market: 'sa' },
    { symbol: 'KO', market: 'us' }, { symbol: 'PEP', market: 'us' }, { symbol: 'JNJ', market: 'us' }, { symbol: 'XOM', market: 'us' },
  ];
  const net = makeNet({
    MSFT: () => ({ status: 404, text: '{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}' }),
    '2222.SR': () => ({ status: 500, text: 'oops' }),
    '1120.SR': () => { const e = new Error('connect ECONNRESET https://query2.finance.yahoo.com/v8/finance/chart/1120.SR?crumb=SECRET123&token=ABC'); e.code = 'ECONNRESET'; throw e; },
    KO: () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; },
    PEP: () => ({ status: 200, text: '{"chart":{"result":[{"meta":{"symbol":"PEP"},"timestamp":[1],"indicators":{"quote":[{"close":[NaN]}]}}]}}' }),   // literal NaN is not JSON
    JNJ: () => ({ status: 200, text: JSON.stringify({ chart: { result: null, error: { code: 'Not Found', description: 'x'.repeat(50) } } }) }),
    XOM: ({ attempt, symbol, today, range }) => (attempt === 1 ? { status: 429, text: 'slow down' } : { status: 200, text: chartText({ symbol, bars: weekdays(today, 21).map((d) => bar(symbol, d)) }) }),
  });
  const sleep = noSleep(); const logs = [];
  const r = await c.runCollection({ dir, net, now: makeClock('2026-11-02T22:40:00Z'), sleep, universe: uni, delayMs: 0, log: (l) => logs.push(l) });
  const doc = readDoc(dir, '2026-11-02');
  assert.equal(doc.records.length, 8);                                           // nothing dropped
  assert.deepEqual(doc.universe.map((u) => u.symbol), uni.map((u) => u.symbol));
  assert.equal(doc.header.status, 'partial'); assert.equal(doc.header.ok_count, 2); assert.equal(doc.header.failed_count, 6);
  const f = (s) => rec(doc, s);
  assert.deepEqual(f('MSFT').failure, { reason: 'not_found', detail: null, http_status: 404, attempts: 1, });    // 404 is final: no retry
  assert.deepEqual(f('2222.SR').failure, { reason: 'server_error', detail: null, http_status: 500, attempts: 4 });
  assert.deepEqual(net.calls.filter((x) => x.symbol === '2222.SR').map((x) => x.host), ['query2', 'query1', 'query2', 'query1']);
  assert.deepEqual(sleep.calls.filter((x) => x > 0).slice(0, 3), [4000, 8000, 12000]);   // linear backoff, as in fetch-research-prices.yml
  assert.deepEqual(f('1120.SR').failure, { reason: 'network_error', detail: 'ECONNRESET', http_status: null, attempts: 4 });
  assert.equal(f('KO').failure.reason, 'timeout');
  assert.equal(f('PEP').failure.reason, 'invalid_json');
  assert.equal(f('JNJ').failure.reason, 'not_found'); assert.equal(f('JNJ').failure.detail, 'Not Found');
  assert.equal(f('XOM').status, 'ok'); assert.equal(f('XOM').provenance.attempts, 2); assert.equal(f('XOM').provenance.http_status, 200);
  for (const s of ['MSFT', '2222.SR', '1120.SR', 'KO', 'PEP', 'JNJ']) {
    assert.equal(f(s).status, 'failed'); assert.equal(f(s).instrument_id, null); assert.equal(f(s).meta, null); assert.deepEqual(f(s).bars, []);
    assert.equal(f(s).provenance.collector_version, c.COLLECTOR_VERSION);
  }
  assert.equal(f('MSFT').provenance.response_sha256, sha('{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}'));
  assert.equal(f('1120.SR').provenance.response_sha256, null);
  assert.deepEqual(doc.header.http_status_summary, { 200: 4, 404: 1, 500: 1, network_error: 1, timeout: 1 });   // 200 = HTTP status of the fetch (PEP/JNJ parse failures included)
  // the failed symbol does not get an id and does not shift the others' ids; failures do not break the chain
  assert.deepEqual(['AAPL', 'XOM', 'JNJ'].map((s) => f(s).instrument_id), [1, 2, null]);
  assert.ok(r.verify.ok);
  // logs hold counts/status only: no response bodies, no secrets, no URLs
  const all = logs.join('\n') + snapText(dir);
  assert.ok(!all.includes('SECRET123') && !all.includes('slow down') && !all.includes('oops'));
  assert.ok(!/https?:\/\//.test(logs.join('\n')));
});

test('second run on the same UTC date is REFUSED: no network, no rewrite, no duplicate, clear message', async () => {
  const dir = tmp();
  await run(dir, makeNet(), '2026-11-02T22:40:00Z');
  const file = path.join(dir, c.snapshotRelPath('2026-11-02'));
  const bytes = fs.readFileSync(file), chainBefore = fs.readFileSync(path.join(dir, 'snapshots', 'chain.jsonl'));
  const net = makeNet();
  await assert.rejects(() => run(dir, net, '2026-11-02T23:55:00Z'), (e) => {
    assert.ok(e instanceof c.AlreadyCollectedError);
    assert.equal(e.exitCode, c.EXIT.ALREADY_COLLECTED);
    assert.match(e.message, /REFUSED: a snapshot for 2026-11-02 already exists \(snapshots\/2026\/2026-11-02\.json\)/);
    assert.match(e.message, /append-only/);
    return true;
  });
  assert.equal(net.calls.length, 0);
  assert.ok(bytes.equals(fs.readFileSync(file)));
  assert.ok(chainBefore.equals(fs.readFileSync(path.join(dir, 'snapshots', 'chain.jsonl'))));
  assert.equal(c.loadStore(dir).entries.length, 1);
  // even a file left behind without a chain line blocks the date (exclusive create, never overwritten)
  const dir2 = tmp(); fs.mkdirSync(path.join(dir2, 'snapshots', '2026'), { recursive: true }); fs.writeFileSync(path.join(dir2, c.snapshotRelPath('2026-11-02')), '{}');
  await assert.rejects(() => run(dir2, makeNet(), '2026-11-02T22:40:00Z'), c.AlreadyCollectedError);
});

test('an older date than the stored head is refused', async () => {
  const dir = tmp();
  await run(dir, makeNet({}, '2026-11-03'), '2026-11-03T22:40:00Z');
  await assert.rejects(() => run(dir, makeNet(), '2026-11-02T22:40:00Z'), /not after the last stored date/);
});

test('chain verifies over several runs; every kind of tampering is detected', async () => {
  const dir = tmp();
  await run(dir, makeNet({}, '2026-11-02'), '2026-11-02T22:40:00Z');
  await run(dir, makeNet({}, '2026-11-03'), '2026-11-03T22:40:00Z');
  await run(dir, makeNet({}, '2026-11-04'), '2026-11-04T22:40:00Z');
  const v = c.verifyStore(dir);
  assert.ok(v.ok, JSON.stringify(v.errors)); assert.equal(v.runs, 3); assert.equal(v.head.seq, 3);
  const anchor = { seq: 3, chainHash: v.head.chain_hash };
  assert.ok(c.verifyStore(dir, { anchor }).ok);
  const clone = () => { const d = tmp(); fs.cpSync(dir, d, { recursive: true }); return d; };
  const codes = (d, opts) => c.verifyStore(d, opts).errors.map((e) => e.code);

  { // 1. change one price in the middle of the history
    const d = clone(); const f = path.join(d, c.snapshotRelPath('2026-11-03'));
    const doc = JSON.parse(fs.readFileSync(f, 'utf8')); doc.records[0].bars[0].close += 1; fs.writeFileSync(f, JSON.stringify(doc, null, 1) + '\n');
    const cs = codes(d); assert.ok(cs.includes('content_mismatch'), cs.join()); assert.ok(cs.includes('file_sha256_mismatch'));
    // ...and the collector refuses to append to a broken chain
    await assert.rejects(() => run(d, makeNet({}, '2026-11-05'), '2026-11-05T22:40:00Z'), (e) => e instanceof c.ChainVerificationError && e.exitCode === c.EXIT.CHAIN);
    assert.equal(c.loadStore(d).entries.length, 3);
  }
  { // 2. whitespace-only edit is still caught (file hash), content hash alone would miss it
    const d = clone(); const f = path.join(d, c.snapshotRelPath('2026-11-02')); fs.appendFileSync(f, '\n');
    assert.deepEqual(codes(d), ['file_sha256_mismatch']);
  }
  { // 3. delete a snapshot file
    const d = clone(); fs.rmSync(path.join(d, c.snapshotRelPath('2026-11-03')));
    assert.ok(codes(d).includes('missing_file'));
  }
  { // 4. edit a hash in the chain index
    const d = clone(); const p = path.join(d, 'snapshots', 'chain.jsonl');
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n').map(JSON.parse); lines[1].content_hash = 'a'.repeat(64); fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const cs = codes(d); assert.ok(cs.includes('chain_hash_mismatch') || cs.includes('broken_link') || cs.includes('content_mismatch'), cs.join());
  }
  { // 5. drop a middle line of the index (gap) / reorder
    const d = clone(); const p = path.join(d, 'snapshots', 'chain.jsonl');
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n'); fs.writeFileSync(p, [lines[0], lines[2]].join('\n') + '\n');
    assert.ok(codes(d).some((x) => x === 'seq_gap' || x === 'broken_link'));
  }
  { // 6. truncated tail is invisible without an anchor, detected with one
    const d = clone(); const p = path.join(d, 'snapshots', 'chain.jsonl');
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n'); fs.writeFileSync(p, lines.slice(0, 2).join('\n') + '\n');
    fs.rmSync(path.join(d, c.snapshotRelPath('2026-11-04'))); fs.writeFileSync(path.join(d, 'snapshots', 'HEAD.json'), JSON.stringify({ seq: 2, snapshot_date: '2026-11-03', chain_hash: JSON.parse(lines[1]).chain_hash, file: JSON.parse(lines[1]).file, format: c.FORMAT }));
    assert.ok(c.verifyStore(d).ok, 'without an external anchor a clean tail truncation cannot be seen (documented limit)');
    assert.ok(codes(d, { anchor }).includes('truncated'));
  }
  { // 7. a snapshot file that is not in the chain
    const d = clone(); fs.mkdirSync(path.join(d, 'snapshots', '2026'), { recursive: true }); fs.writeFileSync(path.join(d, c.snapshotRelPath('2026-11-09')), '{}');
    assert.ok(codes(d).includes('unlisted_snapshot_file'));
  }
  { // 8. HEAD.json that disagrees with the index
    const d = clone(); fs.writeFileSync(path.join(d, 'snapshots', 'HEAD.json'), JSON.stringify({ seq: 3, snapshot_date: '2026-11-04', chain_hash: 'b'.repeat(64) }));
    assert.ok(codes(d).includes('head_file_mismatch'));
  }
  { // 9. a chain line pointing outside the store is rejected, not followed
    const d = clone(); const p = path.join(d, 'snapshots', 'chain.jsonl');
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n').map(JSON.parse); lines[0].file = '../../etc/passwd'; fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    assert.ok(codes(d).includes('bad_file_reference'));
  }
  { // 10. CLI exit codes: 0 for a good store, 2 for a broken one
    const quiet = { log: console.log, error: console.error }; console.log = () => {}; console.error = () => {};
    try {
      assert.equal(await c.main(['verify', '--dir', dir]), 0);
      const d = clone(); fs.appendFileSync(path.join(d, c.snapshotRelPath('2026-11-02')), ' ');
      assert.equal(await c.main(['verify', '--dir', d]), 2);
      assert.equal(await c.main(['verify', '--dir', dir, '--anchor-seq', '3', '--anchor-hash', 'c'.repeat(64)]), 2);
    } finally { console.log = quiet.log; console.error = quiet.error; }
  }
});

test('missing / invalid fields are stored as null with flags - nothing is invented', async () => {
  const dir = tmp();
  const uni = [{ symbol: 'AAPL', market: 'us' }, { symbol: '2222.SR', market: 'sa' }, { symbol: 'MSFT', market: 'us' }, { symbol: 'KO', market: 'us' }, { symbol: 'PEP', market: 'us' }];
  const days = (symbol, today) => weekdays(today, 21).map((d) => bar(symbol, d));
  const mkNet = (today0) => makeNet({
    // no longName (shortName is used for matching, but longName stays null), no firstTradeDate, no instrumentType, string timezone-offset garbage
    AAPL: ({ symbol, today }) => ({ status: 200, text: chartText({ symbol, omitMeta: ['longName', 'firstTradeDate', 'instrumentType'], meta: { regularMarketTime: 'yesterday' }, bars: days(symbol, today) }) }),
    // bar-level: null close, "N/A" close, absent high column, Infinity-ish volume as string, negative volume
    '2222.SR': ({ symbol, today }) => {
      const bars = days(symbol, today); let i = -1;
      return { status: 200, text: chartText({ symbol, bars, omitCols: ['high'], noAdj: true, override: {
        c: (b) => { i++; return i === 0 ? null : i === 1 ? 'N/A' : b.c; },
        v: (b) => (b.date === bars[2].date ? 'inf' : b.date === bars[3].date ? -5 : b.v),
      } }) };
    },
    // neither exchangeName nor fullExchangeName => identity cannot be resolved honestly
    MSFT: ({ symbol, today }) => ({ status: 200, text: chartText({ symbol, omitMeta: ['exchangeName', 'fullExchangeName'], bars: days(symbol, today) }) }),
    // meta.symbol disagrees with the request
    KO: ({ today }) => ({ status: 200, text: chartText({ symbol: 'XX', bars: days('XX', today) }) }),
    // no bars at all in the response (e.g. halted): identity still recorded
    PEP: ({ symbol }) => ({ status: 200, text: chartText({ symbol, bars: [], noSeries: true }) }),
  }, today0);
  await c.runCollection({ dir, net: mkNet('2026-11-02'), now: makeClock('2026-11-02T22:40:00Z'), sleep: noSleep(), universe: uni, delayMs: 0 });
  const doc = readDoc(dir, '2026-11-02');
  const txt = fs.readFileSync(path.join(dir, c.snapshotRelPath('2026-11-02')), 'utf8');
  assert.ok(!/\bNaN\b|undefined|Infinity/.test(txt));
  const a = rec(doc, 'AAPL');
  assert.equal(a.status, 'ok');
  assert.equal(a.meta.longName, null); assert.equal(a.meta.firstTradeDate, null); assert.equal(a.meta.instrumentType, null);
  assert.equal(a.meta.regularMarketTime, null); assert.deepEqual(a.meta_invalid_fields, ['regularMarketTime']);
  assert.equal(a.derived.first_trade_date, null); assert.equal(a.derived.regular_market_time_iso, null);
  assert.equal(a.identity_input.name, 'AAPL short'); assert.equal(a.identity_input.name_source, 'shortName'); assert.equal(a.identity_input.first_row_date, null);
  assert.ok(a.warnings.includes('name_from_shortName') && a.warnings.includes('meta_invalid_fields'));
  assert.equal(a.resolution.action, 'new');

  const s = rec(doc, '2222.SR');
  assert.equal(s.status, 'ok');
  assert.equal(s.bars[0].close, null); assert.ok(s.bars[0].quality_flags.includes('close_missing'));
  assert.equal(s.bars[1].close, null); assert.ok(s.bars[1].quality_flags.includes('close_invalid'));
  assert.ok(s.bars.every((b) => b.high === null && b.quality_flags.includes('high_missing')));
  assert.equal(s.bars[2].volume, null); assert.ok(s.bars[2].quality_flags.includes('volume_invalid'));
  assert.equal(s.bars[3].volume, -5); assert.ok(s.bars[3].quality_flags.includes('volume_negative'));   // stored as delivered, flagged
  assert.ok(s.bars.every((b) => b.adjclose === null)); assert.ok(s.warnings.includes('adjclose_absent'));
  assert.equal(s.bars.length, 21);                                                          // nothing dropped
  assert.equal(s.bars[5].close, priceFor('2222.SR', s.bars[5].date));

  const m = rec(doc, 'MSFT');
  assert.equal(m.status, 'identity_unresolved'); assert.equal(m.failure.reason, 'identity_fields_missing'); assert.equal(m.failure.detail, 'exchange');
  assert.equal(m.instrument_id, null); assert.equal(m.meta.exchangeName, null); assert.equal(m.meta.fullExchangeName, null);
  assert.equal(m.unattributed_bars.length, 21);                                             // raw bars kept as evidence, attached to no instrument
  assert.equal(rec(doc, 'KO').failure.reason, 'symbol_mismatch'); assert.equal(rec(doc, 'KO').instrument_id, null);
  const p = rec(doc, 'PEP');
  assert.equal(p.status, 'ok'); assert.deepEqual(p.bars, []); assert.ok(p.warnings.includes('no_bars_in_response')); assert.equal(p.instrument_id, 3);   // unresolved symbols consume no id
  assert.equal(doc.header.identity_unresolved_count, 2); assert.equal(doc.header.failed_count, 0); assert.equal(doc.header.status, 'partial');
  assert.ok(c.verifyStore(dir).ok);
  // day 2 with the same gaps: the detector reports the rules it could not evaluate as skipped (never as "no conflict")
  await c.runCollection({ dir, net: mkNet('2026-11-03'), now: makeClock('2026-11-03T22:40:00Z'), sleep: noSleep(), universe: uni, delayMs: 0 });
  const a2 = rec(readDoc(dir, '2026-11-03'), 'AAPL');
  assert.equal(a2.resolution.action, 'existing'); assert.equal(a2.instrument_id, 1);
  assert.ok(a2.resolution.skipped_rules.some((x) => x.startsWith('first_row')), a2.resolution.skipped_rules.join());
  assert.ok(c.verifyStore(dir).ok);
});

test('events and flags: split attached to its bar, restated bars stored once as new rows, open session flagged', async () => {
  const dir = tmp();
  const d1 = ({ symbol, today }) => ({ status: 200, text: chartText({ symbol, bars: weekdays(today, 21).map((d) => bar(symbol, d)),
    meta: { currentTradingPeriod: { regular: { start: tsOf('2026-11-02', false), end: tsOf('2026-11-02', false) + 6.5 * 3600 } } } }) });
  await run(dir, makeNet({ AAPL: d1 }, '2026-11-02'), '2026-11-02T18:00:00Z');                       // run while the US session is still open
  const a1 = rec(readDoc(dir, '2026-11-02'), 'AAPL');
  assert.ok(a1.bars[a1.bars.length - 1].quality_flags.includes('session_possibly_open_at_retrieval'));
  assert.ok(!a1.bars[0].quality_flags.includes('session_possibly_open_at_retrieval'));
  assert.deepEqual(rec(readDoc(dir, '2026-11-02'), 'MSFT').bars.at(-1).quality_flags, []);            // no trading-period info => no claim

  const restated = (symbol, today) => weekdays(today, 5).map((d) => (d === '2026-11-02' ? { ...bar(symbol, d), c: 123.45, v: 2_000_000 } : bar(symbol, d)));
  const d2 = ({ symbol, today }) => ({ status: 200, text: chartText({ symbol, bars: restated(symbol, today), splits: [{ date: '2026-11-03', n: 4, d: 1 }] }) });
  await run(dir, makeNet({ AAPL: d2 }, '2026-11-03'), '2026-11-03T22:40:00Z');
  const doc2 = readDoc(dir, '2026-11-03'), a2 = rec(doc2, 'AAPL');
  assert.deepEqual(a2.bars.map((b) => [b.date, b.restated]), [['2026-11-02', true], ['2026-11-03', false]]);   // changed bar re-stored, unchanged ones not
  assert.ok(a2.bars[0].quality_flags.includes('restated_vs_stored')); assert.equal(a2.bars[0].close, 123.45);
  assert.equal(a2.bars[1].split_numerator, 4); assert.equal(a2.bars[1].split_denominator, 1);
  assert.deepEqual(a2.events.splits, [{ timestamp: tsOf('2026-11-03', false), date: '2026-11-03', numerator: 4, denominator: 1, split_ratio: '4:1' }]);
  assert.equal(a2.quarantined, false);                                                                 // a pure restatement is not an identity conflict
  // day 3 returns the same restated values: nothing new to store for 11-02
  await run(dir, makeNet({ AAPL: ({ symbol, today }) => ({ status: 200, text: chartText({ symbol, bars: restated(symbol, today) }) }) }, '2026-11-04'), '2026-11-04T22:40:00Z');
  assert.deepEqual(rec(readDoc(dir, '2026-11-04'), 'AAPL').bars.map((b) => b.date), ['2026-11-04']);
});

test('no secret-looking strings in any output, even with token-like env vars and secret-bearing errors', async () => {
  const dir = tmp();
  const saved = { a: process.env.GITHUB_TOKEN, b: process.env.YAHOO_CRUMB };
  process.env.GITHUB_TOKEN = 'ghp_' + 'A1b2C3d4E5'.repeat(4); process.env.YAHOO_CRUMB = 'CRUMBVALUE123';
  const logs = [];
  try {
    const net = makeNet({
      MSFT: () => { const e = new Error('fetch failed: https://u:pw@query2.finance.yahoo.com/x?crumb=CRUMBVALUE123&apikey=sk-live-abcdefghijklmnop'); e.code = 'ENOTFOUND'; throw e; },
    });
    await c.runCollection({ dir, net, now: makeClock('2026-11-02T22:40:00Z'), sleep: noSleep(), universe: U, delayMs: 0, log: (l) => logs.push(l),
      runContext: { github_run_id: '123456789', github_sha: 'a'.repeat(40) }, trigger: 'workflow_dispatch' });
  } finally { process.env.GITHUB_TOKEN = saved.a; process.env.YAHOO_CRUMB = saved.b; if (saved.a === undefined) delete process.env.GITHUB_TOKEN; if (saved.b === undefined) delete process.env.YAHOO_CRUMB; }
  const everything = snapText(dir) + '\n' + logs.join('\n');
  const stripped = everything.replace(/\b[0-9a-f]{64}\b/g, '').replace(/\b[0-9a-f]{40}\b/g, '');   // sha256 hashes and a commit sha are not secrets
  for (const bad of [/ghp_/i, /github_pat_/i, /crumb/i, /apikey|api_key|api-key/i, /token/i, /secret/i, /password|passwd/i, /bearer/i, /authorization/i, /sk-[A-Za-z0-9-]{8,}/, /CRUMBVALUE/, /u:pw@/, /[A-Za-z0-9+/_-]{40,}/]) {
    assert.ok(!bad.test(stripped), 'secret-looking pattern found: ' + bad);
  }
  assert.equal(rec(readDoc(dir, '2026-11-02'), 'MSFT').failure.detail, 'ENOTFOUND');
  assert.equal(readDoc(dir, '2026-11-02').header.run_trigger, 'workflow_dispatch');
  // endpoint redaction as a unit
  assert.equal(c.redactEndpoint('https://user:pass@query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=5d&events=split&crumb=ZZZ&token=YYY#frag', 'AAPL'),
    'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=5d&events=split');
  assert.equal(c.redactEndpoint('https://query2.finance.yahoo.com/v8/finance/chart/2222.SR?range=1mo&interval=1d&events=split', '2222.SR'),
    'https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1mo&events=split');
  assert.ok(!c.ENDPOINT_TEMPLATE.includes('?crumb') && !/key|token|crumb/i.test(c.ENDPOINT_TEMPLATE));
  assert.equal(c.safeToken('https://x?crumb=1'), 'httpsxcrumb1');
});

test('determinism: same fixtures and clock => byte-identical files and identical chain hashes', async () => {
  const mk = async () => { const dir = tmp(); await run(dir, makeNet({}, '2026-11-02'), '2026-11-02T22:40:00Z'); await run(dir, makeNet({}, '2026-11-03'), '2026-11-03T22:40:00Z'); return dir; };
  const [a, b] = [await mk(), await mk()];
  for (const rel of ['snapshots/2026/2026-11-02.json', 'snapshots/2026/2026-11-03.json', 'snapshots/chain.jsonl', 'snapshots/HEAD.json']) {
    assert.ok(fs.readFileSync(path.join(a, rel)).equals(fs.readFileSync(path.join(b, rel))), rel);
  }
  // key order / insertion order never matters to the hash: canonical form is sorted
  const doc = readDoc(a, '2026-11-02');
  assert.equal(require('../snapshot/identity.cjs').contentHashForRun(doc.header, c.contentRows(doc).slice().reverse()), doc.chain.content_hash);
});

test('nothing fetched at all (systemic outage): nothing is written, the date stays collectable', async () => {
  const dir = tmp();
  const dead = makeNet({ '*': () => ({ status: 503, text: 'unavailable' }) });
  await assert.rejects(() => run(dir, dead, '2026-11-02T22:40:00Z'), (e) => e instanceof c.NothingFetchedError && e.exitCode === c.EXIT.NOTHING_FETCHED);
  assert.deepEqual(fs.existsSync(path.join(dir, 'snapshots')) ? fs.readdirSync(path.join(dir, 'snapshots')) : [], []);
  const r = await run(dir, makeNet(), '2026-11-02T23:10:00Z');                                         // a later retry on the same date works
  assert.equal(r.counts.ok, 4);
});

test('time budget: symbols not reached are recorded as failures (skipped_time_budget), not dropped', async () => {
  const dir = tmp();
  const r = await c.runCollection({ dir, net: makeNet(), now: makeClock('2026-11-02T22:40:00Z', 1000), sleep: noSleep(), universe: U, delayMs: 0, timeBudgetMs: 4500 });
  const doc = readDoc(dir, '2026-11-02');
  assert.equal(doc.records.length, 4);
  const skipped = doc.records.filter((x) => x.failure && x.failure.reason === 'skipped_time_budget');
  assert.ok(skipped.length >= 1 && skipped.length < 4, 'skipped=' + skipped.length);
  assert.equal(skipped[0].failure.attempts, 0);
  assert.equal(doc.header.status, 'partial'); assert.ok(r.verify.ok);
});

test('parseChart: shapes the response honestly', () => {
  assert.equal(c.parseChart('not json').reason, 'invalid_json');
  assert.equal(c.parseChart('{}').reason, 'no_chart');
  assert.equal(c.parseChart('{"chart":{"result":[],"error":null}}').reason, 'no_result');
  assert.equal(c.parseChart('{"chart":{"result":[{}],"error":null}}').reason, 'no_meta');
  assert.equal(c.parseChart('{"chart":{"result":null,"error":{"code":"Too Many Requests"}}}').reason, 'chart_error');
  assert.equal(c.parseChart('{"chart":{"result":[{"meta":{},"timestamp":[1]}],"error":null}}').reason, 'malformed_series');
  const ok = c.parseChart('{"chart":{"result":[{"meta":{"symbol":"A","gmtoffset":"x","extra_key":1}}],"error":null}}');
  assert.equal(ok.ok, true); assert.equal(ok.meta.gmtoffset, null); assert.deepEqual(ok.metaInvalid, ['gmtoffset']); assert.ok(ok.metaKeys.includes('extra_key'));
  assert.deepEqual(ok.bars, []);
  // session date uses the exchange offset: 23:30 UTC with +3h is already the next local day
  assert.equal(c.unixToDay(Date.parse('2026-11-02T23:30:00Z') / 1000, 10800), '2026-11-03');
  assert.equal(c.unixToDay(Date.parse('2026-11-02T23:30:00Z') / 1000, undefined), '2026-11-02');
  assert.equal(c.unixToDay(NaN, 0), null);
});

test('a full 80-symbol universe run (all healthy) stays complete with 80 distinct instrument ids', async () => {
  const dir = tmp();
  const r = await c.runCollection({ dir, net: makeNet(), now: makeClock('2026-11-02T22:40:00Z'), sleep: noSleep(), delayMs: 0 });
  assert.equal(r.counts.universe, 80); assert.equal(r.counts.ok, 80); assert.equal(r.status, 'complete');
  const doc = readDoc(dir, '2026-11-02');
  assert.deepEqual(doc.records.map((x) => x.instrument_id), Array.from({ length: 80 }, (_, i) => i + 1));
  assert.equal(doc.header.universe_sha256, require('../snapshot/identity.cjs').snapshotContentHash(doc.universe));
  assert.ok(c.verifyStore(dir).ok);
});

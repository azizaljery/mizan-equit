'use strict';
/**
 * collect.cjs - daily point-in-time (PIT) snapshot collector for the 80-symbol research universe.
 *
 * STATE: FIRST INCREMENT, CODE-TESTED ON OFFLINE FIXTURES ONLY. Never run against the live Yahoo endpoint from this
 * sandbox. Standalone research tool: NOT part of mizan-v45/, NOT production, changes no production behavior, reads and
 * writes nothing outside the snapshot directory it is given. It does not remove historical survivorship bias; it only
 * starts an append-only record on the day it first runs.
 *
 * What it does per run (one UTC date = one file):
 *   - fetches the Yahoo chart API (interval=1d) for every symbol of the universe, sequentially, with the same
 *     conventions as .github/workflows/fetch-research-prices.yml (query2/query1 alternation, 4 attempts, linear backoff,
 *     1.5 s between symbols);
 *   - stores per symbol: the chart `meta` identity fields actually returned (missing => null, never invented), the
 *     daily bars since the last snapshot as returned (+ restated bars inside a short overlap window), split/dividend
 *     events, and provenance (endpoint WITHOUT secrets, retrieved_at, http status, sha256 of the response body, version);
 *   - resolves every symbol to an internal instrument_id via identity.cjs (resolveInstrument): ticker is NOT the key;
 *     a hard identity conflict is QUARANTINED (new instrument_id, old one ended, evidence kept) - never merged;
 *   - records failures (reason, status, attempts) instead of dropping the symbol (dropping reintroduces survivorship);
 *   - writes snapshots/YYYY/YYYY-MM-DD.json (exclusive create, never overwritten), appends a line to
 *     snapshots/chain.jsonl and rewrites the derived snapshots/HEAD.json; the chain uses identity.cjs contentHashForRun
 *     / chainLink / verifyChain.
 *
 * Dependency-free: node: modules only. The network layer and the clock are injectable (tests pass fixtures).
 * Logging never includes response bodies - only counts, statuses and hashes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const id = require('./identity.cjs');

const COLLECTOR_VERSION = 'mizan-pit-collector/0.1.0';
const FORMAT = 'mizan-pit-snapshot/1';
const SOURCE = 'yahoo-chart';
// `events=split` is the value already used (and observed to work) by fetch-research-prices.yml. Dividends are NOT requested
// (adding `div` to the events parameter is unverified); they are stored only if a response happens to contain them.
const ENDPOINT_TEMPLATE = 'https://{query1|query2}.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range={range}&events=split';
const ALLOWED_QUERY_PARAMS = ['interval', 'range', 'events'];

const EXIT = Object.freeze({ OK: 0, FATAL: 1, CHAIN: 2, ALREADY_COLLECTED: 3, NOTHING_FETCHED: 4 });

// Same 80-symbol research universe as .github/workflows/fetch-research-prices.yml (a test checks they stay equal).
const SA_CODES = ['2222', '1120', '2010', '7010', '1180', '1211', '2380', '4030', '1150', '2020', '1010', '1060', '1140', '2350', '4002', '4190', '4003', '5110', '2082', '4013', '2280', '2290', '1050', '1030', '1020', '4200', '4300', '4001', '2060', '3030', '2310', '4263', '4260', '1303', '1304', '2050', '4061', '6010', '7020', '4005'];
const US_SYMBOLS = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'NVDA', 'JPM', 'V', 'JNJ', 'WMT', 'PG', 'XOM', 'HD', 'KO', 'PEP', 'MRK', 'CVX', 'ABBV', 'COST', 'MCD', 'CSCO', 'ORCL', 'CRM', 'ACN', 'NKE', 'TMO', 'DHR', 'LIN', 'TXN', 'HON', 'UNP', 'UPS', 'LOW', 'IBM', 'CAT', 'GE', 'MMM', 'AMGN', 'BA', 'INTC'];

// Tuning that is NOT part of identity.cjs CONFIG (all PROVISIONAL, none validated on live data).
const SETTINGS = Object.freeze({
  firstSightRange: '1mo',      // window requested for a symbol never seen before
  rangeMarginDays: 3,          // calendar-day margin added to (snapshot date - last stored session) when choosing a range
  restatementWindowBars: 20,   // stored bars per instrument kept in state, used to detect restated (changed) bars
  maxAttempts: 4,
  backoffMs: 4000,
  perSymbolDelayMs: 1500,
  requestTimeoutMs: 25000,
  timeBudgetMs: 25 * 60 * 1000,
  staleRegularMarketDays: 7,
});

const RANGE_TOKENS = [['5d', 7], ['1mo', 31], ['3mo', 92], ['6mo', 183], ['1y', 366], ['2y', 731], ['5y', 1827], ['10y', 3653], ['max', Infinity]];

// ---------------------------------------------------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------------------------------------------------
class CollectorError extends Error {
  constructor(message, exitCode) { super(message); this.name = this.constructor.name; this.exitCode = exitCode; }
}
class AlreadyCollectedError extends CollectorError { constructor(msg) { super(msg, EXIT.ALREADY_COLLECTED); } }
class ChainVerificationError extends CollectorError {
  constructor(errors, when) {
    super(`chain verification FAILED (${when}): ` + errors.slice(0, 10).map((e) => `${e.code}${e.seq != null ? '@' + e.seq : ''}`).join(', '), EXIT.CHAIN);
    this.errors = errors;
  }
}
class NothingFetchedError extends CollectorError { constructor(msg) { super(msg, EXIT.NOTHING_FETCHED); } }

// ---------------------------------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------------------------------
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isDayStr = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const dayNumber = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
const isoOf = (ms) => new Date(ms).toISOString();
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Keep only [A-Za-z0-9 _.-] (max 40 chars): safe to store as a failure detail (never a URL, never a message body). */
function safeToken(s) {
  const t = String(s === undefined || s === null ? '' : s).replace(/[^A-Za-z0-9 _.-]/g, '').trim().slice(0, 40);
  return t || 'unknown';
}

/** Exchange-local calendar date of a unix timestamp (seconds). gmtoffset (seconds) optional; returns null if not a finite number. */
function unixToDay(sec, gmtoffsetSec) {
  if (!isFiniteNum(sec)) return null;
  const off = isFiniteNum(gmtoffsetSec) ? gmtoffsetSec : 0;
  const d = new Date((sec + off) * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const s = d.toISOString();
  return /^\d{4}-/.test(s) ? s.slice(0, 10) : null;
}

function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortKeysDeep(v[k]); return o; }
  return v;
}
/** Drop `undefined` object members (-> absent), arrays keep position as null; leaves everything else for canonicalize() to judge. */
function scrub(v) {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : scrub(x)));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) if (v[k] !== undefined) o[k] = scrub(v[k]); return o; }
  return v;
}
const median = (vals) => {
  const a = vals.slice().sort((x, y) => x - y); const n = a.length;
  return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null;
};

/** Endpoint stored in provenance: scheme+host+path with the symbol replaced by {symbol}, only allow-listed query params, no userinfo, no fragment. */
function redactEndpoint(urlString, symbol) {
  const u = new URL(urlString);
  const q = [];
  for (const k of ALLOWED_QUERY_PARAMS) { const v = u.searchParams.get(k); if (v !== null) q.push(`${k}=${v.replace(/[^A-Za-z0-9,._-]/g, '')}`); }
  let p = u.pathname;
  if (symbol) p = p.split(encodeURIComponent(symbol)).join('{symbol}');
  return `${u.protocol}//${u.host}${p}` + (q.length ? '?' + q.join('&') : '');
}

function buildUrl(host, symbol, range) {
  return `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}&events=split`;
}

function chooseRange(lastSessionDate, snapshotDate) {
  if (!isDayStr(lastSessionDate)) return SETTINGS.firstSightRange;
  const need = dayNumber(snapshotDate) - dayNumber(lastSessionDate) + SETTINGS.rangeMarginDays;
  for (const [tok, days] of RANGE_TOKENS) if (days >= need) return tok;
  return 'max';
}

function buildUniverse() {
  return [...SA_CODES.map((c) => ({ symbol: c + '.SR', market: 'sa' })), ...US_SYMBOLS.map((s) => ({ symbol: s, market: 'us' }))];
}
function validateUniverse(u) {
  if (!Array.isArray(u) || !u.length) throw new CollectorError('universe: empty or not an array', EXIT.FATAL);
  const seen = new Set();
  for (const e of u) {
    if (!e || typeof e.symbol !== 'string' || !e.symbol.trim() || (e.market !== 'sa' && e.market !== 'us')) throw new CollectorError('universe: bad entry', EXIT.FATAL);
    if (seen.has(e.symbol)) throw new CollectorError('universe: duplicate symbol ' + safeToken(e.symbol), EXIT.FATAL);
    seen.add(e.symbol);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// network layer (injectable). net.getChart({url, host, symbol, range}) -> {status:number, text:string}; may throw.
// ---------------------------------------------------------------------------------------------------------------------
function defaultNet() {
  return {
    async getChart({ url }) {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'application/json' },
        signal: AbortSignal.timeout(SETTINGS.requestTimeoutMs),
      });
      const text = await r.text();
      return { status: r.status, text };
    },
  };
}

function classifyThrown(e) {
  const name = e && e.name;
  if (name === 'TimeoutError' || name === 'AbortError') return { reason: 'timeout', detail: null };
  const code = (e && (e.code || (e.cause && e.cause.code))) || name || 'unknown';
  return { reason: 'network_error', detail: safeToken(code) };
}

function reasonForStatus(status) {
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'http_' + status;
}

/**
 * Fetch one symbol with the convention of fetch-research-prices.yml: up to 4 attempts, query2 then query1 alternating,
 * linear backoff (4 s * attempt), 404 is final (no retry). Never throws. Returns
 * { status, sha256, text, attempts, endpoint, failure:null|{reason,detail} }.
 */
async function fetchSymbol({ net, symbol, range, sleep, now, deadlineMs }) {
  let status = null, sha = null, text = null, failure = { reason: 'not_attempted', detail: null }, attempts = 0, endpoint = null;
  for (let attempt = 0; attempt < SETTINGS.maxAttempts; attempt++) {
    if (now() > deadlineMs) { failure = { reason: 'skipped_time_budget', detail: null }; break; }
    const host = attempt % 2 ? 'query1' : 'query2';
    const url = buildUrl(host, symbol, range);
    endpoint = redactEndpoint(url, symbol);
    attempts++;
    let res;
    try { res = await net.getChart({ url, host, symbol, range }); }
    catch (e) {
      status = null; sha = null; text = null; failure = classifyThrown(e);
      if (attempt < SETTINGS.maxAttempts - 1) await sleep(SETTINGS.backoffMs * (attempt + 1));
      continue;
    }
    status = isFiniteNum(res && res.status) ? res.status : null;
    text = typeof (res && res.text) === 'string' ? res.text : null;
    sha = text !== null ? sha256Hex(text) : null;
    if (status !== null && status >= 200 && status < 300 && text !== null) { return { status, sha256: sha, text, attempts, endpoint, failure: null }; }
    failure = { reason: status === null ? 'invalid_response' : reasonForStatus(status), detail: null };
    if (status === 404) break;
    if (attempt < SETTINGS.maxAttempts - 1) await sleep(SETTINGS.backoffMs * (attempt + 1));
  }
  return { status, sha256: sha, text: null, attempts, endpoint, failure };
}

// ---------------------------------------------------------------------------------------------------------------------
// parsing the Yahoo chart response (pure). Nothing is invented: absent => null, wrong type => null + listed in invalid.
// ---------------------------------------------------------------------------------------------------------------------
const META_STRING_FIELDS = ['symbol', 'exchangeName', 'fullExchangeName', 'currency', 'instrumentType', 'longName', 'shortName', 'exchangeTimezoneName', 'timezone', 'dataGranularity'];
const META_NUMBER_FIELDS = ['firstTradeDate', 'regularMarketTime', 'gmtoffset'];

function extractMeta(m) {
  const out = {}, invalid = [];
  for (const f of META_STRING_FIELDS) {
    const v = m[f];
    if (v === undefined || v === null) out[f] = null;
    else if (typeof v === 'string' && v.trim()) out[f] = v.slice(0, 200);
    else { out[f] = null; invalid.push(f); }
  }
  for (const f of META_NUMBER_FIELDS) {
    const v = m[f];
    if (v === undefined || v === null) out[f] = null;
    else if (isFiniteNum(v)) out[f] = v;
    else { out[f] = null; invalid.push(f); }
  }
  const reg = m.currentTradingPeriod && typeof m.currentTradingPeriod === 'object' ? m.currentTradingPeriod.regular : null;
  out.currentTradingPeriodRegular = reg && isFiniteNum(reg.start) && isFiniteNum(reg.end) ? { start: reg.start, end: reg.end } : null;
  const keys = Object.keys(m).filter((k) => /^[A-Za-z0-9_]{1,40}$/.test(k)).sort().slice(0, 80);
  return { meta: out, invalid, keys };
}

function numField(arr, i, name, flags) {
  const v = Array.isArray(arr) ? arr[i] : undefined;
  if (v === undefined || v === null) { flags.push(name + '_missing'); return null; }
  if (!isFiniteNum(v)) { flags.push(name + '_invalid'); return null; }
  return v;
}

/**
 * Parse a response body. Returns {ok:false, reason, detail} or
 * {ok:true, meta, metaInvalid, metaKeys, bars:[{date,timestamp,open,high,low,close,adjclose,volume,quality_flags}], events, info}.
 */
function parseChart(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return { ok: false, reason: 'invalid_json', detail: null }; }
  const chart = j && typeof j === 'object' ? j.chart : null;
  if (!chart || typeof chart !== 'object') return { ok: false, reason: 'no_chart', detail: null };
  if (chart.error) {
    const code = safeToken(chart.error && chart.error.code);
    return { ok: false, reason: /not found/i.test(code) ? 'not_found' : 'chart_error', detail: code };
  }
  const result = Array.isArray(chart.result) ? chart.result[0] : null;
  if (!result || typeof result !== 'object') return { ok: false, reason: 'no_result', detail: null };
  const rawMeta = result.meta;
  if (!rawMeta || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) return { ok: false, reason: 'no_meta', detail: null };
  const { meta, invalid, keys } = extractMeta(rawMeta);
  const gmt = meta.gmtoffset;

  const ts = Array.isArray(result.timestamp) ? result.timestamp : null;
  const ind = result.indicators && typeof result.indicators === 'object' ? result.indicators : {};
  const q = Array.isArray(ind.quote) && ind.quote[0] && typeof ind.quote[0] === 'object' ? ind.quote[0] : null;
  const adj = Array.isArray(ind.adjclose) && ind.adjclose[0] && Array.isArray(ind.adjclose[0].adjclose) ? ind.adjclose[0].adjclose : null;
  if (ts && !q) return { ok: false, reason: 'malformed_series', detail: null };

  const bars = []; let badTs = 0;
  if (ts) {
    for (let i = 0; i < ts.length; i++) {
      const date = unixToDay(ts[i], gmt);
      if (date === null) { badTs++; continue; }
      const flags = [];
      const open = numField(q.open, i, 'open', flags), high = numField(q.high, i, 'high', flags), low = numField(q.low, i, 'low', flags);
      const close = numField(q.close, i, 'close', flags), volume = numField(q.volume, i, 'volume', flags);
      const adjclose = adj ? numField(adj, i, 'adjclose', flags) : null;
      if ([open, high, low, close].some((x) => x !== null && x <= 0)) flags.push('non_positive_price');
      if (volume !== null && volume < 0) flags.push('volume_negative');
      if ([open, high, low, close].every((x) => x !== null) && (high < low || high < Math.max(open, close) || low > Math.min(open, close))) flags.push('ohlc_inconsistent');
      bars.push({ date, timestamp: ts[i], open, high, low, close, adjclose, volume, quality_flags: flags });
    }
  }
  const events = { splits: [], dividends: [] };
  const ev = result.events && typeof result.events === 'object' ? result.events : {};
  if (ev.splits && typeof ev.splits === 'object') {
    for (const k of Object.keys(ev.splits).sort()) {
      const e = ev.splits[k] || {}; const t = isFiniteNum(e.date) ? e.date : (isFiniteNum(Number(k)) ? Number(k) : null);
      events.splits.push({ timestamp: t, date: unixToDay(t, gmt), numerator: isFiniteNum(e.numerator) ? e.numerator : null,
        denominator: isFiniteNum(e.denominator) ? e.denominator : null, split_ratio: typeof e.splitRatio === 'string' ? e.splitRatio.slice(0, 20) : null });
    }
  }
  if (ev.dividends && typeof ev.dividends === 'object') {
    for (const k of Object.keys(ev.dividends).sort()) {
      const e = ev.dividends[k] || {}; const t = isFiniteNum(e.date) ? e.date : (isFiniteNum(Number(k)) ? Number(k) : null);
      events.dividends.push({ timestamp: t, date: unixToDay(t, gmt), amount: isFiniteNum(e.amount) ? e.amount : null });
    }
  }
  return { ok: true, meta, metaInvalid: invalid, metaKeys: keys, bars, events, info: { bars_bad_timestamp: badTs, has_series: !!ts, adjclose_present: !!adj } };
}

// ---------------------------------------------------------------------------------------------------------------------
// state (a pure fold of the stored snapshot files - nothing lives anywhere else)
// ---------------------------------------------------------------------------------------------------------------------
function emptyState() { return { nextInstrumentId: 1, instruments: [], listings: [] }; }

const barValues = (b) => ({ open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, adjclose: b.adjclose });
const sameBar = (a, b) => ['open', 'high', 'low', 'close', 'volume', 'adjclose'].every((k) => a[k] === b[k]);

function refreshBarState(inst) {
  inst.recentBars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (inst.recentBars.length > SETTINGS.restatementWindowBars) inst.recentBars = inst.recentBars.slice(-SETTINGS.restatementWindowBars);
  const valid = inst.recentBars.filter((b) => isFiniteNum(b.close) && b.close > 0);
  const last = valid[valid.length - 1];
  if (last) { inst.lastSessionDate = last.date; inst.lastClose = last.close; } else { delete inst.lastSessionDate; delete inst.lastClose; }
  const vols = inst.recentBars.map((b) => b.volume).filter((v) => isFiniteNum(v) && v >= 0);
  const m = median(vols);
  if (m !== null) inst.volumeRef = m; else delete inst.volumeRef;
}

/** Apply one stored record to the state. Used identically for the live run and for the replay of stored files. */
function applyRecord(state, rec, snapshotDate) {
  if (rec.status !== 'ok') return;
  const res = rec.resolution, ii = rec.identity_input;
  let inst;
  if (res.action === 'split') {
    const old = state.instruments.find((i) => i.instrumentId === res.ended_instrument.instrument_id);
    if (!old) throw new Error('replay: ended instrument unknown');
    old.status = 'ended_identity_conflict';
    const l = state.listings.find((x) => x.instrumentId === old.instrumentId && x.validTo === null);
    if (l) l.validTo = res.ended_instrument.ended_on;
  }
  if (res.action === 'split' || res.action === 'new') {
    const ni = res.new_instrument;
    inst = {
      instrumentId: ni.instrument_id, symbol: ni.listing.symbol, exchange: ii.exchange, currency: ni.currency, name: ni.name,
      identifiers: ni.identifiers || {}, firstSeen: ni.first_seen, lastSeen: snapshotDate, status: 'active',
      instrumentType: rec.meta.instrumentType, timezone: rec.meta.exchangeTimezoneName, recentBars: [],
    };
    if (ni.provider_first_row_date) inst.firstRowDate = ni.provider_first_row_date;
    state.instruments.push(inst);
    state.listings.push({ instrumentId: inst.instrumentId, symbol: ni.listing.symbol, exchange: ni.listing.exchange, validFrom: ni.listing.valid_from, validTo: null });
    state.nextInstrumentId = ni.instrument_id + 1;
  } else {
    inst = state.instruments.find((i) => i.instrumentId === rec.instrument_id);
    if (!inst) throw new Error('replay: instrument unknown');
    inst.lastSeen = snapshotDate; inst.name = ii.name; inst.currency = ii.currency.toUpperCase(); inst.exchange = ii.exchange;
    if (!inst.firstRowDate && ii.first_row_date) inst.firstRowDate = ii.first_row_date;
    inst.instrumentType = rec.meta.instrumentType; inst.timezone = rec.meta.exchangeTimezoneName;
  }
  for (const b of rec.bars) {
    const v = { date: b.date, ...barValues(b) };
    const i = inst.recentBars.findIndex((x) => x.date === b.date);
    if (i >= 0) inst.recentBars[i] = v; else inst.recentBars.push(v);
  }
  refreshBarState(inst);
}

function replayState(docs) {
  const state = emptyState();
  for (const doc of docs) for (const rec of doc.records) applyRecord(state, rec, doc.header.snapshot_date);
  return state;
}

// ---------------------------------------------------------------------------------------------------------------------
// per-symbol record building
// ---------------------------------------------------------------------------------------------------------------------
function failureRecord(entry, status, fetchInfo, failure, retrievedAt, extra = {}, range = null) {
  return {
    symbol: entry.symbol, market: entry.market, status, instrument_id: null, quarantined: false, quarantine_id: null,
    failure: { reason: failure.reason, detail: failure.detail === undefined ? null : failure.detail, http_status: fetchInfo ? fetchInfo.status : null, attempts: fetchInfo ? fetchInfo.attempts : 0 },
    resolution: null, identity_input: null, meta: null, meta_keys_seen: null, meta_invalid_fields: null, derived: null, events: null,
    bars: [], bars_summary: null, warnings: extra.warnings || [],
    provenance: provenance(fetchInfo, retrievedAt, range),
  };
}
function provenance(fetchInfo, retrievedAt, range) {
  return {
    source: SOURCE, source_endpoint: fetchInfo && fetchInfo.endpoint ? fetchInfo.endpoint : null, retrieved_at: retrievedAt,
    http_status: fetchInfo ? fetchInfo.status : null, response_sha256: fetchInfo ? fetchInfo.sha256 : null,
    attempts: fetchInfo ? fetchInfo.attempts : 0, requested_range: range || null, collector_version: COLLECTOR_VERSION,
  };
}

function serializeNewInstrument(ni) {
  return {
    instrument_id: ni.instrumentId, market: ni.market, first_seen: ni.firstSeen, provider_first_row_date: ni.providerFirstRowDate || null,
    created_reason: ni.createdReason, name: ni.name, currency: ni.currency, identifiers: ni.identifiers || {},
    listing: { symbol: ni.listing.symbol, exchange: ni.listing.exchange, valid_from: ni.listing.validFrom, valid_to: null },
  };
}
function serializeQuarantine(q, snapshotDate) {
  return scrub({
    quarantine_id: `${snapshotDate}|${q.symbol}|${q.kind}`, kind: q.kind, snapshot_date: snapshotDate, symbol: q.symbol, exchange: q.exchange,
    old_instrument_id: q.oldInstrumentId, new_instrument_id: q.newInstrumentId === undefined ? null : q.newInstrumentId,
    reasons: q.reasons.slice(), status: 'open', evidence: q.evidence,
  });
}

/** Decide which of the returned bars are stored. New instrument: all (first sight). Existing: bars newer than the last stored session + restated bars. */
function selectBars(returned, inst, isNew) {
  const byDate = new Map(); let duplicates = 0;
  for (const b of returned) { if (byDate.has(b.date)) duplicates++; byDate.set(b.date, b); }
  const unique = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (isNew) return { chosen: unique.map((b) => ({ ...b, restated: false })), ignored: 0, duplicates };
  const chosen = []; let ignored = 0;
  for (const b of unique) {
    const stored = inst.recentBars.find((x) => x.date === b.date);
    if (!inst.lastSessionDate || b.date > inst.lastSessionDate) { if (!stored) { chosen.push({ ...b, restated: false }); continue; } }
    if (stored && !sameBar(stored, barValues(b))) { chosen.push({ ...b, restated: true, quality_flags: [...b.quality_flags, 'restated_vs_stored'] }); continue; }
    ignored++;
  }
  return { chosen, ignored, duplicates };
}

function processSymbol({ entry, fetchInfo, state, snapshotDate, retrievedAt, range }) {
  const parsed = parseChart(fetchInfo.text);
  if (!parsed.ok) return { record: scrub(failureRecord(entry, 'failed', fetchInfo, { reason: parsed.reason, detail: parsed.detail }, retrievedAt, {}, range)), quarantine: null };
  const { meta } = parsed;
  const warnings = [];
  const prov = provenance(fetchInfo, retrievedAt, range);
  const regularSec = meta.currentTradingPeriodRegular;
  const retrievedSec = Math.floor(Date.parse(retrievedAt) / 1000);
  const derived = {
    first_trade_date: unixToDay(meta.firstTradeDate, meta.gmtoffset),
    regular_market_time_iso: isFiniteNum(meta.regularMarketTime) && !Number.isNaN(new Date(meta.regularMarketTime * 1000).getTime()) ? isoOf(meta.regularMarketTime * 1000) : null,
    session_date_basis: isFiniteNum(meta.gmtoffset) ? 'exchange_local_via_meta_gmtoffset' : 'utc_fallback_no_gmtoffset',
  };
  if (parsed.metaInvalid.length) warnings.push('meta_invalid_fields');
  if (meta.symbol === null) warnings.push('meta_symbol_missing');
  if (derived.regular_market_time_iso && dayNumber(snapshotDate) - dayNumber(derived.regular_market_time_iso.slice(0, 10)) > SETTINGS.staleRegularMarketDays) warnings.push('stale_regular_market_time');
  if (!parsed.info.has_series) warnings.push('no_bars_in_response');
  if (parsed.info.has_series && !parsed.info.adjclose_present) warnings.push('adjclose_absent');
  if (parsed.info.bars_bad_timestamp) warnings.push('bars_with_bad_timestamp_skipped');

  const base = { meta, meta_keys_seen: parsed.metaKeys, meta_invalid_fields: parsed.metaInvalid, derived, events: parsed.events };
  const unresolved = (reason, detail) => ({ record: scrub({ ...failureRecord(entry, 'identity_unresolved', fetchInfo, { reason, detail }, retrievedAt, { warnings: warnings.slice() }, range), ...base, bars: [], unattributed_bars: parsed.bars }), quarantine: null });

  if (meta.symbol !== null && meta.symbol.trim().toUpperCase() !== entry.symbol.toUpperCase()) return unresolved('symbol_mismatch', null);
  const exchange = meta.exchangeName !== null ? meta.exchangeName : meta.fullExchangeName;
  const name = meta.longName !== null ? meta.longName : meta.shortName;
  const missing = [];
  if (exchange === null) missing.push('exchange');
  if (meta.currency === null) missing.push('currency');
  if (name === null) missing.push('name');
  if (missing.length) return unresolved('identity_fields_missing', missing.join(','));
  if (meta.exchangeName === null) warnings.push('exchange_from_fullExchangeName');
  if (!id.normalizeExchange(exchange).mapped) warnings.push('exchange_unmapped');   // visible on day 1 too (the detector only runs from day 2)
  if (meta.longName === null) warnings.push('name_from_shortName');

  // bars handed to the detector: valid, strictly ascending, unique by date
  const det = new Map();
  for (const b of parsed.bars) {
    if (b.close === null || !(b.close > 0)) continue;
    det.set(b.date, {
      date: b.date, close: b.close, volume: b.volume !== null && b.volume >= 0 ? b.volume : null,
      open: b.open !== null && b.open > 0 ? b.open : null, high: b.high !== null && b.high > 0 ? b.high : null, low: b.low !== null && b.low > 0 ? b.low : null,
    });
  }
  const incoming = {
    market: entry.market, snapshotDate, symbol: entry.symbol, exchange, currency: meta.currency, name, identifiers: {},
    ...(derived.first_trade_date ? { firstRowDate: derived.first_trade_date } : {}),
    bars: [...det.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
  const identityInput = {
    symbol: entry.symbol, exchange, exchange_source: meta.exchangeName !== null ? 'exchangeName' : 'fullExchangeName', currency: meta.currency,
    name, name_source: meta.longName !== null ? 'longName' : 'shortName', identifiers: {}, first_row_date: derived.first_trade_date,
  };

  const res = id.resolveInstrument(state, incoming);
  if (res.action === 'rejected') return unresolved('identity_input_rejected', res.rejectReasons.slice(0, 5).map(safeToken).join(';'));

  let resolution, quarantine = null, instrumentId, isNew = false, inst = null;
  if (res.action === 'existing') {
    instrumentId = res.instrumentId; inst = state.instruments.find((i) => i.instrumentId === instrumentId);
    resolution = { action: 'existing', new_instrument: null, ended_instrument: null, skipped_rules: res.skippedRules || [] };
    if (res.review) quarantine = serializeQuarantine(res.review, snapshotDate);
    if (inst.instrumentType && meta.instrumentType && inst.instrumentType !== meta.instrumentType) warnings.push('instrument_type_changed');
    if (inst.timezone && meta.exchangeTimezoneName && inst.timezone !== meta.exchangeTimezoneName) warnings.push('exchange_timezone_changed');
  } else {
    isNew = true; instrumentId = res.newInstrument.instrumentId;
    resolution = { action: res.action, new_instrument: serializeNewInstrument(res.newInstrument), ended_instrument: null, skipped_rules: [] };
    if (res.action === 'split') {
      const e = res.endedInstrument;
      resolution.ended_instrument = { instrument_id: e.instrumentId, status: e.status, ended_on: e.endedOn, detected_on: e.detectedOn, listing_close: { symbol: e.listingClose.symbol, exchange: e.listingClose.exchange, valid_to: e.listingClose.validTo } };
    }
    if (res.quarantine) quarantine = serializeQuarantine(res.quarantine, snapshotDate);
  }
  for (const w of res.warnings || []) if (!warnings.includes(w)) warnings.push(w);
  resolution.warnings = (res.warnings || []).slice();

  const firstSeen = isNew ? snapshotDate : inst.firstSeen;
  const { chosen, ignored, duplicates } = selectBars(parsed.bars, inst, isNew);
  const splitsByDate = new Map(parsed.events.splits.filter((s) => s.date).map((s) => [s.date, s]));
  const divsByDate = new Map(parsed.events.dividends.filter((s) => s.date).map((s) => [s.date, s]));
  const sessionStartDay = regularSec ? unixToDay(regularSec.start, meta.gmtoffset) : null;
  const bars = chosen.map((b) => {
    const flags = b.quality_flags.slice();
    if (regularSec && b.date === sessionStartDay && retrievedSec < regularSec.end) flags.push('session_possibly_open_at_retrieval');
    const s = splitsByDate.get(b.date), d = divsByDate.get(b.date);
    return {
      date: b.date, timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, adjclose: b.adjclose, volume: b.volume,
      split_numerator: s ? s.numerator : null, split_denominator: s ? s.denominator : null, dividend_amount: d ? d.amount : null,
      is_backfill: b.date < firstSeen, restated: b.restated, quality_flags: flags,
    };
  });

  const rec = {
    symbol: entry.symbol, market: entry.market, status: 'ok', instrument_id: instrumentId,
    quarantined: quarantine !== null, quarantine_id: quarantine ? quarantine.quarantine_id : null,
    failure: null, resolution, identity_input: identityInput, ...base, bars,
    bars_summary: { returned: parsed.bars.length, stored: bars.length, ignored_known_or_older: ignored, duplicate_dates_in_response: duplicates, bad_timestamp_skipped: parsed.info.bars_bad_timestamp, adjclose_present: parsed.info.adjclose_present },
    warnings, provenance: prov,
  };
  return { record: scrub(rec), quarantine };
}

// ---------------------------------------------------------------------------------------------------------------------
// store: snapshots/YYYY/YYYY-MM-DD.json + snapshots/chain.jsonl (append-only index) + snapshots/HEAD.json (derived head)
// ---------------------------------------------------------------------------------------------------------------------
const SNAP_DIR = 'snapshots';
const FILE_RE = /^snapshots\/(\d{4})\/(\d{4}-\d{2}-\d{2})\.json$/;
const snapshotRelPath = (date) => `${SNAP_DIR}/${date.slice(0, 4)}/${date}.json`;

function contentRows(doc) {
  return [
    ...doc.universe.map((u) => ({ __type: 'universe', ...u })),
    ...doc.records.map((r) => ({ __type: 'record', ...r })),
    ...doc.quarantine.map((q) => ({ __type: 'quarantine', ...q })),
  ];
}
const contentInputFor = (doc) => [{ __run_header__: doc.header }, ...contentRows(doc)];

function listSnapshotFiles(dir) {
  const out = [], root = path.join(dir, SNAP_DIR);
  if (!fs.existsSync(root)) return out;
  for (const y of fs.readdirSync(root)) {
    const yp = path.join(root, y);
    if (!/^\d{4}$/.test(y) || !fs.statSync(yp).isDirectory()) continue;
    for (const f of fs.readdirSync(yp)) if (/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) out.push(`${SNAP_DIR}/${y}/${f}`);
  }
  return out.sort();
}

/** Reads chain.jsonl + the files it lists. Never throws on tampered content: problems come back as `errors`. */
function loadStore(dir) {
  const errors = [], entries = [], docs = [], fileBytes = {};
  const chainPath = path.join(dir, SNAP_DIR, 'chain.jsonl');
  if (fs.existsSync(chainPath)) {
    const lines = fs.readFileSync(chainPath, 'utf8').split('\n').filter((l) => l.length);
    lines.forEach((l, i) => { try { entries.push(JSON.parse(l)); } catch (e) { errors.push({ seq: null, code: 'bad_chain_line', detail: `line ${i + 1}` }); } });
  }
  for (const e of entries) {
    const rel = e && typeof e.file === 'string' ? e.file : '';
    const m = FILE_RE.exec(rel);
    if (!m || m[2] !== e.snapshot_date) { errors.push({ seq: e && e.seq, code: 'bad_file_reference', detail: 'file path not of the form snapshots/YYYY/YYYY-MM-DD.json matching snapshot_date' }); docs.push(null); continue; }
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) { errors.push({ seq: e.seq, code: 'missing_file', detail: rel }); docs.push(null); continue; }
    const bytes = fs.readFileSync(p);
    fileBytes[rel] = bytes;
    try { docs.push(JSON.parse(bytes.toString('utf8'))); } catch (err) { errors.push({ seq: e.seq, code: 'unparseable_file', detail: rel }); docs.push(null); }
  }
  return { entries, docs, fileBytes, errors };
}

function verifyLoaded(dir, loaded, opts = {}) {
  const errors = loaded.errors.slice();
  const add = (seq, code, detail) => errors.push({ seq, code, detail });
  const runs = [];
  loaded.entries.forEach((e, i) => {
    const doc = loaded.docs[i];
    const run = { seq: e.seq, prevHash: e.prev_hash, contentHash: e.content_hash, chainHash: e.chain_hash };
    if (doc) {
      const bytes = loaded.fileBytes[e.file];
      if (sha256Hex(bytes) !== e.file_sha256) add(e.seq, 'file_sha256_mismatch', e.file);
      try {
        if (!doc.header || doc.format !== FORMAT || !Array.isArray(doc.universe) || !Array.isArray(doc.records) || !Array.isArray(doc.quarantine)) throw new Error('shape');
        if (doc.header.snapshot_date !== e.snapshot_date) add(e.seq, 'date_mismatch', e.file);
        if (doc.header.seq !== e.seq) add(e.seq, 'seq_mismatch', e.file);
        const c = doc.chain || {};
        if (c.content_hash !== e.content_hash || c.prev_hash !== e.prev_hash || c.chain_hash !== e.chain_hash || c.seq !== e.seq) add(e.seq, 'file_chain_block_mismatch', e.file);
        run.contentInput = contentInputFor(doc);
      } catch (err) { add(e.seq, 'invalid_snapshot_shape', e.file); }
    }
    runs.push(run);
  });
  const chk = id.verifyChain(runs, opts.anchor ? { anchor: opts.anchor } : {});
  for (const er of chk.errors) errors.push(er);
  let prevDate = null;
  for (const e of loaded.entries) {
    if (prevDate !== null && !(e.snapshot_date > prevDate)) add(e.seq, 'date_not_increasing', e.snapshot_date);
    prevDate = e.snapshot_date;
  }
  const listed = new Set(loaded.entries.map((e) => e.file));
  for (const f of listSnapshotFiles(dir)) if (!listed.has(f)) add(null, 'unlisted_snapshot_file', f);
  const headPath = path.join(dir, SNAP_DIR, 'HEAD.json');
  const last = loaded.entries[loaded.entries.length - 1];
  if (last) {
    try {
      const h = JSON.parse(fs.readFileSync(headPath, 'utf8'));
      if (h.seq !== last.seq || h.chain_hash !== last.chain_hash || h.snapshot_date !== last.snapshot_date) add(last.seq, 'head_file_mismatch', 'HEAD.json differs from the last chain line');
    } catch (e) { add(last.seq, 'head_file_missing_or_bad', 'HEAD.json'); }
  } else if (fs.existsSync(headPath)) add(null, 'head_without_chain', 'HEAD.json');
  return { ok: errors.length === 0, errors, head: chk.head ? { seq: chk.head.seq, chain_hash: chk.head.chainHash } : null, runs: loaded.entries.length };
}

function verifyStore(dir, opts = {}) { return verifyLoaded(dir, loadStore(dir), opts); }

// ---------------------------------------------------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------------------------------------------------
async function runCollection(opts) {
  const {
    dir, net = defaultNet(), now = Date.now, sleep = defaultSleep, universe = buildUniverse(), delayMs = SETTINGS.perSymbolDelayMs,
    timeBudgetMs = SETTINGS.timeBudgetMs, trigger = null, runContext = null, log = () => {},
  } = opts;
  if (typeof dir !== 'string' || !dir) throw new CollectorError('--dir is required', EXIT.FATAL);
  validateUniverse(universe);
  const startMs = now();
  const snapshotDate = isoOf(startMs).slice(0, 10);
  const rel = snapshotRelPath(snapshotDate);
  const abs = path.join(dir, rel);

  const loaded = loadStore(dir);
  if (fs.existsSync(abs) || loaded.entries.some((e) => e.snapshot_date === snapshotDate)) {
    throw new AlreadyCollectedError(`REFUSED: a snapshot for ${snapshotDate} already exists (${rel}). Snapshots are append-only: nothing was fetched, nothing was changed.`);
  }
  const pre = verifyLoaded(dir, loaded);
  if (!pre.ok) throw new ChainVerificationError(pre.errors, 'before run; nothing was written');
  const last = loaded.entries[loaded.entries.length - 1] || null;
  if (last && !(snapshotDate > last.snapshot_date)) throw new CollectorError(`REFUSED: snapshot date ${snapshotDate} is not after the last stored date ${last.snapshot_date}`, EXIT.FATAL);

  const state = replayState(loaded.docs);
  const seq = last ? last.seq + 1 : 1;
  const prevHash = last ? last.chain_hash : id.GENESIS_HASH;
  const deadlineMs = startMs + timeBudgetMs;

  const records = [], quarantines = [], statusCounts = {};
  const count = (k) => { statusCounts[k] = (statusCounts[k] || 0) + 1; };
  for (let n = 0; n < universe.length; n++) {
    const entry = universe[n];
    const inst = state.instruments.find((i) => i.symbol === entry.symbol && i.status !== 'ended_identity_conflict');
    const range = chooseRange(inst ? inst.lastSessionDate : null, snapshotDate);
    const fetchInfo = await fetchSymbol({ net, symbol: entry.symbol, range, sleep, now, deadlineMs });
    const retrievedAt = isoOf(now());
    let out;
    if (fetchInfo.failure) {
      out = { record: scrub(failureRecord(entry, 'failed', fetchInfo, fetchInfo.failure, retrievedAt, {}, range)), quarantine: null };
    } else {
      try {
        out = processSymbol({ entry, fetchInfo, state, snapshotDate, retrievedAt, range });
        id.canonicalize(out.record); if (out.quarantine) id.canonicalize(out.quarantine);   // must be hashable: no NaN / undefined
      } catch (e) {
        out = { record: scrub(failureRecord(entry, 'failed', fetchInfo, { reason: 'internal_error', detail: safeToken(e && e.name) }, retrievedAt, {}, range)), quarantine: null };
      }
    }
    // the reducer runs on the record exactly as it will be stored (applyRecord is also what the next run replays)
    applyRecord(state, out.record, snapshotDate);
    records.push(out.record);
    if (out.quarantine && !quarantines.some((q) => q.quarantine_id === out.quarantine.quarantine_id)) quarantines.push(out.quarantine);
    count(out.record.status === 'ok' ? 'ok' : out.record.status);
    const httpKey = fetchInfo.failure ? (fetchInfo.status !== null ? String(fetchInfo.status) : fetchInfo.failure.reason) : String(fetchInfo.status);
    statusCounts['http:' + httpKey] = (statusCounts['http:' + httpKey] || 0) + 1;
    log(`${entry.symbol} ${out.record.status}` + (out.record.failure ? ` reason=${out.record.failure.reason} http=${out.record.failure.http_status} attempts=${out.record.failure.attempts}` : ` id=${out.record.instrument_id} bars=${out.record.bars.length}${out.record.quarantined ? ' QUARANTINED' : ''}`));
    if (n < universe.length - 1) await sleep(delayMs);
  }

  const okCount = records.filter((r) => r.status === 'ok').length;
  const unresolvedCount = records.filter((r) => r.status === 'identity_unresolved').length;
  if (okCount + unresolvedCount === 0) {
    throw new NothingFetchedError(`NOTHING WRITTEN: none of the ${universe.length} symbols returned a parseable response (systemic outage or block). The date ${snapshotDate} stays collectable; re-run later.`);
  }
  const httpSummary = {};
  for (const [k, v] of Object.entries(statusCounts)) if (k.startsWith('http:')) httpSummary[k.slice(5)] = v;
  const universeRows = universe.map((u) => ({ symbol: u.symbol, market: u.market }));
  const header = {
    format: FORMAT, seq, snapshot_date: snapshotDate, kind: 'daily-instrument-snapshot', source: SOURCE, source_endpoint: ENDPOINT_TEMPLATE,
    retrieved_at: isoOf(startMs), collector_version: COLLECTOR_VERSION, run_trigger: trigger, run_context: runContext,
    http_status_summary: httpSummary, universe_count: universe.length, universe_sha256: id.snapshotContentHash(universeRows),
    ok_count: okCount, failed_count: records.filter((r) => r.status === 'failed').length, identity_unresolved_count: unresolvedCount,
    quarantined_count: records.filter((r) => r.quarantined).length, bars_stored_total: records.reduce((a, r) => a + r.bars.length, 0),
    status: okCount === universe.length ? 'complete' : 'partial',
    identity_config: { status: id.CONFIG.status, sha256: id.snapshotContentHash([id.CONFIG]) },
  };
  const doc = { format: FORMAT, header: scrub(header), universe: universeRows, records, quarantine: quarantines, chain: null };
  const contentHash = id.contentHashForRun(doc.header, contentRows(doc));
  doc.chain = { seq, prev_hash: prevHash, content_hash: contentHash, chain_hash: id.chainLink(prevHash, contentHash) };

  const body = JSON.stringify(sortKeysDeep(doc), null, 1) + '\n';
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, { flag: 'wx' });                      // exclusive create: never overwrites
  const line = { seq, snapshot_date: snapshotDate, file: rel, file_sha256: sha256Hex(Buffer.from(body, 'utf8')), content_hash: contentHash, prev_hash: prevHash, chain_hash: doc.chain.chain_hash };
  fs.appendFileSync(path.join(dir, SNAP_DIR, 'chain.jsonl'), JSON.stringify(sortKeysDeep(line)) + '\n');
  const headTmp = path.join(dir, SNAP_DIR, 'HEAD.json.tmp');
  fs.writeFileSync(headTmp, JSON.stringify(sortKeysDeep({ format: FORMAT, seq, snapshot_date: snapshotDate, file: rel, chain_hash: doc.chain.chain_hash }), null, 1) + '\n');
  fs.renameSync(headTmp, path.join(dir, SNAP_DIR, 'HEAD.json'));

  const post = verifyStore(dir);
  if (!post.ok) throw new ChainVerificationError(post.errors, 'after write');
  return { file: rel, snapshotDate, seq, chainHash: doc.chain.chain_hash, contentHash, status: header.status, header: doc.header, state, verify: post, counts: { universe: universe.length, ok: okCount, failed: header.failed_count, identity_unresolved: unresolvedCount, quarantined: header.quarantined_count, bars: header.bars_stored_total } };
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI:  node collect.cjs run    --dir <store> [--delay-ms N] [--time-budget-min N]
//       node collect.cjs verify --dir <store> [--anchor-seq N --anchor-hash H]
// exit codes: 0 ok | 1 fatal | 2 chain verification failed | 3 date already collected (refused) | 4 nothing fetched (nothing written)
// ---------------------------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true; } else out._.push(a);
  }
  return out;
}

function writeGithubOutput(kv) {
  const p = process.env.GITHUB_OUTPUT;
  if (!p) return;
  fs.appendFileSync(p, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  try {
    if (cmd === 'verify') {
      if (typeof args.dir !== 'string') throw new CollectorError('--dir is required', EXIT.FATAL);
      const anchor = args['anchor-seq'] !== undefined ? { seq: Number(args['anchor-seq']), chainHash: String(args['anchor-hash'] || '') } : undefined;
      const v = verifyStore(args.dir, { anchor });
      if (!v.ok) { console.error('CHAIN VERIFICATION FAILED: ' + v.errors.slice(0, 20).map((e) => `${e.code}@${e.seq}`).join(', ')); return EXIT.CHAIN; }
      console.log(`chain OK runs=${v.runs}` + (v.head ? ` head_seq=${v.head.seq} head_chain_hash=${v.head.chain_hash}` : ' (empty store)'));
      return EXIT.OK;
    }
    if (cmd === 'run') {
      const r = await runCollection({
        dir: args.dir,
        delayMs: args['delay-ms'] !== undefined ? Number(args['delay-ms']) : SETTINGS.perSymbolDelayMs,
        timeBudgetMs: args['time-budget-min'] !== undefined ? Number(args['time-budget-min']) * 60000 : SETTINGS.timeBudgetMs,
        trigger: process.env.GITHUB_EVENT_NAME || null,
        runContext: process.env.GITHUB_RUN_ID ? { github_run_id: process.env.GITHUB_RUN_ID, github_sha: process.env.GITHUB_SHA || null } : null,
        log: (l) => console.log(l),
      });
      console.log(`WROTE ${r.file} seq=${r.seq} status=${r.status} ok=${r.counts.ok}/${r.counts.universe} failed=${r.counts.failed} identity_unresolved=${r.counts.identity_unresolved} quarantined=${r.counts.quarantined} bars=${r.counts.bars}`);
      console.log(`content_hash=${r.contentHash}\nchain_hash=${r.chainHash}\nhttp_status_summary=${JSON.stringify(r.header.http_status_summary)}`);
      writeGithubOutput({ snapshot_file: r.file, snapshot_date: r.snapshotDate, seq: r.seq, chain_hash: r.chainHash, status: r.status, ok: r.counts.ok, universe: r.counts.universe, failed: r.counts.failed, quarantined: r.counts.quarantined });
      return EXIT.OK;
    }
    throw new CollectorError('usage: collect.cjs run --dir <store> | verify --dir <store> [--anchor-seq N --anchor-hash H]', EXIT.FATAL);
  } catch (e) {
    if (e instanceof CollectorError) { console.error((e.exitCode === EXIT.ALREADY_COLLECTED ? '' : 'ERROR: ') + e.message); return e.exitCode; }
    console.error('ERROR: unexpected ' + safeToken(e && e.name));
    return EXIT.FATAL;
  }
}

if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });

module.exports = {
  COLLECTOR_VERSION, FORMAT, ENDPOINT_TEMPLATE, EXIT, SETTINGS, SA_CODES, US_SYMBOLS,
  CollectorError, AlreadyCollectedError, ChainVerificationError, NothingFetchedError,
  buildUniverse, buildUrl, redactEndpoint, chooseRange, safeToken, unixToDay,
  fetchSymbol, parseChart, processSymbol, selectBars,
  emptyState, applyRecord, replayState,
  contentRows, contentInputFor, snapshotRelPath, loadStore, verifyStore,
  runCollection, main, parseArgs,
};

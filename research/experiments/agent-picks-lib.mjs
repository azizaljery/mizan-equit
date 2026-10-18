/**
 * agent-picks-lib.mjs — pure helpers for the automated "agent picks" runs (research/agent-picks/).
 *
 * STATUS: IMPLEMENTED + CODE-TESTED (research/tests/agent-picks.test.mjs). Passing tests is NOT predictive evidence.
 * This is a DESCRIPTIVE forward record of what the live site's forecasts() said for momentum-selected stocks and what
 * then happened. It is NOT the DIR-0002 ledger and NOT its formal test (PROTOCOL-DIR-0002.md §5): no claim, no decision,
 * no model is ever called "validated" from these numbers (REGISTRY.md).
 *
 * Dependency-free (node: built-ins only). No network and no clock in this file: callers inject them.
 */

// ------------------------------------------------------------------------------------------------ constants
/** Copy of the FROZEN universe of mizan-v45/lib/daily-picks-universe.ts (a test checks both stay identical). */
export const SA_UNIVERSE = Object.freeze(['1010', '1020', '1030', '1050', '1060', '1120', '1140', '1150', '1180', '1211', '1303', '1304', '2010', '2020', '2050', '2060', '2082', '2222', '2280', '2290',
  '2310', '2350', '2380', '3030', '4001', '4002', '4003', '4005', '4013', '4030', '4061', '4190', '4200', '4260', '4263', '4300', '5110', '6010', '7010', '7020'].map((s) => s + '.SR'));
export const US_UNIVERSE = Object.freeze(['AAPL', 'ABBV', 'ACN', 'AMGN', 'AMZN', 'BA', 'CAT', 'COST', 'CRM', 'CSCO', 'CVX', 'DHR', 'GE', 'GOOGL', 'HD', 'HON', 'IBM', 'INTC', 'JNJ', 'JPM',
  'KO', 'LIN', 'LOW', 'MCD', 'META', 'MMM', 'MRK', 'MSFT', 'NKE', 'NVDA', 'ORCL', 'PEP', 'PG', 'TMO', 'TXN', 'UNP', 'UPS', 'V', 'WMT', 'XOM']);
export const UNIVERSE = Object.freeze({ sa: SA_UNIVERSE, us: US_UNIVERSE });
export const MARKETS = Object.freeze(['sa', 'us']);
export const MARKET_TZ = Object.freeze({ sa: 'Asia/Riyadh', us: 'America/New_York' });
export const CURRENCY = Object.freeze({ sa: 'SAR', us: 'USD' });
/** Weekend days (getUTCDay of a YYYY-MM-DD at noon UTC) — Tadawul Fri/Sat, US Sat/Sun. */
export const WEEKEND = Object.freeze({ sa: [5, 6], us: [0, 6] });
/** Session calendars (same as lib/market-data.ts saudiSessionCalendar and daily-picks-universe US_CALENDAR_SYMBOL). */
export const CALENDAR_SYMBOLS = Object.freeze({ sa: Object.freeze(['2222.SR', '1120.SR', '2010.SR']), us: Object.freeze(['SPY']) });

export const HORIZONS = Object.freeze([1, 5, 21]);
/** Same neutral thresholds as forecasts() in lib/research-model.ts (h1 0.1%, h<=5 0.25%, else 0.5%). */
export const NEUTRAL_THRESHOLD_PCT = Object.freeze({ 1: 0.1, 5: 0.25, 21: 0.5 });
export const HORIZON_NAME = Object.freeze({ 1: 'يومي (جلسة واحدة)', 5: 'أسبوعي (5 جلسات)', 21: 'شهري (21 جلسة)' });
export const DIRECTIONS = Object.freeze(['صاعد', 'محايد', 'هابط', 'غير متاح']);
export const UP = 'صاعد', DOWN = 'هابط', NEUTRAL = 'محايد', NA = 'غير متاح';

export const MOMENTUM_LOOKBACK = 126, MOMENTUM_SKIP = 5; // mom126_5 = close[t-5]/close[t-131]-1
export const MIN_BARS_FOR_MOMENTUM = MOMENTUM_LOOKBACK + MOMENTUM_SKIP + 1; // 132 closes: indices t-131 .. t
export const TOP_FRACTION = 0.2;
export const MIN_RANK_COVERAGE = 0.75; // PROTOCOL-DIR-0002 implementation note: < 75% ranked => gap day
export const UNAVAILABLE_AFTER_SESSIONS = 10; // PROTOCOL-DIR-0002 implementation note
export const OWNER_TARGET_PCT = 80; // owner's stated ambition — reference only, never a success criterion
export const MIN_NEFF = 60; // PROTOCOL-NEGSEL-0002-AMEND-1: minimum effectively independent observations
export const MIN_POINTS_FOR_RHO = 10;

export const SCHEMA_RUN = 'mizan-agent-picks-run/1';
export const SCHEMA_OUTCOMES = 'mizan-agent-picks-outcomes/1';
export const SELECTION_VERSION = 'agent-picks-mom126_5-rank-v1';
export const GOVERNANCE_NOTE = 'سجل وصفي استكشافي (EXPLORATORY). ليس سجل DIR-0002 ولا اختباره الرسمي، ولا يثبت دقة أي نموذج؛ لا يُتخذ قرار قبل n_eff ≥ 60 (AMEND-1).';

// ------------------------------------------------------------------------------------------------ small utils
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const num = (v) => (isNum(v) ? v : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s) => typeof s === 'string' && DATE_RE.test(s);
export const clip = (s, n = 200) => (s === null || s === undefined ? null : String(s).replace(/\s+/g, ' ').trim().slice(0, n));

const fmtCache = new Map();
/** Calendar date (YYYY-MM-DD) of an epoch-ms instant in an IANA time zone. */
export function localDate(ms, tz) {
  if (!isNum(ms)) return null;
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); fmtCache.set(tz, f); }
  return f.format(new Date(ms));
}
export function addDays(date, n) { return new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
export function weekday(date) { return new Date(date + 'T12:00:00Z').getUTCDay(); }

/** ISO-8601 week label, e.g. 2026-W42. */
export function isoWeek(date) {
  const d = new Date(date + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// ------------------------------------------------------------------------------------------------ Yahoo chart parsing
const US_EXCHANGES = new Set(['NMS', 'NGM', 'NCM', 'NYQ', 'NYS', 'ASE', 'PCX', 'BTS', 'PNK', 'OTC', 'OQB', 'OQX', 'NASDAQ', 'NYSE', 'NYSEARCA', 'NYSE AMERICAN', 'BATS']);
const SA_EXCHANGES = new Set(['SAU', 'SAUDI', 'TADAWUL']);
export class IdentityError extends Error { constructor(m) { super(m); this.name = 'IdentityError'; } }

/** Same rules as mizan-v45/lib/market-identity.ts validateMarketIdentity (ETF allowed for the SPY calendar). */
export function validateIdentity(meta, symbol) {
  if (!meta || meta.symbol !== symbol) throw new IdentityError('symbol_mismatch');
  if (!['EQUITY', 'ETF'].includes(meta.instrumentType)) throw new IdentityError('instrument_type');
  const exchange = String(meta.exchangeName || meta.fullExchangeName || '').trim().toUpperCase();
  if (symbol.endsWith('.SR')) {
    if (meta.currency !== 'SAR') throw new IdentityError('currency');
    if (!SA_EXCHANGES.has(exchange)) throw new IdentityError('exchange');
  } else {
    if (meta.currency !== 'USD') throw new IdentityError('currency');
    if (!US_EXCHANGES.has(exchange)) throw new IdentityError('exchange');
  }
  return true;
}

/**
 * Parse a Yahoo v8 chart response for `symbol` (market sa|us). Throws IdentityError / Error('no_result').
 * Returns {meta, bars:[{date, close}] ascending unique dates (exchange-local), splits:[date]}.
 * Bars with a missing/non-positive close are dropped (never invented).
 */
export function parseChart(json, symbol, market) {
  const r = json && json.chart && Array.isArray(json.chart.result) ? json.chart.result[0] : null;
  if (!r || !r.meta) throw new Error('no_result');
  validateIdentity(r.meta, symbol);
  if (r.meta.dataGranularity && r.meta.dataGranularity !== '1d') throw new Error('granularity');
  const tz = MARKET_TZ[market];
  const ts = Array.isArray(r.timestamp) ? r.timestamp : [];
  const q = r.indicators && Array.isArray(r.indicators.quote) && r.indicators.quote[0] ? r.indicators.quote[0] : {};
  const closes = Array.isArray(q.close) ? q.close : [];
  const byDate = new Map();
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (!isNum(ts[i]) || !isNum(c) || c <= 0) continue;
    byDate.set(localDate(ts[i] * 1000, tz), c); // last bar of a date wins
  }
  const bars = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, close]) => ({ date, close }));
  const sp = r.events && r.events.splits && typeof r.events.splits === 'object' ? Object.values(r.events.splits) : [];
  const splits = sp.filter((s) => s && isNum(s.date)).map((s) => localDate(s.date * 1000, tz)).sort();
  const m = r.meta;
  return {
    meta: { symbol: m.symbol, currency: m.currency, exchangeName: m.exchangeName || null, instrumentType: m.instrumentType, regularMarketTime: num(m.regularMarketTime) },
    bars, splits,
  };
}

// ------------------------------------------------------------------------------------------------ momentum + ranking
/** mom126_5 = close[t-5]/close[t-131] - 1 with t = last bar. */
export function momentum126_5(bars) {
  const n = Array.isArray(bars) ? bars.length : 0;
  if (n < MIN_BARS_FOR_MOMENTUM) return { value: null, reason: 'insufficient_history', sessions: n };
  const a = bars[n - 1 - MOMENTUM_SKIP].close, b = bars[n - 1 - MOMENTUM_SKIP - MOMENTUM_LOOKBACK].close;
  if (!isNum(a) || !isNum(b) || b <= 0) return { value: null, reason: 'invalid_close', sessions: n };
  return { value: a / b - 1, reason: null, sessions: n, t: bars[n - 1].date, tMinus5: bars[n - 6].date, tMinus131: bars[n - 132].date };
}

/**
 * items: [{symbol, value:number|null, reason}] → {ranked:[{symbol, mom126_5, rank, percentile, top20}], excluded:[{symbol, reason}]}.
 * rank 1 = highest momentum; ties broken by symbol (deterministic). percentile: 100 = best, 0 = worst.
 */
export function rankByMomentum(items) {
  const ok = items.filter((x) => isNum(x.value)).sort((a, b) => b.value - a.value || (a.symbol < b.symbol ? -1 : 1));
  const n = ok.length, topN = Math.ceil(n * TOP_FRACTION);
  const ranked = ok.map((x, i) => ({ symbol: x.symbol, mom126_5: x.value, rank: i + 1, percentile: n === 1 ? 100 : (100 * (n - 1 - i)) / (n - 1), top20: i + 1 <= topN }));
  const excluded = items.filter((x) => !isNum(x.value)).map((x) => ({ symbol: x.symbol, reason: x.reason || 'no_momentum' }));
  return { ranked, excluded, rankedCount: n };
}

/** count >= universe size → whole universe (ranked first in rank order, then unranked); else top `count` ranked. */
export function selectPicks(ranking, count, universe) {
  if (count >= universe.length) {
    const rankedSyms = ranking.ranked.map((r) => r.symbol);
    const rest = universe.filter((s) => !rankedSyms.includes(s));
    return [...rankedSyms, ...rest];
  }
  return ranking.ranked.slice(0, Math.max(0, count)).map((r) => r.symbol);
}

// ------------------------------------------------------------------------------------------------ analyze response
const nums2 = (a) => (Array.isArray(a) && a.length === 2 && isNum(a[0]) && isNum(a[1]) ? [a[0], a[1]] : null);

/** Extract the horizon rows of POST /api/company/analyze → {ok, reason?, modelVersion, recorded, snapshotId, price, priceTime, currency, forecasts:{h:{...}}}. */
export function extractForecasts(resp, horizons = HORIZONS) {
  const f = resp && typeof resp === 'object' ? resp.forecast : null;
  if (!f || !Array.isArray(f.rows)) return { ok: false, reason: resp && resp.error ? 'api_error' : 'no_forecast_rows', detail: clip(resp && resp.error) };
  const out = {};
  for (const h of horizons) {
    const row = f.rows.find((r) => r && r.sessions === h);
    if (!row) { out[h] = { sessions: h, available: false, direction: NA, missingRow: true, price: num(f.price), priceTime: clip(f.priceTime, 40), reasons: ['row_missing_in_response'] }; continue; }
    const available = row.available === true;
    out[h] = {
      sessions: h,
      period: clip(row.period, 40),
      direction: DIRECTIONS.includes(row.direction) ? row.direction : NA,
      available,
      price: num(row.price) ?? num(f.price),
      priceTime: clip(row.priceTime ?? f.priceTime, 40),
      predictedPrice: num(row.predictedPrice),
      expectedChangePct: num(row.expectedChangePct),
      neutralThresholdPct: num(row.neutralThresholdPct),
      range: nums2(row.range),
      confidence: clip(row.confidence, 20),
      estimatedEndAt: clip(row.window && row.window.estimatedEndAt, 40),
      anchorDate: isDate(row.window && row.window.anchorDate) ? row.window.anchorDate : null,
      reasons: available ? [] : (Array.isArray(row.reasons) ? row.reasons : []).slice(0, 4).map((s) => clip(s, 240)),
    };
  }
  return {
    ok: true,
    modelVersion: clip(f.version, 80),
    recorded: f.recorded === true,
    snapshotId: clip(f.snapshotId, 64),
    price: num(f.price),
    priceTime: clip(f.priceTime, 40),
    currency: clip(f.currency || resp.currency, 8),
    forecasts: out,
  };
}

/** Exchange-local date of a forecast's reference price time ('YYYY-MM-DD' kept as is; ISO instant converted). */
export function refDateOf(priceTime, market) {
  if (isDate(priceTime)) return priceTime;
  const ms = typeof priceTime === 'string' ? Date.parse(priceTime) : NaN;
  return Number.isFinite(ms) ? localDate(ms, MARKET_TZ[market]) : null;
}

// ------------------------------------------------------------------------------------------------ calendars + outcomes
/** Sorted unique union of the dates of several bar series. */
export function unionCalendar(seriesList) {
  const s = new Set();
  for (const bars of seriesList) for (const b of bars || []) s.add(b.date);
  return [...s].sort();
}
/** h-th session strictly after refDate on `calendar` (sorted dates); null if not yet in the calendar. */
export function targetSession(calendar, refDate, h) {
  let i = 0;
  while (i < calendar.length && calendar[i] <= refDate) i++;
  const k = i + h - 1;
  return k < calendar.length ? calendar[k] : null;
}
export function sessionsAfter(calendar, date) { let c = 0; for (const d of calendar) if (d > date) c++; return c; }

export function directionOf(changePct, thresholdPct) { return changePct > thresholdPct ? UP : changePct < -thresholdPct ? DOWN : NEUTRAL; }

/**
 * Outcome of one (run, symbol, horizon) forecast entry.
 * entry: {direction, available, price(ref), predictedPrice, range, expectedChangePct}; actual: {close, date} or null (unavailable).
 * Unavailable (no bar long after target / delisted) is conservative: rose=false, hit=false for 'صاعد' calls, directionCorrect=null.
 */
export function evaluateOutcome({ entry, h, refDate, targetDate, actual, splitBetween = false, evaluatedAt = null }) {
  const thr = NEUTRAL_THRESHOLD_PCT[h];
  const predicted = entry.direction;
  const base = { refDate, refPrice: entry.price, targetDate, predictedDirection: predicted, available: entry.available === true, neutralThresholdPct: thr, splitBetween: !!splitBetween, evaluatedAt };
  if (!actual) {
    return { ...base, status: 'unavailable', actualPrice: null, actualDate: null, changePct: null, actualDirection: null, rose: false, directionCorrect: null, hit: predicted === UP ? false : null, inRange: null, priceErrorPct: null };
  }
  const changePct = (actual.close / entry.price - 1) * 100;
  const actualDirection = directionOf(changePct, thr);
  const rose = actual.close > entry.price;
  const directional = entry.available === true && [UP, DOWN, NEUTRAL].includes(predicted);
  return {
    ...base,
    status: 'evaluated',
    actualPrice: actual.close,
    actualDate: actual.date,
    changePct,
    actualDirection,
    rose,
    directionCorrect: directional ? predicted === actualDirection : null,
    hit: predicted === UP ? rose : null,
    inRange: entry.range ? actual.close >= entry.range[0] && actual.close <= entry.range[1] : null,
    priceErrorPct: isNum(entry.predictedPrice) ? (actual.close / entry.predictedPrice - 1) * 100 : null,
  };
}

export const outcomeKey = (runFile, symbol, h) => `${runFile}|${symbol}|h${h}`;

/** Append-only merge: new keys are added; an existing key is never changed (throws on any attempt to change it). */
export function mergeOutcomes(existing, additions) {
  const out = { ...existing };
  const added = [];
  for (const [k, v] of Object.entries(additions)) {
    if (Object.prototype.hasOwnProperty.call(out, k)) {
      if (JSON.stringify(out[k]) !== JSON.stringify(v)) throw new Error('append-only violation: outcome ' + k + ' already exists with different content');
      continue;
    }
    out[k] = v; added.push(k);
  }
  return { merged: out, added };
}

/** Check that `after` keeps every entry of `before` byte-identical (used right before writing). */
export function assertAppendOnly(before, after) {
  for (const [k, v] of Object.entries(before)) {
    if (!Object.prototype.hasOwnProperty.call(after, k) || JSON.stringify(after[k]) !== JSON.stringify(v)) throw new Error('append-only violation on ' + k);
  }
  return true;
}

/** First free file name for a date: <date>.json, <date>-2.json, <date>-3.json ... */
export function nextFreeName(existingNames, base, ext = '.json') {
  const set = new Set(existingNames);
  if (!set.has(base + ext)) return base + ext;
  for (let i = 2; ; i++) if (!set.has(`${base}-${i}${ext}`)) return `${base}-${i}${ext}`;
}

// ------------------------------------------------------------------------------------------------ statistics
/** Business-day distance (weekends of the market removed; holidays ignored — documented approximation). */
export function businessDaysBetween(a, b, market) {
  if (b <= a) return 0;
  const we = WEEKEND[market];
  let c = 0, d = a;
  while (d < b) { d = addDays(d, 1); if (!we.includes(weekday(d))) c++; }
  return c;
}
/** Greedy non-overlapping subset of dates: consecutive kept dates are >= h business days apart. */
export function nonOverlappingDates(dates, h, market) {
  const u = [...new Set(dates)].sort();
  const kept = [];
  for (const d of u) if (!kept.length || businessDaysBetween(kept[kept.length - 1], d, market) >= h) kept.push(d);
  return kept;
}
export function lag1Autocorr(xs) {
  const n = xs.length;
  if (n < 3) return null;
  const m = xs.reduce((s, x) => s + x, 0) / n;
  let num0 = 0, den = 0;
  for (let i = 0; i < n; i++) { den += (xs[i] - m) ** 2; if (i) num0 += (xs[i] - m) * (xs[i - 1] - m); }
  return den > 0 ? num0 / den : null;
}
/** AMEND-1: n_eff = n_nonoverlap × (1−ρ̂)/(1+ρ̂), ρ̂ clipped at ≥ 0; ρ̂ only estimated with ≥ MIN_POINTS_FOR_RHO points. */
export function nEff(nNonOverlap, series) {
  let rho = null;
  if (series && series.length >= MIN_POINTS_FOR_RHO) { const r = lag1Autocorr(series); rho = r === null ? null : Math.max(0, r); }
  const neff = rho === null ? nNonOverlap : nNonOverlap * (1 - rho) / (1 + rho);
  return { nNonOverlap, rho, nEff: neff, rhoEstimated: rho !== null };
}
const rate = (k, n) => ({ k, n, pct: n ? (100 * k) / n : null });

/**
 * rows: [{runFile, runDate, symbol, h, entry, momentumRank, outcome|null}] for ONE market × horizon.
 * halves: within each run, picks with a momentum rank are split into top half (first floor(k/2) by rank) and bottom half.
 */
export function summarize(rows, market, h) {
  const byDir = Object.fromEntries(DIRECTIONS.map((d) => [d, 0]));
  for (const r of rows) byDir[DIRECTIONS.includes(r.entry.direction) ? r.entry.direction : NA]++;
  const matured = rows.filter((r) => r.outcome);
  const nonNeutral = matured.filter((r) => [UP, DOWN].includes(r.entry.direction) && r.outcome.directionCorrect !== null);
  const upCalls = matured.filter((r) => r.entry.direction === UP);
  const half = new Map();
  const byRun = new Map();
  for (const r of rows) if (isNum(r.momentumRank)) { if (!byRun.has(r.runFile)) byRun.set(r.runFile, []); byRun.get(r.runFile).push(r); }
  for (const list of byRun.values()) {
    const sorted = [...list].sort((a, b) => a.momentumRank - b.momentumRank);
    const k = Math.floor(sorted.length / 2);
    sorted.forEach((r, i) => half.set(r, i < k ? 'top' : 'bottom'));
  }
  const top = matured.filter((r) => half.get(r) === 'top'), bottom = matured.filter((r) => half.get(r) === 'bottom');
  // n_eff on reference dates with matured outcomes; per-date series = rise share of 'صاعد' calls − rise share of all (lift)
  const datesWithOutcomes = [...new Set(matured.map((r) => r.outcome.refDate))];
  const kept = nonOverlappingDates(datesWithOutcomes, h, market);
  const series = [];
  for (const d of kept) {
    const all = matured.filter((r) => r.outcome.refDate === d), ups = all.filter((r) => r.entry.direction === UP);
    if (all.length && ups.length) series.push(ups.filter((r) => r.outcome.rose).length / ups.length - all.filter((r) => r.outcome.rose).length / all.length);
  }
  const ne = nEff(kept.length, series);
  const upHit = rate(upCalls.filter((r) => r.outcome.hit === true).length, upCalls.length);
  const baseRate = rate(matured.filter((r) => r.outcome.rose).length, matured.length);
  return {
    market, h,
    recorded: rows.length,
    byDirection: byDir,
    matured: matured.length,
    unavailableOutcomes: matured.filter((r) => r.outcome.status === 'unavailable').length,
    splitFlagged: matured.filter((r) => r.outcome.splitBetween).length,
    nonNeutralAccuracy: rate(nonNeutral.filter((r) => r.outcome.directionCorrect).length, nonNeutral.length),
    upHit,
    baseRate,
    liftPp: upHit.pct !== null && baseRate.pct !== null ? upHit.pct - baseRate.pct : null,
    topHalfRise: rate(top.filter((r) => r.outcome.rose).length, top.length),
    bottomHalfRise: rate(bottom.filter((r) => r.outcome.rose).length, bottom.length),
    rangeCoverage: rate(matured.filter((r) => r.outcome.inRange === true).length, matured.filter((r) => r.outcome.inRange !== null).length),
    neff: ne,
    refDates: datesWithOutcomes.length,
  };
}

// ------------------------------------------------------------------------------------------------ dataset assembly
/** Flatten run files + outcomes into rows. runs: [{file, data}] (file = '<market>/<name>.json'); outcomes: {key: outcome}. */
export function buildRows(runs, outcomesByMarket) {
  const rows = [];
  for (const { file, data } of runs) {
    if (!data || data.schema !== SCHEMA_RUN || !Array.isArray(data.picks)) continue;
    const market = data.market;
    const outs = (outcomesByMarket[market] && outcomesByMarket[market].outcomes) || {};
    for (const p of data.picks) {
      if (!p.analyze || !p.analyze.ok || !p.forecasts) continue;
      for (const h of HORIZONS) {
        const entry = p.forecasts[h];
        if (!entry) continue;
        rows.push({ runFile: file, runDate: data.runDate, market, symbol: p.symbol, h, entry, momentumRank: p.momentum ? num(p.momentum.rank) : null, momentumPercentile: p.momentum ? num(p.momentum.percentile) : null, outcome: outs[outcomeKey(file, p.symbol, h)] || null });
      }
    }
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ markdown (Arabic, RTL)
export const fmtPct = (r) => (r && r.pct !== null && r.pct !== undefined ? `${r.pct.toFixed(1)}% (${r.k}/${r.n})` : `— (0/${r ? r.n : 0})`);
export const fmtNum = (v, d = 2) => (isNum(v) ? v.toFixed(d) : '—');
export const fmtSigned = (v, d = 1) => (isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(d) : '—');
export const MARKET_NAME = Object.freeze({ sa: 'السوق السعودي', us: 'السوق الأمريكي' });

export function table(headers, rows) {
  const esc = (c) => String(c === null || c === undefined ? '—' : c).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return ['| ' + headers.map(esc).join(' | ') + ' |', '|' + headers.map(() => '---').join('|') + '|', ...rows.map((r) => '| ' + r.map(esc).join(' | ') + ' |')].join('\n');
}

/** Two RTL tables per market (counts, rates). First column (the horizon) renders at the far right inside dir="rtl". */
export function marketTables(summaries) {
  const counts = table(['الأفق', 'توقعات مسجلة', 'ناضجة', 'صاعد', 'محايد', 'هابط', 'غير متاح', 'نتائج «غير متاح السعر»', 'تجزئة محتملة'],
    summaries.map((s) => [HORIZON_NAME[s.h], s.recorded, s.matured, s.byDirection[UP], s.byDirection[NEUTRAL], s.byDirection[DOWN], s.byDirection[NA], s.unavailableOutcomes, s.splitFlagged]));
  const rates = table(['الأفق', 'دقة الاتجاه (غير المحايد)', 'إصابة «صاعد» (صعد فعلاً)', 'نسبة الصعود الأساسية (كل المقيّم)', 'الفرق (نقطة مئوية)', 'صعود نصف الزخم الأعلى', 'صعود النصف الأدنى', 'تغطية النطاق', 'n غير متداخل', 'n_eff', `هدف المالك ${OWNER_TARGET_PCT}% (مرجع فقط)`],
    summaries.map((s) => [HORIZON_NAME[s.h], fmtPct(s.nonNeutralAccuracy), fmtPct(s.upHit), fmtPct(s.baseRate), fmtSigned(s.liftPp), fmtPct(s.topHalfRise), fmtPct(s.bottomHalfRise), fmtPct(s.rangeCoverage), s.neff.nNonOverlap,
      fmtNum(s.neff.nEff, 1) + (s.neff.rhoEstimated ? ` (ρ̂=${fmtNum(s.neff.rho, 2)})` : ' (ρ̂ غير مقدّر)'), s.upHit.pct === null ? '—' : s.upHit.pct >= OWNER_TARGET_PCT ? 'فوق المرجع (وصفي)' : 'دون المرجع (وصفي)']));
  return { counts, rates };
}

export function neffNote(summaries) {
  const max = Math.max(0, ...summaries.map((s) => s.neff.nEff));
  return `**ملاحظة إلزامية:** لا يُستخلص أي استنتاج قبل ≥ ${MIN_NEFF} ملاحظة مستقلة فعلياً (n_eff، كما في \`PROTOCOL-NEGSEL-0002-AMEND-1.md\`: n_eff = n_غير_متداخل × (1−ρ̂)/(1+ρ̂)، ρ̂ مقصوص عند ≥ 0). أكبر n_eff حالياً = ${fmtNum(max, 1)}. الأسهم في التاريخ نفسه ليست ملاحظات مستقلة (حركة السوق مشتركة)، ولذلك وحدة العدّ هي تاريخ الترشيح غير المتداخل لا عدد الأسهم. التباعد بين التواريخ يُقاس بأيام العمل (تُستثنى عطلة نهاية الأسبوع فقط؛ العطل الرسمية غير محتسبة — تقريب).`;
}

export const DEFINITIONS_MD = [
  '- **دقة الاتجاه (غير المحايد):** من التوقعات «صاعد/هابط» الناضجة، نسبة مطابقة الاتجاه الفعلي بحدود الحياد نفسها في النموذج (يومي 0.1%، أسبوعي 0.25%، شهري 0.5%).',
  '- **إصابة «صاعد»:** من توقعات «صاعد» الناضجة، نسبة ما أغلق فوق السعر المرجعي فعلاً.',
  '- **نسبة الصعود الأساسية:** نسبة كل الأسهم المقيّمة (لنفس السوق والأفق، بكل الاتجاهات بما فيها «غير متاح») التي أغلقت فوق سعرها المرجعي = ما يحققه اختيار عشوائي من نفس المجموعة.',
  '- **نصف الزخم الأعلى/الأدنى:** داخل كل تشغيل تُقسم الأسهم المختارة حسب رتبة `mom126_5` إلى نصفين؛ يُعرض نسبة صعود كل نصف.',
  '- **سهم بلا سعر بعد 10 جلسات من الهدف (موقوف/مشطوب):** يُحسب «لم يصعد» (محافظ)، ويُستبعد من دقة الاتجاه.',
  '- **السعر المرجعي** هو `row.price` من رد الموقع وقت التشغيل (قد يكون سعراً لحظياً متأخراً حتى 15 دقيقة)، و**السعر الفعلي** إغلاق Yahoo اليومي في جلسة الهدف (الجلسة رقم h بعد تاريخ السعر المرجعي على تقويم السوق).',
].join('\n');

// ------------------------------------------------------------------------------------------------ injectable I/O helpers
export const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const chartUrl = (host, symbol, range) => `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}&events=split`;
/** Default network: net.get(url) → {status, text}. Replaced by fakes in tests. */
export function defaultNet(timeoutMs = 25000) {
  return {
    async get(url) {
      const r = await fetch(url, { headers: { 'User-Agent': YAHOO_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      return { status: r.status, text: await r.text() };
    },
  };
}
export const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Yahoo daily chart with the repo convention (fetch-research-prices.yml / snapshot collector): up to 4 attempts,
 * query1/query2 alternating, linear backoff; 404 and identity errors are final. Never throws.
 * Returns {ok, parsed?, reason?, status?, attempts}.
 */
export async function fetchChart({ net, symbol, market, range = '1y', sleep = realSleep, attempts = 4, backoffMs = 3000 }) {
  let last = { ok: false, reason: 'not_attempted', status: null, attempts: 0 };
  for (let a = 0; a < attempts; a++) {
    const host = a % 2 ? 'query2' : 'query1';
    let res;
    try { res = await net.get(chartUrl(host, symbol, range)); }
    catch (e) { last = { ok: false, reason: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network_error', status: null, attempts: a + 1 }; if (a < attempts - 1) await sleep(backoffMs * (a + 1)); continue; }
    const status = res && isNum(res.status) ? res.status : null;
    if (status === 200) {
      let json;
      try { json = JSON.parse(res.text); } catch { last = { ok: false, reason: 'non_json', status, attempts: a + 1 }; if (a < attempts - 1) await sleep(backoffMs * (a + 1)); continue; }
      try { return { ok: true, parsed: parseChart(json, symbol, market), status, attempts: a + 1 }; }
      catch (e) { return { ok: false, reason: e instanceof IdentityError ? 'identity_' + e.message : String(e && e.message || e).slice(0, 40), status, attempts: a + 1, final: true }; }
    }
    last = { ok: false, reason: status === 404 ? 'not_found' : status === 429 ? 'rate_limited' : 'http_' + status, status, attempts: a + 1 };
    if (status === 404) return { ...last, final: true };
    if (a < attempts - 1) await sleep(backoffMs * (a + 1));
  }
  return last;
}

/** Yahoo range token covering `days` calendar days back. */
export function rangeForDays(days) { return days < 330 ? '1y' : days < 700 ? '2y' : days < 1800 ? '5y' : 'max'; }

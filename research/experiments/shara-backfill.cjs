#!/usr/bin/env node
'use strict';
/**
 * SHARA-BACKFILL-0001 (EXPLORATORY) — point-in-time replay of the REAL forecasts() + REAL SHARA gates on historical prices.
 * Pre-registration: research/SHARA-BACKFILL-0001.md §0. No thresholds are changed or tuned here; nothing in mizan-v45/ is edited.
 *
 * Per symbol × issue date × horizon h ∈ {1,5,21}:
 *   prices ≤ issue date (5-calendar-year window, as fetchCompany's 5y chart) → forecasts() price-only (no market/sector/facts/news,
 *   same honesty rule as run-forecast-replay.cjs) → screener candidate (same mapping as lib/screener.ts analyzeSymbol)
 *   → evaluateScreenerShara() (official: parity, then market gates on parity survivors)
 *   + diagnostics D1 (parity without low_or_unknown_confidence) and D2 (market gates on every available forecast; EXECUTION + AUDIT)
 *   → realised return after h sessions (only where the outcome row exists inside the readable data).
 *
 * HOLDOUT (PROTOCOL-NEGSEL-0002 + AMEND-1): every date after the sealed cutoff for the 80-symbol research universe is never read.
 * Enforced structurally in loadSeries(): rows of sealed-universe symbols are physically cut on load (cutRows) BEFORE any use,
 * whatever --set is given, and the cutoff is min(SEALED_CUTOFF_MAX, determineDevCutoff(calendars of the sealed dir)).
 *
 * usage:
 *   node shara-backfill.cjs --lib <built-lib-dir> --set A --prices <research-data-bf/prices> --out <out.json> [--md <out.md>]
 *   node shara-backfill.cjs --lib <built-lib-dir> --set B --prices <research-data/prices>   --out <out.json> [--md <out.md>]
 *   (<built-lib-dir> from: NODE_PATH=/opt/npm-tools/node_modules node build-replay-lib.cjs <built-lib-dir>)
 *   options: --symbols a,b,c (default: Set A list / 2222.SR,AAPL,AMZN) · --window 60 · --sealed-dir <dir with the 80 files> (Set B default = --prices)
 */
const fs = require('fs'), path = require('path');
const L = require('./negsel-lib.cjs');

const SEALED_CUTOFF_MAX = '2024-09-04'; // AMEND-1 / REGISTRY: last readable date of the NEGSEL development block
const HORIZONS = [{name: 'يوم', sessions: 1}, {name: 'أسبوع', sessions: 5}, {name: 'شهر', sessions: 21}];
const WINDOW = 60;
const SET_A = {
  sa: ['1080.SR', '1111.SR', '1810.SR', '2223.SR', '2330.SR', '4142.SR', '4164.SR', '4250.SR', '7203.SR', '8210.SR'],
  us: ['ADBE', 'AMD', 'AVGO', 'BAC', 'LLY', 'NFLX', 'QCOM', 'TSLA', 'UNH', 'WFC'],
};
const SET_A_SYMBOLS = [...SET_A.sa, ...SET_A.us];
const SET_B_SYMBOLS = ['2222.SR', 'AAPL', 'AMZN'];
const MAX_H = Math.max(...HORIZONS.map((h) => h.sessions));

// ---------------------------------------------------------------- sealed universe (parsed from the frozen TS file; no build needed)
function sealedUniverse(appDir = path.join(__dirname, '../../mizan-v45')) {
  const src = fs.readFileSync(path.join(appDir, 'lib/daily-picks-universe.ts'), 'utf8');
  const grab = (name) => {
    const m = src.match(new RegExp(`export const ${name}=Object\\.freeze\\(\\[([^\\]]*)\\]`));
    if (!m) throw new Error(`cannot parse ${name} from daily-picks-universe.ts`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };
  const sa = grab('SA_UNIVERSE').map((s) => s + '.SR'), us = grab('US_UNIVERSE');
  if (sa.length !== 40 || us.length !== 40) throw new Error(`sealed universe must have 40+40 symbols, got ${sa.length}+${us.length}`);
  return new Set([...sa, ...us]);
}

// ---------------------------------------------------------------- holdout guard
/** Cutoff from calendars (dates only — the same reading as negsel-0002 applyDevCut), never later than SEALED_CUTOFF_MAX. */
function sealedCutoff(sealedDir, universe) {
  if (!sealedDir) return SEALED_CUTOFF_MAX;
  const files = fs.readdirSync(sealedDir).filter((f) => f.endsWith('.json'));
  const bySet = {sa: new Set(), us: new Set(), union: new Set()};
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(sealedDir, f), 'utf8'));
    if (!universe.has(d.symbol)) continue;
    const m = d.symbol.endsWith('.SR') ? 'sa' : 'us';
    for (const r of d.rows || []) if (Array.isArray(r) && typeof r[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r[0])) { bySet[m].add(r[0]); bySet.union.add(r[0]); }
  }
  const calendars = Object.entries(bySet).map(([name, s]) => ({name, dates: [...s].sort()}));
  const {cutoff} = L.determineDevCutoff(calendars);
  if (!cutoff) return SEALED_CUTOFF_MAX;
  return cutoff < SEALED_CUTOFF_MAX ? cutoff : SEALED_CUTOFF_MAX;
}
/** The ONLY loader. Sealed-universe symbols are cut before the rows leave this function. */
function guardRows(symbol, rawRows, universe, cutoff) {
  if (!universe.has(symbol)) return {rows: rawRows, sealed: false, cutoff: null};
  const rows = L.cutRows(rawRows, cutoff);
  for (const r of rows) if (!(r[0] <= cutoff)) throw new Error(`holdout row leaked: ${symbol} ${r[0]} > ${cutoff}`);
  return {rows, sealed: true, cutoff};
}
function loadSeries(dir, symbol, universe, cutoff) {
  const file = path.join(dir, `${symbol}.json`);
  if (!fs.existsSync(file)) return {symbol, error: 'file_missing'};
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (d.symbol !== symbol) return {symbol, error: `identity_mismatch:${d.symbol}`};
  const g = guardRows(symbol, d.rows, universe, cutoff);
  d.rows = null; // drop the reference to the uncut rows
  return {symbol, currency: d.currency, exchange: d.exchange ?? null, sealed: g.sealed, cutoff: g.cutoff, prices: toPrices(g.rows)};
}

// ---------------------------------------------------------------- price handling
/** research-data row [date,o,h,l,c,v] -> Price; keeps only finite positive OHLC rows, sorted, unique dates. */
function toPrices(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!Array.isArray(r) || typeof r[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r[0])) continue;
    const [date, open, high, low, close, volume] = r;
    if (![open, high, low, close].every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) continue;
    out.push({date, open, high, low, close, volume: typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 ? volume : 0});
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out.filter((p, i) => i === 0 || p.date !== out[i - 1].date);
}
const minusYears = (iso, y) => { const d = new Date(iso + 'T00:00:00Z'); const m = d.getUTCMonth(); d.setUTCFullYear(d.getUTCFullYear() - y); if (d.getUTCMonth() !== m) d.setUTCDate(0); return d.toISOString().slice(0, 10); };
/** Point-in-time history at index o: rows 0..o only, restricted to the 5y window that fetchCompany would request. */
function historyAt(prices, o) {
  const asOf = prices[o].date, start = minusYears(asOf, 5);
  return prices.slice(0, o + 1).filter((p) => p.date >= start);
}
/** Issue indices. Set A: last `win` indices with an h=hBase outcome. Set B: last `win` indices whose h=MAX_H outcome is readable. */
function issueWindow(n, win, hLast) {
  const last = n - 1 - hLast, first = last - win + 1;
  if (first < 0) return [];
  return Array.from({length: win}, (_, i) => first + i);
}
function outcomePct(prices, o, h) {
  if (o + h >= prices.length) return null;
  const a = prices[o].close, b = prices[o + h].close;
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 ? 100 * (b / a - 1) : null;
}
function directionHit(direction, ret) {
  if (ret === null || !Number.isFinite(ret)) return null;
  if (direction === 'صاعد') return ret > 0 ? 1 : 0;
  if (direction === 'هابط') return ret < 0 ? 1 : 0;
  return null;
}
function wilson(k, n, z = 1.959964) {
  if (!n) return {k, n, p: null, lo: null, hi: null};
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, w = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return {k, n, p, lo: Math.max(0, c - w), hi: Math.min(1, c + w)};
}

// ---------------------------------------------------------------- report / candidate (mirrors lib/screener.ts)
function buildReport(symbol, market, currency, hist) {
  const asOf = hist[hist.length - 1].date;
  return {company: {symbol, name: symbol, exchange: market === 'sa' ? 'SAU' : 'NMS', instrument: 'EQUITY'}, asOf,
    retrievedAt: new Date(asOf + 'T20:00:00Z').toISOString(), prices: hist, priceSource: 'shara-backfill-replay', quoteTime: null,
    currency: currency || (market === 'sa' ? 'SAR' : 'USD'), facts: [], official: null, news: [], peers: [], checks: [], warnings: [],
    mode: 'historical', context: {market: null, sector: null}};
}
const numberOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strings = (v, n = 6) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, n) : []);
/** Same field mapping as analyzeSymbol() in lib/screener.ts (that function is not exported, so it is mirrored here). */
function buildCandidate(symbol, market, report, result, sessions) {
  const r = result.rows.find((x) => x.sessions === sessions);
  if (!r) throw new Error('horizon row missing');
  return {symbol, name: report.company.name || symbol, exchange: report.company.exchange || '', market, currency: report.currency,
    price: numberOrNull(r.price), predictedPrice: numberOrNull(r.predictedPrice), direction: String(r.direction || 'غير متاح'),
    expectedChangePct: numberOrNull(r.expectedChangePct), range: Array.isArray(r.range) && r.range.length === 2 ? r.range : null,
    confidence: String(r.confidence || 'غير متاحة'), dataQuality: String(r.dataQuality || result.dataQuality || 'غير متاحة'),
    coverage: numberOrNull(r.coverage) ?? 0, sample: numberOrNull(r.sample) ?? 0, independent: numberOrNull(r.independent) ?? 0,
    riskLevel: String(r.riskLevel || 'غير متاح'), available: r.available === true,
    reasons: strings(r.reasons), basis: strings(r.basis), risks: strings(r.risks), invalidation: strings(r.invalidation),
    priceTime: result.priceTime || '', retrievedAt: report.retrievedAt, source: report.priceSource};
}

// ---------------------------------------------------------------- SHARA (real functions from the built lib)
function loadLib(libDir) {
  const p = (m) => require(path.resolve(libDir, 'lib', m));
  const model = p('research-model'), settings = p('site-settings'), shara = p('screener-shara'), engine = p('shara/engine'), policy = p('screener-policy');
  let counter = 0;
  const opts = (id) => ({pipelineId: id, pipelineVersion: shara.SHARA_SCREENER_VERSION, now: () => new Date(0), makeId: () => `bf-${++counter}`});
  const noConf = shara.parityGates().filter((g) => g.gateId !== 'low_or_unknown_confidence');
  if (noConf.length !== 7) throw new Error('expected 8 parity gates');
  return {
    forecasts: model.forecasts, DEFAULT_SETTINGS: settings.DEFAULT_SETTINGS, candidateExclusion: policy.candidateExclusion, shara,
    thresholds: shara.SHARA_MARKET_THRESHOLDS, enforce: shara.SHARA_ENFORCE_MARKET_GATES,
    d1: new engine.SharaEngine(noConf, opts('bf-parity-no-confidence')),
    d2: {sa: new engine.SharaEngine(shara.marketGates('sa'), opts('bf-market-sa')), us: new engine.SharaEngine(shara.marketGates('us'), opts('bf-market-us'))},
    d2audit: {sa: new engine.SharaEngine(shara.marketGates('sa'), {...opts('bf-market-sa-audit'), mode: 'AUDIT'}),
      us: new engine.SharaEngine(shara.marketGates('us'), {...opts('bf-market-us-audit'), mode: 'AUDIT'})},
  };
}
const firstFail = (ev) => ev.gateResults.find((g) => g.status !== 'PASS');
/** Official verdict (as enforced): parity status if not PASS, else market status. */
function combineVerdict(parity, market) { return parity !== 'PASS' ? parity : market === 'NOT_RUN' ? 'PASS' : market; }

async function evaluateCandidate(lib, candidate, report) {
  const item = {candidate, report: {prices: report.prices, retrievedAt: report.retrievedAt}};
  const {summary} = await lib.shara.evaluateScreenerShara([item], false); // shadow mode, as in production
  const v = summary.verdicts[0];
  const env = lib.shara.candidateEnvelope(item);
  const d1 = await lib.d1.evaluate(env);
  const mk = candidate.market === 'sa' ? 'sa' : 'us';
  const d2 = await lib.d2[mk].evaluate(env), d2a = await lib.d2audit[mk].evaluate(env);
  const ev = env.evidence, num = (k) => (ev[k] ? ev[k].value : null);
  const legacy = lib.candidateExclusion(candidate);
  return {
    parity: v.parity, parityRule: v.parityRule ?? null, marketGate: v.market, marketRules: v.marketRules,
    verdict: combineVerdict(v.parity, v.market), legacyExclusion: legacy, parityAgrees: (legacy === null) === (v.parity === 'PASS'),
    d1: d1.finalStatus, d1Rule: firstFail(d1)?.gateId ?? null, d1Finding: firstFail(d1)?.findings?.[0]?.ruleId ?? null,
    d2: d2.finalStatus, d2Rule: firstFail(d2)?.gateId ?? null, d2Finding: firstFail(d2)?.findings?.[0]?.ruleId ?? null,
    d2All: d2a.gateResults.filter((g) => g.status !== 'PASS').map((g) => `${g.gateId}:${g.status}`),
    evidence: {medianTradedValue20: num('medianTradedValue20'), zeroVolumeDays20: num('zeroVolumeDays20'), atrPct20: num('atrPct20'), lastBarAgeDays: num('lastBarAgeDays')},
  };
}

async function replaySymbol(lib, s, set, win) {
  const market = s.symbol.endsWith('.SR') ? 'sa' : 'us', P = s.prices, out = [], errors = [];
  const hLast = set === 'B' ? MAX_H : 5;
  const idx = issueWindow(P.length, win, hLast);
  if (!idx.length) return {records: out, errors: [{symbol: s.symbol, error: `insufficient_rows:${P.length}`}], window: null};
  for (const o of idx) {
    const hist = historyAt(P, o), report = buildReport(s.symbol, market, s.currency, hist);
    if (s.sealed && hist[hist.length - 1].date > s.cutoff) throw new Error('holdout guard: issue date after cutoff');
    for (const h of HORIZONS) {
      const rec = {set, symbol: s.symbol, market, asOf: P[o].date, h: h.sessions, histLen: hist.length};
      try {
        const result = lib.forecasts(report, null, Date.parse(report.asOf + 'T20:00:00Z'), lib.DEFAULT_SETTINGS, [h]);
        const c = buildCandidate(s.symbol, market, report, result, h.sessions);
        Object.assign(rec, {available: c.available, direction: c.direction, confidence: c.confidence, expectedChangePct: c.expectedChangePct,
          dataQuality: c.dataQuality, reason: c.available ? null : (c.reasons[0] || 'unknown').slice(0, 90)}, await evaluateCandidate(lib, c, report));
      } catch (e) {
        rec.error = String(e && e.message || e).slice(0, 200); errors.push({symbol: s.symbol, asOf: rec.asOf, h: h.sessions, error: rec.error});
      }
      const ret = outcomePct(P, o, h.sessions);
      rec.outcomeDate = o + h.sessions < P.length ? P[o + h.sessions].date : null;
      if (s.sealed && rec.outcomeDate && rec.outcomeDate > s.cutoff) throw new Error('holdout guard: outcome after cutoff');
      rec.ret = ret === null ? null : +ret.toFixed(4);
      rec.hit = rec.direction ? directionHit(rec.direction, rec.ret) : null;
      out.push(rec);
    }
  }
  return {records: out, errors, window: {first: P[idx[0]].date, last: P[idx[idx.length - 1]].date, n: idx.length, rows: P.length, firstRow: P[0].date, lastRow: P[P.length - 1].date}};
}

// ---------------------------------------------------------------- aggregation
function rate(recs, pred) { const r = recs.filter((x) => x.ret !== null && pred(x)); return {...wilson(r.filter((x) => x.ret > 0).length, r.length), meanRet: r.length ? L.mean(r.map((x) => x.ret)) : null}; }
function countBy(recs, key) { const o = {}; for (const r of recs) { const k = typeof key === 'function' ? key(r) : r[key]; if (k === undefined || k === null) continue; o[k] = (o[k] || 0) + 1; } return o; }
function aggregate(records) {
  const groups = {};
  const keyOf = (r) => [`${r.market}|h${r.h}`, `all|h${r.h}`];
  for (const r of records) for (const k of keyOf(r)) (groups[k] ??= []).push(r);
  const out = {};
  for (const [k, recs] of Object.entries(groups).sort()) {
    const ok = recs.filter((r) => !r.error), avail = ok.filter((r) => r.available);
    const rising = ok.filter((r) => r.direction === 'صاعد'), nonNeutral = avail.filter((r) => r.direction === 'صاعد' || r.direction === 'هابط');
    const nn = nonNeutral.filter((r) => r.hit !== null);
    out[k] = {
      n: recs.length, errors: recs.length - ok.length, available: avail.length,
      direction: countBy(ok, 'direction'), confidence: countBy(ok, 'confidence'),
      verdict: countBy(ok, 'verdict'), parity: countBy(ok, 'parity'), parityRule: countBy(ok, 'parityRule'), marketGate: countBy(ok, 'marketGate'),
      unavailableReason: countBy(ok.filter((r) => !r.available), 'reason'),
      parityAgreesWithCandidateExclusion: ok.every((r) => r.parityAgrees),
      d1: countBy(ok, 'd1'), d1Rule: countBy(ok, 'd1Rule'),
      d2: countBy(avail, 'd2'), d2Rule: countBy(avail, 'd2Rule'), d2Finding: countBy(avail, 'd2Finding'),
      d2AllGates: countBy(avail.flatMap((r) => r.d2All.map((g) => ({g}))), 'g'),
      directionAccuracyNonNeutral: {...wilson(nn.filter((r) => r.hit === 1).length, nn.length), coverage: avail.length ? nonNeutral.length / avail.length : null},
      rising: {
        all: rate(rising, () => true),
        officialPass: rate(rising, (r) => r.verdict === 'PASS'),
        d1Pass: rate(rising, (r) => r.d1 === 'PASS'),
        d1PassAndMarketPass: rate(rising, (r) => r.d1 === 'PASS' && r.d2 === 'PASS'),
        d1PassMarketRemoved: rate(rising, (r) => r.d1 === 'PASS' && r.d2 !== 'PASS'),
      },
      baseRateUp: rate(ok, () => true),
    };
  }
  return out;
}

// ---------------------------------------------------------------- markdown
const pct = (x) => (x === null || x === undefined ? '—' : (100 * x).toFixed(1) + '%');
const ci = (w) => (w.n ? `${w.k}/${w.n} = ${pct(w.p)} [${pct(w.lo)}–${pct(w.hi)}]` : '0/0');
const kv = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join('، ') || '—';
function toMarkdown(res) {
  const L2 = [];
  L2.push(`- المجموعة: **${res.set}** · الأسهم: ${res.symbols.join(', ')} · نافذة: ${res.window} تاريخ إصدار · قطع الـHoldout المطبق: \`${res.sealedCutoff}\``);
  L2.push(`- السجلات: ${res.records} · أخطاء: ${res.errors.length} · بناء الكود: \`${res.libDir}\``);
  L2.push('', '| السهم | السوق | أول صف | آخر صف مقروء | نافذة الإصدار | n | مختوم؟ |', '|---|---|---|---|---|---|---|');
  for (const [s, w] of Object.entries(res.windows)) L2.push(`| ${s} | ${s.endsWith('.SR') ? 'sa' : 'us'} | ${w ? w.firstRow : '—'} | ${w ? w.lastRow : '—'} | ${w ? `${w.first} → ${w.last}` : 'غير كافٍ'} | ${w ? w.n : 0} | ${res.sealedSymbols.includes(s) ? 'نعم (cutRows)' : 'لا'} |`);
  for (const [k, a] of Object.entries(res.aggregate)) {
    L2.push('', `#### ${k}`, '');
    L2.push('| المقياس | القيمة |', '|---|---|');
    L2.push(`| n / متاح / أخطاء | ${a.n} / ${a.available} / ${a.errors} |`);
    L2.push(`| الاتجاه | ${kv(a.direction)} |`, `| الثقة | ${kv(a.confidence)} |`);
    L2.push(`| سبب عدم الإتاحة | ${kv(a.unavailableReason)} |`);
    L2.push(`| الحكم الرسمي (تكافؤ ثم سوق) | ${kv(a.verdict)} |`, `| قاعدة التكافؤ المطلقة | ${kv(a.parityRule)} |`);
    L2.push(`| التكافؤ يطابق candidateExclusion | ${a.parityAgreesWithCandidateExclusion ? 'نعم في كل الحالات' : '**لا**'} |`);
    L2.push(`| D1 (تكافؤ بلا بوابة الثقة) | ${kv(a.d1)} — القواعد: ${kv(a.d1Rule)} |`);
    L2.push(`| D2 بوابات السوق على كل توقع متاح (أول بوابة) | ${kv(a.d2)} — ${kv(a.d2Rule)} |`, `| D2 AUDIT (كل البوابات المطلقة) | ${kv(a.d2AllGates)} |`);
    L2.push(`| دقة الاتجاه على غير المحايد | ${ci(a.directionAccuracyNonNeutral)} · التغطية ${pct(a.directionAccuracyNonNeutral.coverage)} |`);
    L2.push(`| نسبة الصعود الأساسية (كل التوقعات) | ${ci(a.baseRateUp)} |`);
    const R = a.rising;
    L2.push(`| «صاعد» بلا فلترة | ${ci(R.all)} · متوسط ${R.all.meanRet === null ? '—' : R.all.meanRet.toFixed(3) + '%'} |`);
    L2.push(`| «صاعد» + PASS رسمي | ${ci(R.officialPass)} |`);
    L2.push(`| «صاعد» + D1 PASS | ${ci(R.d1Pass)} |`);
    L2.push(`| «صاعد» + D1 PASS + سوق PASS | ${ci(R.d1PassAndMarketPass)} |`);
    L2.push(`| «صاعد» + D1 PASS لكن السوق KILL/SUSPEND | ${ci(R.d1PassMarketRemoved)} |`);
  }
  if (res.errors.length) L2.push('', 'الأخطاء: ' + kv(countBy(res.errors, 'error')));
  return L2.join('\n');
}

// ---------------------------------------------------------------- CLI
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1]; i++; }
  return a;
}
async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.lib || !a.set || !a.prices || !a.out || !['A', 'B'].includes(a.set)) {
    console.error('usage: shara-backfill.cjs --lib <built-lib> --set A|B --prices <dir> --out <out.json> [--md <out.md>] [--symbols a,b] [--window 60] [--sealed-dir <dir>]');
    process.exit(2);
  }
  const universe = sealedUniverse();
  const symbols = a.symbols ? a.symbols.split(',') : a.set === 'A' ? SET_A_SYMBOLS : SET_B_SYMBOLS;
  if (a.set === 'A' && symbols.some((s) => universe.has(s))) throw new Error('Set A must not contain sealed-universe symbols');
  const sealedDir = a['sealed-dir'] || (a.set === 'B' ? a.prices : null);
  const cutoff = sealedCutoff(sealedDir, universe);
  const lib = loadLib(a.lib), win = Number(a.window || WINDOW);
  if (lib.enforce !== false) throw new Error('SHARA_ENFORCE_MARKET_GATES is not false — this exploratory run expects the shipped shadow default');
  const records = [], errors = [], windows = {}, sealedSymbols = [];
  for (const sym of symbols) {
    const s = loadSeries(a.prices, sym, universe, cutoff);
    if (s.error) { errors.push({symbol: sym, error: s.error}); windows[sym] = null; continue; }
    if (s.sealed) sealedSymbols.push(sym);
    const r = await replaySymbol(lib, s, a.set, win);
    records.push(...r.records); errors.push(...r.errors); windows[sym] = r.window;
    process.stderr.write(`${sym}: ${r.records.length} records, ${r.errors.length} errors\n`);
  }
  for (const r of records) if (universe.has(r.symbol) && (r.asOf > cutoff || (r.outcomeDate && r.outcomeDate > cutoff))) throw new Error(`holdout leak in output: ${r.symbol} ${r.asOf}`);
  const res = {experiment: 'SHARA-BACKFILL-0001', label: 'EXPLORATORY', set: a.set, symbols, window: win, sealedCutoff: cutoff, sealedSymbols,
    libDir: path.basename(path.resolve(a.lib)), thresholds: lib.thresholds, enforce: lib.enforce, records: records.length, errors, windows,
    aggregate: aggregate(records)};
  fs.writeFileSync(a.out, JSON.stringify({...res, rows: records}, null, 0));
  if (a.md) fs.writeFileSync(a.md, toMarkdown(res) + '\n');
  console.log(`records ${records.length}, errors ${errors.length}, cutoff ${cutoff}`);
}

module.exports = {SEALED_CUTOFF_MAX, HORIZONS, WINDOW, SET_A, SET_A_SYMBOLS, SET_B_SYMBOLS, MAX_H,
  sealedUniverse, sealedCutoff, guardRows, loadSeries, toPrices, minusYears, historyAt, issueWindow, outcomePct, directionHit, wilson,
  buildReport, buildCandidate, loadLib, combineVerdict, evaluateCandidate, replaySymbol, aggregate, toMarkdown, countBy};

if (require.main === module) main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });

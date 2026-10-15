'use strict';
/**
 * identity.cjs - reference functions for the Mizan instrument-identity / point-in-time (PIT) snapshot design.
 *
 * STATE: DESIGN + CODE-TESTED reference only (see research/DESIGN-INSTRUMENT-SNAPSHOT.md).
 * Not wired into mizan-v45, not production, not validated on live data.
 * Nothing here removes historical survivorship bias; it only defines how a record that
 * starts accumulating from day 0 keeps security identity separate from the ticker.
 *
 * Properties:
 *  - pure and deterministic: no Date.now(), no Math.random(), no I/O, no mutation of inputs;
 *  - dependency-free except node:crypto;
 *  - invalid input (missing, NaN, +-Infinity, wrong type, bad date) is rejected with explicit
 *    reason strings, never coerced and never treated as "no conflict" silently.
 *
 * Record shapes (plain JSON-able objects)
 *
 * IncomingRecord (what one snapshot observed for one listing):
 *   { market:'sa'|'us', snapshotDate:'YYYY-MM-DD', symbol, exchange, currency, name,
 *     identifiers?:{ isin?, cusip?, figi?, sec_cik? },
 *     firstRowDate?:'YYYY-MM-DD',                 // earliest session the provider returned / claims
 *     bars?:[{date, close, volume?, open?, high?, low?}] }   // recent window, ascending by date
 *
 * PreviousRecord (last accepted state of the instrument that holds the listing):
 *   { instrumentId, symbol, exchange, currency, name, identifiers?, firstSeen, lastSeen,
 *     firstRowDate?, lastSessionDate?, lastClose?, volumeRef?, status }
 *
 * SnapshotIndex (state the collector loads before resolving):
 *   { nextInstrumentId:int>=1,
 *     instruments:[PreviousRecord...],
 *     listings:[{ instrumentId, symbol, exchange, validFrom, validTo:null|'YYYY-MM-DD' }...] }
 */

const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Configuration. EVERY threshold lives here. ALL values are PROVISIONAL:
// chosen to be conservative and explicit, NOT tuned or validated on data.
// Their false-positive / false-negative rates are UNKNOWN until measured on shadow data.
// ---------------------------------------------------------------------------
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

const CONFIG = deepFreeze({
  status: 'PROVISIONAL',
  // Name rule: character-bigram Dice similarity of normalized names. Below this = name_change.
  nameSimilarityMin: 0.6,
  // Names are compared after removing these descriptors (whole phrases first, then whole tokens).
  stripPhrases: ['common stock', 'ordinary shares', 'common shares', 'class a common stock', 'class b common stock'],
  stripTokens: ['inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'llc', 'lp',
    'sa', 'nv', 'ag', 'the', 'شركه', 'مساهمه', 'المساهمه', 'العامه'],
  // Exchange vocabulary harmonization. Unmapped values are kept verbatim (uppercased) + warning.
  // The mapping itself is an UNVERIFIED assumption about provider codes (see design doc, open items).
  exchangeAliases: {
    NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ', NASDAQ: 'NASDAQ',
    NYQ: 'NYSE', NYS: 'NYSE', NYSE: 'NYSE',
    ASE: 'NYSE AMERICAN', 'NYSE AMERICAN': 'NYSE AMERICAN',
    PCX: 'NYSE ARCA', 'NYSE ARCA': 'NYSE ARCA',
    BTS: 'CBOE BZX', 'CBOE BZX': 'CBOE BZX',
    SAU: 'TADAWUL', SAUDI: 'TADAWUL', TADAWUL: 'TADAWUL',
  },
  // First-row rules: tolerated calendar-day drift of the provider's earliest row date.
  firstRowToleranceDays: 3,
  // History-gap rule: 20 sessions ~= 28 calendar days (20 * 7 / 5), the figure used in PROTOCOL-NEGSEL-0002.
  maxGapCalendarDays: 28,
  // 'review' = flag + quarantine record but keep the same instrument_id; 'hard' = treat as identity conflict.
  gapSeverity: 'review',
  // Regime-break rule: |price ratio| >= priceJumpMinRatio (up or down)
  // AND dollar-volume ratio (price ratio * volume ratio) >= dollarVolumeRegimeMinRatio (up or down).
  // A pure split changes price and volume in opposite directions, so dollar volume stays near 1.
  priceJumpMinRatio: 2,
  dollarVolumeRegimeMinRatio: 5,
  // Maximum number of incoming bars (newer than previous.lastSessionDate) used for the volume median.
  volumeMedianMaxBars: 5,
  // Staleness warning (not a conflict): last incoming bar older than this many calendar days before snapshotDate.
  staleSeriesCalendarDays: 28,
  // Candidate-delisting default N (consecutive COMPLETE universe snapshots without the instrument).
  delistingConsecutiveAbsences: 5,
});

const STRONG_IDENTIFIER_TYPES = Object.freeze(['isin', 'cusip', 'figi', 'sec_cik']);
const GENESIS_HASH = '0'.repeat(64);
const CHAIN_DOMAIN = 'mizan-snapshot-chain/1';

class IdentityInputError extends Error {
  constructor(reasons) {
    super('invalid input: ' + reasons.join('; '));
    this.name = 'IdentityInputError';
    this.reasons = reasons.slice();
  }
}

// ---------------------------------------------------------------------------
// Small validators / date helpers (no clock access)
// ---------------------------------------------------------------------------
function isDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}
function dayNumber(v) { return Math.round(Date.parse(v + 'T00:00:00Z') / 86400000); }
function daysBetween(a, b) { return dayNumber(b) - dayNumber(a); } // b - a
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

function median(values) {
  const a = values.slice().sort((x, y) => x - y);
  const n = a.length;
  if (!n) return null;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

// ---------------------------------------------------------------------------
// Name normalization and similarity
// ---------------------------------------------------------------------------
/** Normalize an entity name for comparison only (never stored as the display name). */
function normalizeName(name, config = CONFIG) {
  if (typeof name !== 'string') return '';
  let s = name.normalize('NFKC').toLowerCase()
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))      // Arabic-Indic digits
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')   // same folding as lib/market-data.ts normalizeQuery
    .replace(/[ً-ٰٟـ]/g, '')                     // diacritics + tatweel
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  const base = s;
  for (const phrase of config.stripPhrases) {
    s = (' ' + s + ' ').split(' ' + phrase + ' ').join(' ').trim();
  }
  const drop = new Set(config.stripTokens);
  s = s.split(' ').filter((t) => t && !drop.has(t)).join(' ');
  return s || base; // never reduce a name to nothing
}

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}

/** Dice coefficient on character bigrams of normalized names, in [0,1]. 0 if either name is empty. */
function nameSimilarity(a, b, config = CONFIG) {
  const x = normalizeName(a, config), y = normalizeName(b, config);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const gx = bigrams(x), gy = bigrams(y);
  let inter = 0, nx = 0, ny = 0;
  for (const [g, c] of gx) { nx += c; if (gy.has(g)) inter += Math.min(c, gy.get(g)); }
  for (const c of gy.values()) ny += c;
  return (2 * inter) / (nx + ny);
}

function normalizeExchange(value, config = CONFIG) {
  const key = String(value).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(config.exchangeAliases, key)
    ? { exchange: config.exchangeAliases[key], mapped: true }
    : { exchange: key, mapped: false };
}

// ---------------------------------------------------------------------------
// Input validation (explicit reasons)
// ---------------------------------------------------------------------------
function validateIdentifiers(ids, label, reasons) {
  if (ids === undefined) return;
  if (ids === null || typeof ids !== 'object' || Array.isArray(ids)) { reasons.push(`${label}.identifiers: not an object`); return; }
  for (const [k, v] of Object.entries(ids)) {
    if (!STRONG_IDENTIFIER_TYPES.includes(k)) reasons.push(`${label}.identifiers.${k}: unknown identifier type`);
    else if (v !== undefined && v !== null && !isNonEmptyString(v)) reasons.push(`${label}.identifiers.${k}: not a non-empty string`);
  }
}

function validateBars(bars, label, reasons) {
  if (bars === undefined) return;
  if (!Array.isArray(bars)) { reasons.push(`${label}.bars: not an array`); return; }
  let prev = null;
  bars.forEach((b, i) => {
    const p = `${label}.bars[${i}]`;
    if (b === null || typeof b !== 'object') { reasons.push(`${p}: not an object`); return; }
    if (!isDay(b.date)) reasons.push(`${p}.date: missing or not YYYY-MM-DD`);
    if (!isFiniteNumber(b.close)) reasons.push(`${p}.close: missing or not finite`);
    else if (b.close <= 0) reasons.push(`${p}.close: not positive`);
    for (const f of ['open', 'high', 'low']) {
      if (b[f] !== undefined && b[f] !== null && !isFiniteNumber(b[f])) reasons.push(`${p}.${f}: not finite`);
    }
    if (b.volume !== undefined && b.volume !== null) {
      if (!isFiniteNumber(b.volume)) reasons.push(`${p}.volume: not finite`);
      else if (b.volume < 0) reasons.push(`${p}.volume: negative`);
    }
    if (isDay(b.date)) {
      if (prev !== null && b.date <= prev) reasons.push(`${p}.date: not strictly ascending`);
      prev = b.date;
    }
  });
}

/** Returns an array of rejection reasons (empty = valid). */
function validateIncoming(rec) {
  const r = [];
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return ['incoming: not an object'];
  if (rec.market !== 'sa' && rec.market !== 'us') r.push('incoming.market: must be "sa" or "us"');
  if (!isDay(rec.snapshotDate)) r.push('incoming.snapshotDate: missing or not YYYY-MM-DD');
  for (const f of ['symbol', 'exchange', 'currency', 'name']) {
    if (!isNonEmptyString(rec[f])) r.push(`incoming.${f}: missing or empty`);
  }
  if (rec.firstRowDate !== undefined && rec.firstRowDate !== null && !isDay(rec.firstRowDate)) r.push('incoming.firstRowDate: not YYYY-MM-DD');
  validateIdentifiers(rec.identifiers, 'incoming', r);
  validateBars(rec.bars, 'incoming', r);
  return r;
}

function validatePrevious(rec) {
  const r = [];
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return ['previous: not an object'];
  for (const f of ['symbol', 'exchange', 'currency', 'name']) {
    if (!isNonEmptyString(rec[f])) r.push(`previous.${f}: missing or empty`);
  }
  if (!Number.isInteger(rec.instrumentId) || rec.instrumentId < 1) r.push('previous.instrumentId: not a positive integer');
  for (const f of ['firstSeen', 'lastSeen']) {
    if (!isDay(rec[f])) r.push(`previous.${f}: missing or not YYYY-MM-DD`);
  }
  for (const f of ['firstRowDate', 'lastSessionDate']) {
    if (rec[f] !== undefined && rec[f] !== null && !isDay(rec[f])) r.push(`previous.${f}: not YYYY-MM-DD`);
  }
  for (const f of ['lastClose', 'volumeRef']) {
    if (rec[f] !== undefined && rec[f] !== null) {
      if (!isFiniteNumber(rec[f])) r.push(`previous.${f}: not finite`);
      else if (f === 'lastClose' ? rec[f] <= 0 : rec[f] < 0) r.push(`previous.${f}: out of range`);
    }
  }
  validateIdentifiers(rec.identifiers, 'previous', r);
  return r;
}

function validateConfig(config) {
  const r = [];
  const num = (k, min) => { if (!isFiniteNumber(config[k]) || config[k] < min) r.push(`config.${k}: invalid`); };
  if (config === null || typeof config !== 'object') return ['config: not an object'];
  num('nameSimilarityMin', 0); num('firstRowToleranceDays', 0); num('maxGapCalendarDays', 1);
  num('priceJumpMinRatio', 1); num('dollarVolumeRegimeMinRatio', 1); num('volumeMedianMaxBars', 1);
  num('staleSeriesCalendarDays', 1);
  if (config.nameSimilarityMin > 1) r.push('config.nameSimilarityMin: > 1');
  if (!['review', 'hard'].includes(config.gapSeverity)) r.push('config.gapSeverity: must be "review" or "hard"');
  if (!config.exchangeAliases || typeof config.exchangeAliases !== 'object') r.push('config.exchangeAliases: missing');
  if (!Array.isArray(config.stripPhrases) || !Array.isArray(config.stripTokens)) r.push('config.strip*: must be arrays');
  return r;
}

function strongIdComparison(prevIds, inIds) {
  const matched = [], mismatched = [];
  for (const t of STRONG_IDENTIFIER_TYPES) {
    const a = prevIds && prevIds[t], b = inIds && inIds[t];
    if (isNonEmptyString(a) && isNonEmptyString(b)) {
      (a.trim().toUpperCase() === b.trim().toUpperCase() ? matched : mismatched).push(t);
    }
  }
  return { matched, mismatched };
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------
/**
 * Compare the last accepted record of a listing with today's observation.
 * Returns:
 *   { conflict:boolean,            // true => hard identity conflict: must split (new instrument_id), never merge
 *     review:boolean,              // true => same instrument_id kept, but a quarantine/review record is required
 *     reasons:[...], warnings:[...], skippedRules:[...], evidence:{...},
 *     rejected:boolean, rejectReasons:[...] }
 * rejected:true means the INPUT was unusable: the caller must NOT treat it as "no conflict"; nothing may be written.
 */
function detectIdentityConflict(previousRecord, incomingRecord, config = CONFIG) {
  const rejectReasons = [...validateConfig(config), ...validatePrevious(previousRecord), ...validateIncoming(incomingRecord)];
  if (rejectReasons.length) {
    return { conflict: false, review: false, reasons: [], warnings: [], skippedRules: [], evidence: {}, rejected: true, rejectReasons };
  }
  const prev = previousRecord, inc = incomingRecord;
  const hard = [], review = [], warnings = [], skipped = [], evidence = {};

  const ids = strongIdComparison(prev.identifiers, inc.identifiers);
  evidence.identifiers = ids;
  const idMatch = ids.matched.length > 0 && ids.mismatched.length === 0;
  if (ids.mismatched.length) hard.push('identifier_mismatch');

  // 1. name
  const sim = nameSimilarity(prev.name, inc.name, config);
  evidence.nameSimilarity = sim;
  if (sim < config.nameSimilarityMin) {
    if (idMatch) warnings.push('name_change_identifier_matched'); else hard.push('name_change');
  }

  // 2. currency (never downgraded)
  if (prev.currency.trim().toUpperCase() !== inc.currency.trim().toUpperCase()) hard.push('currency_change');

  // 3. exchange
  const ex1 = normalizeExchange(prev.exchange, config), ex2 = normalizeExchange(inc.exchange, config);
  if (!ex1.mapped || !ex2.mapped) warnings.push('exchange_unmapped');
  if (ex1.exchange !== ex2.exchange) {
    if (idMatch) warnings.push('exchange_change_identifier_matched'); else hard.push('exchange_change');
  }

  // 4. first-row regressions
  const tol = config.firstRowToleranceDays;
  if (inc.firstRowDate && prev.firstRowDate) {
    const d = daysBetween(prev.firstRowDate, inc.firstRowDate);
    evidence.firstRowShiftDays = d;
    if (d > tol) hard.push('first_row_later_than_recorded');
    else if (d < -tol) warnings.push('first_row_earlier_than_recorded');
  } else skipped.push('first_row_vs_recorded_first_row');
  if (inc.firstRowDate) {
    if (daysBetween(prev.firstSeen, inc.firstRowDate) > tol) hard.push('first_row_later_than_first_seen');
  } else skipped.push('first_row_vs_first_seen');

  // 5. history discontinuity
  const bars = inc.bars || [];
  if (bars.length) {
    let gap = 0;
    for (let i = 1; i < bars.length; i++) gap = Math.max(gap, daysBetween(bars[i - 1].date, bars[i].date));
    const newer = prev.lastSessionDate ? bars.filter((b) => b.date > prev.lastSessionDate) : [];
    if (prev.lastSessionDate && newer.length) gap = Math.max(gap, daysBetween(prev.lastSessionDate, newer[0].date));
    evidence.maxGapCalendarDays = gap;
    if (gap > config.maxGapCalendarDays) (config.gapSeverity === 'hard' ? hard : review).push('history_gap');
    if (daysBetween(bars[bars.length - 1].date, inc.snapshotDate) > config.staleSeriesCalendarDays) warnings.push('stale_series');

    // 6. price-level jump together with a dollar-volume regime change
    if (prev.lastSessionDate && prev.lastClose && newer.length) {
      const J = newer[0].close / prev.lastClose;
      evidence.priceRatio = J;
      const vols = newer.slice(0, config.volumeMedianMaxBars).map((b) => b.volume).filter((v) => isFiniteNumber(v) && v >= 0);
      const newVol = median(vols);
      if (prev.volumeRef && prev.volumeRef > 0 && newVol !== null && newVol > 0) {
        const dv = J * (newVol / prev.volumeRef);
        evidence.dollarVolumeRatio = dv;
        const big = (x, k) => x >= k || x <= 1 / k;
        if (big(J, config.priceJumpMinRatio) && big(dv, config.dollarVolumeRegimeMinRatio)) hard.push('price_volume_regime_break');
      } else skipped.push('price_volume_regime (volume reference unavailable)');
    } else skipped.push('price_volume_regime (previous close/session or new bars unavailable)');
  } else skipped.push('history_gap', 'price_volume_regime (no incoming bars)');

  return {
    conflict: hard.length > 0,
    review: hard.length === 0 && review.length > 0,
    reasons: [...hard, ...review],
    warnings, skippedRules: skipped, evidence,
    rejected: false, rejectReasons: [],
  };
}

// ---------------------------------------------------------------------------
// Instrument resolution
// ---------------------------------------------------------------------------
function evidenceSummary(prev, inc) {
  return {
    previous: { instrumentId: prev.instrumentId, symbol: prev.symbol, exchange: prev.exchange, currency: prev.currency, name: prev.name,
      identifiers: prev.identifiers || null, firstSeen: prev.firstSeen, lastSeen: prev.lastSeen, firstRowDate: prev.firstRowDate || null,
      lastSessionDate: prev.lastSessionDate || null, lastClose: prev.lastClose ?? null },
    incoming: { snapshotDate: inc.snapshotDate, symbol: inc.symbol, exchange: inc.exchange, currency: inc.currency, name: inc.name,
      identifiers: inc.identifiers || null, firstRowDate: inc.firstRowDate || null,
      firstBars: (inc.bars || []).slice(0, 3).map((b) => ({ date: b.date, close: b.close, volume: b.volume ?? null })) },
  };
}

function freshInstrument(index, inc, createdReason) {
  return {
    instrumentId: index.nextInstrumentId,
    market: inc.market,
    firstSeen: inc.snapshotDate,
    providerFirstRowDate: inc.firstRowDate || null,
    createdReason,
    listing: { symbol: inc.symbol.trim(), exchange: normalizeExchange(inc.exchange).exchange, validFrom: inc.snapshotDate, validTo: null },
    identifiers: inc.identifiers ? { ...inc.identifiers } : {},
    name: inc.name, currency: inc.currency.trim().toUpperCase(),
  };
}

/**
 * Map an incoming observation to an instrument_id WITHOUT mutating the index.
 * The key of a listing is (symbol, exchange); the ticker alone is never the key.
 *
 * Returns one of:
 *  { action:'rejected', rejectReasons }
 *  { action:'existing', instrumentId, warnings, review?:quarantine }
 *  { action:'new', newInstrument, quarantine|null, warnings }
 *  { action:'split', newInstrument, endedInstrument, quarantine, warnings }
 * New ids are index.nextInstrumentId (the caller persists and increments); the old id is NEVER reassigned.
 */
function resolveInstrument(snapshotIndex, incoming, config = CONFIG) {
  const reasons = [...validateConfig(config)];
  if (snapshotIndex === null || typeof snapshotIndex !== 'object') reasons.push('index: not an object');
  else {
    if (!Number.isInteger(snapshotIndex.nextInstrumentId) || snapshotIndex.nextInstrumentId < 1) reasons.push('index.nextInstrumentId: not a positive integer');
    if (!Array.isArray(snapshotIndex.instruments)) reasons.push('index.instruments: not an array');
    if (!Array.isArray(snapshotIndex.listings)) reasons.push('index.listings: not an array');
  }
  reasons.push(...validateIncoming(incoming));
  if (reasons.length) return { action: 'rejected', rejectReasons: reasons };

  const index = snapshotIndex;
  const byId = new Map(index.instruments.map((i) => [i.instrumentId, i]));
  const sym = incoming.symbol.trim();
  const exch = normalizeExchange(incoming.exchange, config).exchange;
  const keyOf = (l) => l.symbol + '\u0000' + normalizeExchange(l.exchange, config).exchange;
  const open = index.listings.filter((l) => l.validTo === null && keyOf(l) === sym + '\u0000' + exch);
  if (open.length > 1) return { action: 'rejected', rejectReasons: [`index: ${open.length} open listings for ${sym}/${exch} (corrupt index)`] };

  const warnings = [];
  const snapshotDate = incoming.snapshotDate;

  if (open.length === 1) {
    const prev = byId.get(open[0].instrumentId);
    if (!prev) return { action: 'rejected', rejectReasons: [`index: listing refers to unknown instrument ${open[0].instrumentId}`] };
    if (prev.status === 'delisted' || prev.status === 'ended_identity_conflict') {
      return { action: 'rejected', rejectReasons: [`index: open listing on terminal instrument ${prev.instrumentId} (corrupt index)`] };
    }
    if (snapshotDate < prev.lastSeen) return { action: 'rejected', rejectReasons: ['incoming.snapshotDate: earlier than previous.lastSeen (out-of-order snapshot)'] };
    const det = detectIdentityConflict(prev, incoming, config);
    if (det.rejected) return { action: 'rejected', rejectReasons: det.rejectReasons };
    warnings.push(...det.warnings);
    if (!det.conflict) {
      const out = { action: 'existing', instrumentId: prev.instrumentId, warnings, skippedRules: det.skippedRules };
      if (det.review) {
        out.review = { kind: 'review_flag', snapshotDate, symbol: sym, exchange: exch, oldInstrumentId: prev.instrumentId, newInstrumentId: null,
          reasons: det.reasons, evidence: { ...evidenceSummary(prev, incoming), detector: det.evidence }, status: 'open' };
      }
      return out;
    }
    // Hard conflict: same (symbol, exchange) now belongs to a different entity. Split. Never merge.
    const newInstrument = freshInstrument(index, incoming, 'identity_conflict_split');
    return {
      action: 'split',
      newInstrument,
      endedInstrument: { instrumentId: prev.instrumentId, status: 'ended_identity_conflict', endedOn: prev.lastSeen, detectedOn: snapshotDate,
        listingClose: { symbol: sym, exchange: exch, validTo: prev.lastSeen } },
      quarantine: { kind: 'hard_split', snapshotDate, symbol: sym, exchange: exch, oldInstrumentId: prev.instrumentId, newInstrumentId: newInstrument.instrumentId,
        reasons: det.reasons, evidence: { ...evidenceSummary(prev, incoming), detector: det.evidence }, status: 'open' },
      warnings,
    };
  }

  // No open listing for (symbol, exchange).
  const newInstrument = freshInstrument(index, incoming, 'new');
  let quarantine = null;

  // (a) the pair was held before and closed (delisted / ended): reuse of a closed symbol by a new instrument
  const closed = index.listings.filter((l) => l.validTo !== null && keyOf(l) === sym + '\u0000' + exch);
  if (closed.length) {
    const lastClosed = closed.slice().sort((a, b) => (a.validTo < b.validTo ? -1 : a.validTo > b.validTo ? 1 : 0)).pop();
    newInstrument.createdReason = 'symbol_reuse_after_close';
    quarantine = { kind: 'symbol_reuse_after_close', snapshotDate, symbol: sym, exchange: exch, oldInstrumentId: lastClosed.instrumentId,
      newInstrumentId: newInstrument.instrumentId, reasons: ['symbol_previously_held_by_other_instrument'],
      evidence: { closedListing: lastClosed, incoming: incomingForEvidence(incoming) },
      status: 'open' };
  }
  // (b) same symbol is open on ANOTHER exchange: a different instrument; flag as candidate relation only
  const otherEx = index.listings.filter((l) => l.validTo === null && l.symbol === sym && normalizeExchange(l.exchange, config).exchange !== exch);
  if (otherEx.length) {
    warnings.push('symbol_open_on_other_exchange');
    if (!quarantine) {
      newInstrument.createdReason = 'other_exchange_listing';
      quarantine = { kind: 'other_exchange_listing', snapshotDate, symbol: sym, exchange: exch, oldInstrumentId: otherEx[0].instrumentId,
        newInstrumentId: newInstrument.instrumentId, reasons: ['same_symbol_open_on_other_exchange'],
        evidence: { otherListings: otherEx, incoming: incomingForEvidence(incoming) }, status: 'open' };
    }
  }
  // (c) a strong identifier already belongs to another instrument under another symbol: possible symbol change.
  // NEVER merged automatically; recorded for explicit confirmation.
  const inIds = incoming.identifiers || {};
  const sameId = index.instruments.filter((i) => i.instrumentId && i.status !== 'ended_identity_conflict' &&
    strongIdComparison(i.identifiers, inIds).matched.length > 0 && !(i.symbol === sym));
  if (sameId.length && !quarantine) {
    newInstrument.createdReason = 'possible_symbol_change';
    quarantine = { kind: 'possible_symbol_change', snapshotDate, symbol: sym, exchange: exch, oldInstrumentId: sameId[0].instrumentId,
      newInstrumentId: newInstrument.instrumentId, reasons: ['strong_identifier_matches_other_instrument'],
      evidence: { matchedInstrument: { instrumentId: sameId[0].instrumentId, symbol: sameId[0].symbol, exchange: sameId[0].exchange, name: sameId[0].name },
        incoming: incomingForEvidence(incoming) }, status: 'open' };
  }
  return { action: 'new', newInstrument, quarantine, warnings };
}

function incomingForEvidence(inc) {
  return { snapshotDate: inc.snapshotDate, symbol: inc.symbol, exchange: inc.exchange, currency: inc.currency, name: inc.name,
    identifiers: inc.identifiers || null, firstRowDate: inc.firstRowDate || null,
    firstBars: (inc.bars || []).slice(0, 3).map((b) => ({ date: b.date, close: b.close, volume: b.volume ?? null })) };
}

// ---------------------------------------------------------------------------
// Canonical JSON, content hash, chain
// ---------------------------------------------------------------------------
/** Canonical JSON: keys sorted, no whitespace, finite numbers only. Throws IdentityInputError on anything else. */
function canonicalize(value, path = '$') {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new IdentityInputError([`${path}: non-finite number`]);
      return JSON.stringify(value); // -0 serializes as 0
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map((v, i) => canonicalize(v, `${path}[${i}]`)).join(',') + ']';
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new IdentityInputError([`${path}: non-plain object`]);
      const keys = Object.keys(value).sort();
      return '{' + keys.map((k) => {
        if (value[k] === undefined) throw new IdentityInputError([`${path}.${k}: undefined (use null for absent)`]);
        return JSON.stringify(k) + ':' + canonicalize(value[k], `${path}.${k}`);
      }).join(',') + '}';
    }
    default: throw new IdentityInputError([`${path}: unsupported type ${typeof value}`]);
  }
}

/**
 * SHA-256 (hex) over the canonical form of a SET of rows: rows are canonicalized, then sorted as strings,
 * so the input order never changes the hash. Throws IdentityInputError for invalid rows (NaN, undefined, ...).
 */
function snapshotContentHash(rows) {
  if (!Array.isArray(rows)) throw new IdentityInputError(['rows: not an array']);
  const lines = rows.map((r, i) => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) throw new IdentityInputError([`rows[${i}]: not an object`]);
    return canonicalize(r, `rows[${i}]`);
  }).sort();
  return crypto.createHash('sha256').update('mizan-snapshot-content/1\n' + lines.join('\n'), 'utf8').digest('hex');
}

/** Provenance is part of the hashed content: header (source, endpoint, retrieved_at, http summary, collector_version, kind, date) + rows. */
function contentHashForRun(header, rows) {
  if (header === null || typeof header !== 'object' || Array.isArray(header)) throw new IdentityInputError(['header: not an object']);
  if (!Array.isArray(rows)) throw new IdentityInputError(['rows: not an array']);
  return snapshotContentHash([{ __run_header__: header }, ...rows]);
}

const HEX64 = /^[0-9a-f]{64}$/;
/** chain_hash = SHA-256(domain \n prevHash \n contentHash). prevHash of the first run is GENESIS_HASH. */
function chainLink(prevHash, contentHash) {
  const bad = [];
  if (typeof prevHash !== 'string' || !HEX64.test(prevHash)) bad.push('prevHash: not 64 lowercase hex chars');
  if (typeof contentHash !== 'string' || !HEX64.test(contentHash)) bad.push('contentHash: not 64 lowercase hex chars');
  if (bad.length) throw new IdentityInputError(bad);
  return crypto.createHash('sha256').update(`${CHAIN_DOMAIN}\n${prevHash}\n${contentHash}`, 'utf8').digest('hex');
}

/**
 * Verify a chain of runs: [{seq, prevHash, contentHash, chainHash, contentInput?}].
 * opts.anchor = {seq, chainHash} - a head recorded OUTSIDE the database (e.g. committed to git).
 * Without an anchor, truncation of the tail and a fully recomputed chain are NOT detectable.
 * Returns { ok, errors:[{seq, code, detail}], head:{seq, chainHash}|null }.
 */
function verifyChain(runs, opts = {}) {
  const errors = [];
  const add = (seq, code, detail) => errors.push({ seq, code, detail });
  if (!Array.isArray(runs)) return { ok: false, errors: [{ seq: null, code: 'invalid_input', detail: 'runs: not an array' }], head: null };
  let prevChain = GENESIS_HASH, prevSeq = 0;
  const startSeq = opts.startSeq === undefined ? 1 : opts.startSeq;
  runs.forEach((r, i) => {
    if (r === null || typeof r !== 'object' || !Number.isInteger(r.seq)) { add(null, 'invalid_run', `runs[${i}] missing integer seq`); return; }
    const s = r.seq;
    if (i === 0) {
      if (s !== startSeq) add(s, 'bad_start', `first seq ${s}, expected ${startSeq}`);
      if (startSeq === 1) prevChain = GENESIS_HASH;
      else if (typeof opts.startPrevHash === 'string') prevChain = opts.startPrevHash;
      else prevChain = r.prevHash; // cannot check the first link of a partial chain without startPrevHash
    } else if (s !== prevSeq + 1) add(s, s <= prevSeq ? 'out_of_order_or_duplicate' : 'seq_gap', `seq ${s} after ${prevSeq}`);
    if (r.prevHash !== prevChain) add(s, 'broken_link', 'prevHash does not equal previous chainHash');
    try {
      if (r.contentInput !== undefined && snapshotContentHash(r.contentInput) !== r.contentHash) add(s, 'content_mismatch', 'contentHash differs from recomputed hash of contentInput');
      if (chainLink(r.prevHash, r.contentHash) !== r.chainHash) add(s, 'chain_hash_mismatch', 'chainHash differs from chainLink(prevHash, contentHash)');
    } catch (e) { add(s, 'invalid_hash_field', e.reasons ? e.reasons.join('; ') : String(e.message)); }
    prevChain = r.chainHash; prevSeq = s;
  });
  const last = runs.length ? runs[runs.length - 1] : null;
  const head = last && Number.isInteger(last.seq) ? { seq: last.seq, chainHash: last.chainHash } : null;
  if (opts.anchor) {
    const a = opts.anchor;
    if (!a || !Number.isInteger(a.seq) || typeof a.chainHash !== 'string') add(null, 'invalid_anchor', 'anchor needs {seq, chainHash}');
    else {
      const at = runs.find((r) => r && r.seq === a.seq);
      if (!head || head.seq < a.seq) add(a.seq, 'truncated', `chain ends at ${head ? head.seq : 'nothing'} but anchor is at ${a.seq}`);
      else if (!at) add(a.seq, 'anchor_missing', 'no run with the anchored seq');
      else if (at.chainHash !== a.chainHash) add(a.seq, 'anchor_mismatch', 'chainHash at anchored seq differs from the external anchor (history rewritten)');
    }
  }
  return { ok: errors.length === 0, errors, head };
}

// ---------------------------------------------------------------------------
// Delisting candidates and status transitions
// ---------------------------------------------------------------------------
/**
 * history: ascending [{snapshotDate, complete:boolean, present:boolean}] for ONE instrument over universe snapshots.
 * Only COMPLETE snapshots count as evidence (a failed/partial universe fetch is not evidence of absence).
 * candidate = the instrument was present at least once and the latest N complete snapshots all lack it.
 */
function detectCandidateDelisting(history, N = CONFIG.delistingConsecutiveAbsences) {
  const rejectReasons = [];
  if (!Number.isInteger(N) || N < 1) rejectReasons.push('N: not a positive integer');
  if (!Array.isArray(history)) rejectReasons.push('history: not an array');
  else {
    let prev = null;
    history.forEach((h, i) => {
      if (h === null || typeof h !== 'object') { rejectReasons.push(`history[${i}]: not an object`); return; }
      if (!isDay(h.snapshotDate)) rejectReasons.push(`history[${i}].snapshotDate: missing or not YYYY-MM-DD`);
      else { if (prev !== null && h.snapshotDate <= prev) rejectReasons.push(`history[${i}].snapshotDate: not strictly ascending`); prev = h.snapshotDate; }
      if (typeof h.complete !== 'boolean') rejectReasons.push(`history[${i}].complete: not boolean`);
      if (typeof h.present !== 'boolean') rejectReasons.push(`history[${i}].present: not boolean`);
    });
  }
  if (rejectReasons.length) return { candidate: false, rejected: true, rejectReasons, consecutiveAbsences: 0 };

  const complete = history.filter((h) => h.complete);
  let run = 0;
  for (let i = complete.length - 1; i >= 0 && !complete[i].present; i--) run++;
  const everPresent = complete.some((h) => h.present);
  const lastPresent = complete.filter((h) => h.present).pop();
  const firstAbsent = run ? complete[complete.length - run] : null;
  return {
    candidate: everPresent && run >= N,
    rejected: false, rejectReasons: [],
    consecutiveAbsences: run, N,
    lastPresentDate: lastPresent ? lastPresent.snapshotDate : null,
    firstAbsentDate: firstAbsent ? firstAbsent.snapshotDate : null,
    presentInLatest: complete.length ? complete[complete.length - 1].present : null,
    reasons: everPresent ? [] : ['never_present_in_complete_snapshot'],
  };
}

const STATUSES = Object.freeze(['active', 'candidate_delisted', 'delisted', 'ended_identity_conflict']);

/**
 * Pure status transition. Automatic detection can only move active -> candidate_delisted.
 * Leaving candidate_delisted (to delisted OR back to active) requires an explicit confirmation record:
 *   { type:'confirm_delisted'|'reinstate', date:'YYYY-MM-DD', actor:string, evidence:string }
 * 'delisted' and 'ended_identity_conflict' are terminal for that instrument_id (a reappearing symbol is a NEW instrument).
 * Returns { status, changed, reasons, flags, rejected }.
 */
function resolveDelistingStatus(currentStatus, detection, confirmation = null) {
  const bad = [];
  if (!STATUSES.includes(currentStatus)) bad.push('currentStatus: unknown');
  if (detection === null || typeof detection !== 'object' || detection.rejected !== false) bad.push('detection: missing or rejected');
  if (confirmation !== null) {
    if (typeof confirmation !== 'object') bad.push('confirmation: not an object');
    else {
      if (!['confirm_delisted', 'reinstate'].includes(confirmation.type)) bad.push('confirmation.type: must be confirm_delisted or reinstate');
      if (!isDay(confirmation.date)) bad.push('confirmation.date: missing or not YYYY-MM-DD');
      if (!isNonEmptyString(confirmation.actor)) bad.push('confirmation.actor: missing');
      if (!isNonEmptyString(confirmation.evidence)) bad.push('confirmation.evidence: missing');
    }
  }
  if (bad.length) return { status: currentStatus, changed: false, reasons: bad, flags: [], rejected: true };

  const flags = [];
  if (currentStatus === 'delisted' || currentStatus === 'ended_identity_conflict') {
    if (confirmation) return { status: currentStatus, changed: false, reasons: ['terminal_status_cannot_be_changed'], flags, rejected: true };
    if (detection.presentInLatest === true) flags.push('reappeared_after_terminal_status_new_instrument_required');
    return { status: currentStatus, changed: false, reasons: [], flags, rejected: false };
  }
  if (currentStatus === 'active') {
    if (confirmation) return { status: 'active', changed: false, reasons: ['confirmation_not_applicable_to_active'], flags, rejected: true };
    return detection.candidate
      ? { status: 'candidate_delisted', changed: true, reasons: ['consecutive_absence_threshold_reached'], flags, rejected: false }
      : { status: 'active', changed: false, reasons: [], flags, rejected: false };
  }
  // candidate_delisted
  if (confirmation) {
    return confirmation.type === 'confirm_delisted'
      ? { status: 'delisted', changed: true, reasons: ['confirmed_by_record'], flags, rejected: false }
      : { status: 'active', changed: true, reasons: ['reinstated_by_record'], flags, rejected: false };
  }
  if (detection.presentInLatest === true) flags.push('reappeared_awaiting_explicit_reinstatement');
  return { status: 'candidate_delisted', changed: false, reasons: [], flags, rejected: false };
}

module.exports = {
  CONFIG, GENESIS_HASH, STRONG_IDENTIFIER_TYPES, STATUSES, IdentityInputError,
  normalizeName, nameSimilarity, normalizeExchange,
  validateIncoming, validatePrevious,
  detectIdentityConflict, resolveInstrument,
  canonicalize, snapshotContentHash, contentHashForRun, chainLink, verifyChain,
  detectCandidateDelisting, resolveDelistingStatus,
};

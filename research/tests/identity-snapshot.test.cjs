'use strict';
/**
 * Tests for research/snapshot/identity.cjs and research/snapshot/schema.sql.
 * Run: node --test research/tests/identity-snapshot.test.cjs
 * STATE: CODE-TESTED reference only. These tests prove the reference logic behaves as designed on synthetic fixtures;
 * they prove nothing about live data, detector error rates, or the removal of survivorship bias.
 *
 * Fixture note: the ONLY facts taken from the probe are the start dates / row counts of the replacement series
 * (SBNY: 114 rows from 2024-08-12; BBBY: 441 rows from 2026-07-17). All names, prices, volumes and older dates are
 * illustrative placeholders, not real data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const id = require('../snapshot/identity.cjs');

// ---------- helpers ----------
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }
const clone = (o) => JSON.parse(JSON.stringify(o));

function bars(startDate, n, close, volume, step = 1) {
  const out = []; const t0 = Date.parse(startDate + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push({ date: new Date(t0 + i * step * 86400000).toISOString().slice(0, 10), close, volume });
  return out;
}

function prevRecord(over = {}) {
  return {
    instrumentId: 1, symbol: 'SBNY', exchange: 'NASDAQ', currency: 'USD', name: 'Signature Bank (fixture)',
    identifiers: {}, firstSeen: '2026-10-16', lastSeen: '2026-10-20', firstRowDate: '2004-03-01',
    lastSessionDate: '2026-10-20', lastClose: 100, volumeRef: 1_000_000, status: 'active', ...over,
  };
}
function incoming(over = {}) {
  return {
    market: 'us', snapshotDate: '2026-10-21', symbol: 'SBNY', exchange: 'NASDAQ', currency: 'USD',
    name: 'Signature Bank (fixture)', identifiers: {}, firstRowDate: '2004-03-01',
    bars: [{ date: '2026-10-21', close: 101, volume: 1_100_000 }], ...over,
  };
}
function indexWith(instruments, listings, next) { return deepFreeze({ nextInstrumentId: next, instruments, listings }); }
function simpleIndex(prevOver = {}) {
  const p = prevRecord(prevOver);
  return indexWith([p], [{ instrumentId: p.instrumentId, symbol: p.symbol, exchange: p.exchange, validFrom: p.firstSeen, validTo: null }], 2);
}
/** What the collector would do with a resolveInstrument result (kept in the test: the module is pure). */
function apply(index, res, inc) {
  const next = clone(index);
  const record = (ni) => ({
    instrumentId: ni.instrumentId, symbol: ni.listing.symbol, exchange: ni.listing.exchange, currency: ni.currency, name: ni.name,
    identifiers: ni.identifiers, firstSeen: ni.firstSeen, lastSeen: inc.snapshotDate, firstRowDate: ni.providerFirstRowDate || undefined,
    lastSessionDate: inc.bars && inc.bars.length ? inc.bars[inc.bars.length - 1].date : undefined,
    lastClose: inc.bars && inc.bars.length ? inc.bars[inc.bars.length - 1].close : undefined, status: 'active',
  });
  if (res.action === 'split') {
    const old = next.instruments.find((i) => i.instrumentId === res.endedInstrument.instrumentId);
    old.status = 'ended_identity_conflict';
    const l = next.listings.find((x) => x.instrumentId === old.instrumentId && x.validTo === null); l.validTo = res.endedInstrument.listingClose.validTo;
  }
  if (res.action === 'split' || res.action === 'new') {
    next.instruments.push(record(res.newInstrument));
    next.listings.push({ instrumentId: res.newInstrument.instrumentId, ...res.newInstrument.listing });
    next.nextInstrumentId = res.newInstrument.instrumentId + 1;
  }
  return deepFreeze(next);
}

// =====================================================================================
test('normalizeName / nameSimilarity: benign tweaks are identical, different entities are far apart', () => {
  assert.equal(id.nameSimilarity('Apple Inc.', 'Apple Inc'), 1);
  assert.equal(id.nameSimilarity('Agilent Technologies, Inc.', 'Agilent Technologies, Inc. Common Stock'), 1);
  assert.equal(id.nameSimilarity('APPLE INC', 'apple inc.'), 1);
  assert.ok(id.nameSimilarity('Signature Bank', 'Zeta Robotics Holdings') < 0.3);
  assert.equal(id.nameSimilarity('', 'x'), 0);
  assert.equal(id.nameSimilarity(null, 'Apple'), 0);
  // Arabic folding (alef variants, taa marbuta, diacritics, tatweel)
  assert.equal(id.nameSimilarity('شركة أرامكو السعودية', 'شركه ارامكو السعوديه'), 1);
  // never reduces a name to nothing
  assert.notEqual(id.normalizeName('Company Inc'), '');
});

test('ticker benign name tweak (Apple Inc. vs Apple Inc): no conflict, no review', () => {
  const prev = prevRecord({ symbol: 'AAPL', name: 'Apple Inc.', firstRowDate: '1980-12-12' });
  const r = id.detectIdentityConflict(prev, incoming({ symbol: 'AAPL', name: 'Apple Inc', firstRowDate: '1980-12-12' }));
  assert.equal(r.rejected, false);
  assert.equal(r.conflict, false);
  assert.equal(r.review, false);
  assert.deepEqual(r.reasons, []);
});

test('exchange aliases: NMS vs NASDAQ is the same venue, not a conflict', () => {
  const r = id.detectIdentityConflict(prevRecord({ exchange: 'NMS' }), incoming({ exchange: 'NASDAQ' }));
  assert.equal(r.conflict, false);
});

test('SBNY scenario: same ticker, different entity -> hard conflict, new instrument_id, old ended, quarantined, never merged', () => {
  const index = simpleIndex({ firstRowDate: '2004-03-01' });
  const inc = incoming({
    name: 'Zeta Robotics Holdings (fixture replacement entity)', firstRowDate: '2024-08-12',    // evidence: 114 rows from 2024-08-12
    bars: [{ date: '2026-10-21', close: 7.4, volume: 90_000 }],
  });
  const res = id.resolveInstrument(index, inc);
  assert.equal(res.action, 'split');
  assert.equal(res.newInstrument.instrumentId, 2);                       // issued from index.nextInstrumentId
  assert.notEqual(res.newInstrument.instrumentId, 1);                    // never reuses the old id
  assert.equal(res.endedInstrument.instrumentId, 1);
  assert.equal(res.endedInstrument.status, 'ended_identity_conflict');
  assert.equal(res.endedInstrument.endedOn, '2026-10-20');               // last date the old entity was actually observed
  assert.equal(res.endedInstrument.listingClose.validTo, '2026-10-20');
  assert.equal(res.newInstrument.listing.validFrom, '2026-10-21');
  assert.equal(res.newInstrument.listing.validTo, null);
  assert.equal(res.quarantine.kind, 'hard_split');
  assert.equal(res.quarantine.status, 'open');
  assert.equal(res.quarantine.oldInstrumentId, 1);
  assert.equal(res.quarantine.newInstrumentId, 2);
  for (const reason of ['name_change', 'first_row_later_than_recorded', 'price_volume_regime_break']) {
    assert.ok(res.quarantine.reasons.includes(reason), 'missing reason ' + reason + ' in ' + res.quarantine.reasons);
  }
  assert.ok(res.quarantine.evidence.previous && res.quarantine.evidence.incoming);
  // applying it: the ticker now resolves to the NEW id on the next day, the old id has no open listing
  const next = apply(index, res, inc);
  const again = id.resolveInstrument(next, incoming({ snapshotDate: '2026-10-22', name: inc.name, firstRowDate: '2024-08-12',
    bars: [{ date: '2026-10-22', close: 7.5, volume: 95_000 }] }));
  assert.equal(again.action, 'existing');
  assert.equal(again.instrumentId, 2);
  assert.equal(next.listings.filter((l) => l.validTo === null && l.symbol === 'SBNY').length, 1);
});

test('BBBY scenario: replacement series starting later than the recorded first row is a conflict even when the name is unchanged', () => {
  const prev = { symbol: 'BBBY', name: 'Bed Bath & Beyond (fixture)', firstRowDate: '1992-06-09', firstSeen: '2026-10-16' };
  const index = simpleIndex(prev);
  const inc = incoming({ symbol: 'BBBY', name: 'Bed Bath & Beyond (fixture)', firstRowDate: '2026-07-17',   // evidence: 441 rows from 2026-07-17
    bars: [{ date: '2026-10-21', close: 101, volume: 1_000_000 }] });
  const det = id.detectIdentityConflict(index.instruments[0], inc);
  assert.equal(det.conflict, true);
  assert.deepEqual(det.reasons, ['first_row_later_than_recorded']);   // 2026-07-17 vs recorded 1992-06-09; name alone would not have caught it
  assert.equal(id.resolveInstrument(index, inc).action, 'split');
});

test('symbol reappears after its instrument was delisted: new instrument + symbol_reuse_after_close quarantine, old id untouched', () => {
  const old = prevRecord({ status: 'delisted', lastSeen: '2026-11-01' });
  const index = indexWith([old], [{ instrumentId: 1, symbol: 'SBNY', exchange: 'NASDAQ', validFrom: '2026-10-16', validTo: '2026-11-01' }], 2);
  const res = id.resolveInstrument(index, incoming({ snapshotDate: '2027-02-01', name: 'Zeta Robotics Holdings (fixture)', firstRowDate: '2024-08-12',
    bars: [{ date: '2027-02-01', close: 7.4, volume: 90_000 }] }));
  assert.equal(res.action, 'new');
  assert.equal(res.newInstrument.instrumentId, 2);
  assert.equal(res.newInstrument.createdReason, 'symbol_reuse_after_close');
  assert.equal(res.quarantine.kind, 'symbol_reuse_after_close');
  assert.equal(res.quarantine.oldInstrumentId, 1);
  assert.notEqual(res.quarantine.newInstrumentId, res.quarantine.oldInstrumentId);
  assert.equal(res.endedInstrument, undefined);
});

test('currency change -> conflict (never downgraded, even when identifiers match)', () => {
  const prev = prevRecord({ identifiers: { isin: 'US0000000001' } });
  const r = id.detectIdentityConflict(prev, incoming({ currency: 'EUR', identifiers: { isin: 'US0000000001' } }));
  assert.equal(r.conflict, true);
  assert.ok(r.reasons.includes('currency_change'));
});

test('exchange change -> conflict; with a matching strong identifier it is only a warning', () => {
  const a = id.detectIdentityConflict(prevRecord(), incoming({ exchange: 'NYSE' }));
  assert.equal(a.conflict, true); assert.ok(a.reasons.includes('exchange_change'));
  const b = id.detectIdentityConflict(prevRecord({ identifiers: { isin: 'US0000000001' } }), incoming({ exchange: 'NYSE', identifiers: { isin: 'US0000000001' } }));
  assert.equal(b.conflict, false); assert.ok(b.warnings.includes('exchange_change_identifier_matched'));
});

test('name change with matching ISIN is a warning; a mismatching ISIN is a conflict even with the same name', () => {
  const same = id.detectIdentityConflict(prevRecord({ identifiers: { isin: 'US0000000001' } }),
    incoming({ name: 'Zeta Robotics Holdings (fixture)', identifiers: { isin: 'US0000000001' } }));
  assert.equal(same.conflict, false);
  assert.ok(same.warnings.includes('name_change_identifier_matched'));
  const diff = id.detectIdentityConflict(prevRecord({ identifiers: { isin: 'US0000000001' } }), incoming({ identifiers: { isin: 'US0000000002' } }));
  assert.equal(diff.conflict, true);
  assert.ok(diff.reasons.includes('identifier_mismatch'));
});

test('symbol reused on a different exchange is a different instrument; the other listing is not ended', () => {
  const index = simpleIndex({ symbol: 'AAA', exchange: 'NYSE', name: 'Alpha Corp (fixture)' });
  const res = id.resolveInstrument(index, incoming({ symbol: 'AAA', exchange: 'NASDAQ', name: 'Alpha Corp (fixture)' }));
  assert.equal(res.action, 'new');
  assert.notEqual(res.newInstrument.instrumentId, 1);
  assert.equal(res.newInstrument.listing.exchange, 'NASDAQ');
  assert.equal(res.quarantine.kind, 'other_exchange_listing');
  assert.equal(res.endedInstrument, undefined);
  assert.ok(res.warnings.includes('symbol_open_on_other_exchange'));
  // and same-venue alias spelling does NOT create a second instrument
  const alias = id.resolveInstrument(simpleIndex({ symbol: 'AAA', exchange: 'NMS', name: 'Alpha Corp (fixture)' }), incoming({ symbol: 'AAA', exchange: 'NASDAQ', name: 'Alpha Corp (fixture)' }));
  assert.equal(alias.action, 'existing');
});

test('strong identifier seen under a different symbol: new instrument + possible_symbol_change quarantine, never auto-merged', () => {
  const index = simpleIndex({ symbol: 'OLDT', identifiers: { isin: 'US0000000009' }, name: 'Kappa Industries (fixture)' });
  const res = id.resolveInstrument(index, incoming({ symbol: 'NEWT', name: 'Kappa Industries (fixture)', identifiers: { isin: 'US0000000009' } }));
  assert.equal(res.action, 'new');
  assert.equal(res.quarantine.kind, 'possible_symbol_change');
  assert.equal(res.quarantine.oldInstrumentId, 1);
  assert.notEqual(res.newInstrument.instrumentId, 1);
});

test('history gap alone: same instrument_id kept but a review flag is produced (severity is a config switch)', () => {
  const index = simpleIndex({ lastSessionDate: '2026-08-01', lastSeen: '2026-08-01', lastClose: 100 });
  const inc = incoming({ snapshotDate: '2026-10-21', bars: [{ date: '2026-10-20', close: 101, volume: 1_000_000 }, { date: '2026-10-21', close: 102, volume: 1_000_000 }] });
  const res = id.resolveInstrument(index, inc);
  assert.equal(res.action, 'existing'); assert.equal(res.instrumentId, 1);
  assert.equal(res.review.kind, 'review_flag');
  assert.deepEqual(res.review.reasons, ['history_gap']);
  assert.equal(res.review.newInstrumentId, null);
  const hardCfg = { ...id.CONFIG, gapSeverity: 'hard' };
  assert.equal(id.resolveInstrument(index, inc, hardCfg).action, 'split');
  // gap inside the incoming window is detected too
  const inside = id.detectIdentityConflict(prevRecord(), incoming({ bars: [{ date: '2026-06-01', close: 100, volume: 1 }, { date: '2026-10-20', close: 100, volume: 1 }] }));
  assert.equal(inside.review, true); assert.ok(inside.reasons.includes('history_gap'));
  // a normal weekend gap is not a gap
  assert.deepEqual(id.detectIdentityConflict(prevRecord({ lastSessionDate: '2026-10-16' }), incoming({ bars: [{ date: '2026-10-19', close: 100, volume: 1_000_000 }] })).reasons, []);
});

test('first_seen regression: provider first row later than recorded -> conflict; earlier -> warning only', () => {
  const later = id.detectIdentityConflict(prevRecord({ firstRowDate: '2010-01-04', firstSeen: '2026-10-16' }), incoming({ firstRowDate: '2015-06-01' }));
  assert.equal(later.conflict, true); assert.ok(later.reasons.includes('first_row_later_than_recorded'));
  const earlier = id.detectIdentityConflict(prevRecord({ firstRowDate: '2010-01-04' }), incoming({ firstRowDate: '2005-01-03' }));
  assert.equal(earlier.conflict, false); assert.ok(earlier.warnings.includes('first_row_earlier_than_recorded'));
  // provider claims the history starts AFTER the day we already observed it trading: contradiction
  const afterSeen = id.detectIdentityConflict(prevRecord({ firstRowDate: undefined, firstSeen: '2026-10-16' }), incoming({ firstRowDate: '2026-10-25' }));
  assert.equal(afterSeen.conflict, true); assert.ok(afterSeen.reasons.includes('first_row_later_than_first_seen'));
  const jitter = id.detectIdentityConflict(prevRecord({ firstRowDate: '2010-01-04' }), incoming({ firstRowDate: '2010-01-06' }));   // within tolerance
  assert.equal(jitter.conflict, false);
});

test('price/volume regime: a split (dollar volume preserved) is NOT a conflict; an entity swap (dollar volume collapses) is', () => {
  const split = id.detectIdentityConflict(prevRecord(), incoming({ bars: [{ date: '2026-10-21', close: 25, volume: 4_000_000 }] }));   // price /4, volume x4
  assert.equal(split.conflict, false);
  const swap = id.detectIdentityConflict(prevRecord(), incoming({ bars: [{ date: '2026-10-21', close: 10, volume: 1_000_000 }] }));    // price /10, volume x1
  assert.equal(swap.conflict, true); assert.ok(swap.reasons.includes('price_volume_regime_break'));
  const noVol = id.detectIdentityConflict(prevRecord({ volumeRef: undefined }), incoming({ bars: [{ date: '2026-10-21', close: 10 }] }));
  assert.equal(noVol.conflict, false);
  assert.ok(noVol.skippedRules.some((s) => s.startsWith('price_volume_regime')));
});

test('all thresholds live in a frozen config marked PROVISIONAL', () => {
  assert.equal(id.CONFIG.status, 'PROVISIONAL');
  assert.ok(Object.isFrozen(id.CONFIG) && Object.isFrozen(id.CONFIG.exchangeAliases));
  for (const k of ['nameSimilarityMin', 'firstRowToleranceDays', 'maxGapCalendarDays', 'priceJumpMinRatio', 'dollarVolumeRegimeMinRatio', 'delistingConsecutiveAbsences']) {
    assert.equal(typeof id.CONFIG[k], 'number', k);
  }
  // a stricter config is honoured (no hidden constants)
  const strict = { ...id.CONFIG, nameSimilarityMin: 0.99 };
  const r = id.detectIdentityConflict(prevRecord({ name: 'Acme Widgets Ltd' }), incoming({ name: 'Acme Widget Ltd' }), strict);
  assert.ok(r.conflict);
  assert.equal(id.detectIdentityConflict(prevRecord({ name: 'Acme Widgets Ltd' }), incoming({ name: 'Acme Widget Ltd' })).conflict, false);
});

// =====================================================================================
test('invalid input is rejected with explicit reasons (NaN, Infinity, missing, bad dates, wrong types) and never reported as "no conflict" silently', () => {
  const cases = {
    'NaN close': incoming({ bars: [{ date: '2026-10-21', close: NaN, volume: 1 }] }),
    'Infinity volume': incoming({ bars: [{ date: '2026-10-21', close: 1, volume: Infinity }] }),
    'negative close': incoming({ bars: [{ date: '2026-10-21', close: -1, volume: 1 }] }),
    'missing symbol': incoming({ symbol: undefined }),
    'empty name': incoming({ name: '  ' }),
    'bad snapshot date': incoming({ snapshotDate: '2026-13-40' }),
    'bars not array': incoming({ bars: 'x' }),
    'unordered bars': incoming({ bars: [{ date: '2026-10-21', close: 1 }, { date: '2026-10-20', close: 1 }] }),
    'bad market': incoming({ market: 'eu' }),
    'bad identifiers': incoming({ identifiers: { isin: 5 } }),
    'null record': null,
  };
  for (const [label, rec] of Object.entries(cases)) {
    const det = id.detectIdentityConflict(prevRecord(), rec);
    assert.equal(det.rejected, true, label);
    assert.ok(det.rejectReasons.length > 0, label);
    assert.equal(det.conflict, false, label);
    const res = id.resolveInstrument(simpleIndex(), rec);
    assert.equal(res.action, 'rejected', label);
    assert.ok(res.rejectReasons.length > 0, label);
  }
  assert.ok(id.detectIdentityConflict(prevRecord({ lastClose: NaN }), incoming()).rejectReasons.some((s) => s.includes('previous.lastClose')));
  assert.equal(id.detectIdentityConflict(null, incoming()).rejected, true);
  assert.equal(id.resolveInstrument({ nextInstrumentId: 0, instruments: [], listings: [] }, incoming()).action, 'rejected');
  assert.equal(id.resolveInstrument(simpleIndex(), incoming({ snapshotDate: '2026-10-01' })).action, 'rejected');   // out-of-order snapshot
  assert.equal(id.detectIdentityConflict(prevRecord(), incoming(), { ...id.CONFIG, nameSimilarityMin: NaN }).rejected, true);
});

test('corrupt index (two open listings for one key) is rejected, not guessed', () => {
  const p = prevRecord();
  const idx = indexWith([p], [{ instrumentId: 1, symbol: 'SBNY', exchange: 'NASDAQ', validFrom: 'x', validTo: null }, { instrumentId: 1, symbol: 'SBNY', exchange: 'NASDAQ', validFrom: 'y', validTo: null }], 2);
  assert.equal(id.resolveInstrument(idx, incoming()).action, 'rejected');
});

test('determinism and purity: same input -> same output; inputs are not mutated; no clock or randomness is used', () => {
  const index = simpleIndex();
  const inc = deepFreeze(incoming({ name: 'Zeta Robotics Holdings (fixture)', firstRowDate: '2024-08-12', bars: [{ date: '2026-10-21', close: 7, volume: 9 }] }));
  const realNow = Date.now, realRandom = Math.random;
  Date.now = () => { throw new Error('Date.now used'); }; Math.random = () => { throw new Error('Math.random used'); };
  let a, b;
  try { a = id.resolveInstrument(index, inc); b = id.resolveInstrument(index, inc); id.snapshotContentHash([{ a: 1 }]); id.detectCandidateDelisting([], 3); }
  finally { Date.now = realNow; Math.random = realRandom; }
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// =====================================================================================
const hist = (pattern) => pattern.map((p, i) => ({ snapshotDate: new Date(Date.UTC(2026, 9, 16 + i)).toISOString().slice(0, 10), complete: p !== 'x', present: p === 'P' }));

test('delisting candidate: requires N consecutive absences in COMPLETE snapshots', () => {
  assert.equal(id.detectCandidateDelisting(hist(['P', 'P', 'A', 'A', 'A', 'A']), 5).candidate, false);          // 4 < 5
  const r = id.detectCandidateDelisting(hist(['P', 'P', 'A', 'A', 'A', 'A', 'A']), 5);                          // 5
  assert.equal(r.candidate, true); assert.equal(r.consecutiveAbsences, 5);
  assert.equal(r.lastPresentDate, '2026-10-17'); assert.equal(r.firstAbsentDate, '2026-10-18');
  // incomplete snapshots are not evidence: they neither count as absence nor break the run
  assert.equal(id.detectCandidateDelisting(hist(['P', 'A', 'A', 'x', 'x', 'A', 'A']), 5).candidate, false);     // only 4 complete absences
  assert.equal(id.detectCandidateDelisting(hist(['P', 'A', 'A', 'x', 'A', 'A', 'A']), 5).candidate, true);      // 5 complete absences with an incomplete one inside
  // a presence in between resets the count
  assert.equal(id.detectCandidateDelisting(hist(['P', 'A', 'A', 'A', 'P', 'A', 'A']), 3).candidate, false);
  // never seen present: not a candidate
  const never = id.detectCandidateDelisting(hist(['A', 'A', 'A', 'A', 'A', 'A']), 5);
  assert.equal(never.candidate, false); assert.ok(never.reasons.includes('never_present_in_complete_snapshot'));
  // invalid input rejected
  assert.equal(id.detectCandidateDelisting(hist(['P']), 0).rejected, true);
  assert.equal(id.detectCandidateDelisting([{ snapshotDate: '2026-10-16', complete: true, present: 'yes' }], 3).rejected, true);
  assert.equal(id.detectCandidateDelisting([{ snapshotDate: '2026-10-17', complete: true, present: true }, { snapshotDate: '2026-10-16', complete: true, present: true }], 3).rejected, true);
});

test('delisting status: automatic only to candidate_delisted; leaving it needs an explicit confirmation record; terminal states stay terminal', () => {
  const cand = id.detectCandidateDelisting(hist(['P', 'A', 'A', 'A']), 3);
  assert.deepEqual(id.resolveDelistingStatus('active', cand), { status: 'candidate_delisted', changed: true, reasons: ['consecutive_absence_threshold_reached'], flags: [], rejected: false });
  // reappearance does NOT silently revert
  const back = id.detectCandidateDelisting(hist(['P', 'A', 'A', 'A', 'P']), 3);
  assert.equal(back.candidate, false); assert.equal(back.presentInLatest, true);
  const stay = id.resolveDelistingStatus('candidate_delisted', back);
  assert.equal(stay.status, 'candidate_delisted'); assert.equal(stay.changed, false);
  assert.ok(stay.flags.includes('reappeared_awaiting_explicit_reinstatement'));
  // explicit confirmation records
  const ok = { type: 'reinstate', date: '2026-10-25', actor: 'owner', evidence: 'directory outage on 2026-10-17..19 confirmed' };
  assert.equal(id.resolveDelistingStatus('candidate_delisted', back, ok).status, 'active');
  assert.equal(id.resolveDelistingStatus('candidate_delisted', cand, { ...ok, type: 'confirm_delisted' }).status, 'delisted');
  // malformed confirmations are rejected and change nothing
  for (const bad of [{ ...ok, actor: '' }, { ...ok, evidence: undefined }, { ...ok, date: 'tomorrow' }, { ...ok, type: 'maybe' }]) {
    const r = id.resolveDelistingStatus('candidate_delisted', back, bad);
    assert.equal(r.rejected, true); assert.equal(r.status, 'candidate_delisted');
  }
  // 'delisted' is terminal: no reinstatement, a reappearing symbol must be a NEW instrument
  const t = id.resolveDelistingStatus('delisted', back, ok);
  assert.equal(t.rejected, true); assert.equal(t.status, 'delisted');
  assert.ok(id.resolveDelistingStatus('delisted', back).flags.includes('reappeared_after_terminal_status_new_instrument_required'));
  // a confirmation cannot be applied to an active instrument (no skipping the candidate step)
  assert.equal(id.resolveDelistingStatus('active', cand, { ...ok, type: 'confirm_delisted' }).rejected, true);
});

// =====================================================================================
const runHeader = (n) => ({ kind: 'bars', snapshot_date: '2026-10-' + String(16 + n), source: 'fixture', endpoint: 'https://example.invalid/{symbol}', retrieved_at: '2026-10-2' + n + 'T00:00:00Z', http: { 200: 3 }, collector_version: 'test-0', row_count: 3 });
const runRows = (n) => [1, 2, 3].map((k) => ({ instrument_id: k, session_date: '2026-10-' + String(16 + n), close: 100 + k + n, volume: 1000 * k }));
function buildChain(n) {
  const runs = []; let prev = id.GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const contentInput = [{ __run_header__: runHeader(i) }, ...runRows(i)];
    const contentHash = id.contentHashForRun(runHeader(i), runRows(i));
    const chainHash = id.chainLink(prev, contentHash);
    runs.push({ seq: i, prevHash: prev, contentHash, chainHash, contentInput });
    prev = chainHash;
  }
  return runs;
}
const codes = (v) => v.errors.map((e) => e.code);

test('content hash: deterministic, order-independent, key-order-independent, sensitive to any change', () => {
  const rows = runRows(1);
  const h = id.snapshotContentHash(rows);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(id.snapshotContentHash(clone(rows)), h);
  assert.equal(id.snapshotContentHash(rows.slice().reverse()), h);
  assert.equal(id.snapshotContentHash(rows.map((r) => Object.fromEntries(Object.entries(r).reverse()))), h);
  const changed = clone(rows); changed[1].close += 0.01;
  assert.notEqual(id.snapshotContentHash(changed), h);
  assert.notEqual(id.snapshotContentHash(rows.slice(0, 2)), h);
  assert.notEqual(id.snapshotContentHash([]), h);
  assert.equal(id.snapshotContentHash([{ a: -0 }]), id.snapshotContentHash([{ a: 0 }]));
  // provenance is part of the hashed content
  assert.notEqual(id.contentHashForRun(runHeader(1), rows), id.contentHashForRun({ ...runHeader(1), source: 'other' }, rows));
});

test('content hash rejects NaN / Infinity / undefined / non-plain values with explicit reasons', () => {
  for (const bad of [[{ a: NaN }], [{ a: Infinity }], [{ a: undefined }], [{ a: () => 1 }], [{ a: 10n }], [{ a: new Date(0) }], [5], ['x'], [[1]], 'rows']) {
    assert.throws(() => id.snapshotContentHash(bad), (e) => e instanceof id.IdentityInputError && e.reasons.length > 0);
  }
  assert.throws(() => id.chainLink('zz', 'ab'), (e) => e.reasons.length === 2);
  assert.throws(() => id.chainLink(id.GENESIS_HASH, undefined), id.IdentityInputError);
});

test('hash chain: intact chain verifies; chain links are deterministic', () => {
  const runs = buildChain(5);
  const v = id.verifyChain(runs);
  assert.equal(v.ok, true); assert.deepEqual(v.errors, []);
  assert.equal(v.head.seq, 5);
  assert.deepEqual(buildChain(5).map((r) => r.chainHash), runs.map((r) => r.chainHash));
  assert.equal(runs[0].prevHash, id.GENESIS_HASH);
});

test('tamper detection: changed content, changed hash fields, deleted/reordered/duplicated runs', () => {
  // 1. a stored row is altered after the fact -> recomputed content hash differs
  let runs = buildChain(5); runs[2].contentInput[1].close = 999;
  assert.ok(codes(id.verifyChain(runs)).includes('content_mismatch'));
  // 2. contentHash edited to match the altered rows, chainHash left alone -> chain_hash_mismatch
  runs = buildChain(5); runs[2].contentInput[1].close = 999; runs[2].contentHash = id.snapshotContentHash(runs[2].contentInput);
  assert.ok(codes(id.verifyChain(runs)).includes('chain_hash_mismatch'));
  // 3. run 3 rewritten with a fresh valid chainHash, later runs untouched -> broken link at run 4
  runs = buildChain(5); runs[2].contentInput[1].close = 999; runs[2].contentHash = id.snapshotContentHash(runs[2].contentInput);
  runs[2].chainHash = id.chainLink(runs[2].prevHash, runs[2].contentHash);
  const v3 = id.verifyChain(runs);
  assert.equal(v3.ok, false);
  assert.deepEqual(v3.errors.filter((e) => e.code === 'broken_link').map((e) => e.seq), [4]);
  // 4. a middle run deleted
  runs = buildChain(5); runs.splice(2, 1);
  assert.ok(codes(id.verifyChain(runs)).includes('seq_gap'));
  // 5. reordered
  runs = buildChain(5); [runs[1], runs[2]] = [runs[2], runs[1]];
  assert.equal(id.verifyChain(runs).ok, false);
  // 6. duplicated seq
  runs = buildChain(3); runs.push({ ...runs[2] });
  assert.ok(codes(id.verifyChain(runs)).includes('out_of_order_or_duplicate'));
  // 7. malformed hash fields are errors, not crashes
  runs = buildChain(2); runs[1].chainHash = 'nothex';
  assert.equal(id.verifyChain(runs).ok, false);
  assert.equal(id.verifyChain('nope').ok, false);
});

test('anchored head: truncation and a fully recomputed chain are detected ONLY with an external anchor (documented limit)', () => {
  const full = buildChain(6);
  const anchor = { seq: 6, chainHash: full[5].chainHash };
  assert.equal(id.verifyChain(full, { anchor }).ok, true);

  // truncation: tail removed. Internally consistent, so NOT detectable without an anchor ...
  const truncated = full.slice(0, 4);
  assert.equal(id.verifyChain(truncated).ok, true);
  // ... but detected with the anchor
  const vt = id.verifyChain(truncated, { anchor });
  assert.equal(vt.ok, false); assert.ok(codes(vt).includes('truncated'));

  // full rewrite: attacker alters run 3 and recomputes EVERY later link. Consistent internally ...
  const rewritten = buildChain(6);
  rewritten[2].contentInput[1].close = 999;
  let prev = rewritten[1].chainHash;
  for (let i = 2; i < rewritten.length; i++) {
    const r = rewritten[i]; r.prevHash = prev; r.contentHash = id.snapshotContentHash(r.contentInput); r.chainHash = id.chainLink(r.prevHash, r.contentHash); prev = r.chainHash;
  }
  assert.equal(id.verifyChain(rewritten).ok, true);                       // limit: no anchor, no detection
  const vr = id.verifyChain(rewritten, { anchor });
  assert.equal(vr.ok, false); assert.ok(codes(vr).includes('anchor_mismatch'));   // anchor catches it

  // an anchor in the middle of a longer chain also pins the past
  const mid = { seq: 3, chainHash: full[2].chainHash };
  assert.equal(id.verifyChain(full, { anchor: mid }).ok, true);
  assert.ok(codes(id.verifyChain(rewritten, { anchor: mid })).includes('anchor_mismatch'));
  assert.ok(codes(id.verifyChain(full, { anchor: { seq: 3 } })).includes('invalid_anchor'));
});

// =====================================================================================
// schema.sql: parse + behavioural checks of constraints and triggers (node:sqlite, in memory). Skipped if unavailable.
let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* not available on this Node */ }
const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'snapshot', 'schema.sql'), 'utf8');

function freshDb() { const db = new DatabaseSync(':memory:'); db.exec(schemaSql); return db; }
const T = '2026-10-21T00:00:00Z';
function insertRun(db, chain, over0 = {}) {
  const over = { ...chain, ...over0 };   // options may be given in either argument
  const seq = chain.seq ?? 1;
  const contentHash = over.contentHash || id.snapshotContentHash([{ n: seq }]);
  const chainHash = id.chainLink(chain.prev, contentHash);
  db.prepare(`INSERT INTO snapshot_run (chain_seq,kind,snapshot_date,market,status,expected_count,row_count,source,source_endpoint,retrieved_at,http_status_summary,collector_version,content_hash,prev_hash,chain_hash,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(seq, over.kind || 'universe', over.date || '2026-10-21', over.market || 'us', over.status || 'complete', 1, 1, 'fixture', 'https://example.invalid/{symbol}', T, '{"200":1}', 'test-0',
    contentHash, over.prevHash || chain.prev, chainHash, T);
  return chainHash;
}
const throwsSql = (fn, re) => assert.throws(fn, (e) => re.test(String(e.message)), 'expected SQL failure ' + re);

test('schema.sql parses and enforces chain linkage, immutability, one-open-listing, and status/conflict guards', { skip: DatabaseSync ? false : 'node:sqlite not available' }, () => {
  const db = freshDb();
  db.exec('PRAGMA foreign_keys = ON');
  // chain: genesis + extension; wrong link / wrong seq / update / delete rejected
  const h1 = insertRun(db, { seq: 1, prev: id.GENESIS_HASH });
  throwsSql(() => insertRun(db, { seq: 2, prev: id.GENESIS_HASH }), /extend the current head/);
  throwsSql(() => insertRun(db, { seq: 3, prev: h1 }), /extend the current head/);
  const h2 = insertRun(db, { seq: 2, prev: h1, kind: 'bars', date: '2026-10-21' });
  throwsSql(() => db.exec("UPDATE snapshot_run SET status='partial' WHERE run_id=1"), /append-only/);
  throwsSql(() => db.exec('DELETE FROM snapshot_run WHERE run_id=1'), /append-only/);
  // a second COMPLETE universe run for the same date/market is refused
  throwsSql(() => insertRun(db, { seq: 3, prev: h2, kind: 'universe', date: '2026-10-21' }), /UNIQUE/i);

  // instrument + listings
  db.exec("INSERT INTO instrument (market,first_seen,created_reason,created_run_id) VALUES ('us','2026-10-21','new',1)");
  db.exec("INSERT INTO instrument (market,first_seen,created_reason,created_run_id) VALUES ('us','2026-10-21','identity_conflict_split',1)");
  throwsSql(() => db.exec("UPDATE instrument SET market='sa' WHERE instrument_id=1"), /immutable/);
  throwsSql(() => db.exec('DELETE FROM instrument WHERE instrument_id=1'), /never deleted/);
  db.exec("INSERT INTO instrument_listing (instrument_id,symbol,exchange,valid_from,opened_run_id) VALUES (1,'SBNY','NASDAQ','2026-10-21',1)");
  throwsSql(() => db.exec("INSERT INTO instrument_listing (instrument_id,symbol,exchange,valid_from,opened_run_id) VALUES (2,'SBNY','NASDAQ','2026-10-22',1)"), /UNIQUE/i);   // ticker reuse blocked while open
  db.exec("INSERT INTO instrument_listing (instrument_id,symbol,exchange,valid_from,opened_run_id) VALUES (2,'SBNY','NYSE','2026-10-22',1)");                                   // other exchange allowed
  throwsSql(() => db.exec("UPDATE instrument_listing SET symbol='X' WHERE listing_id=1"), /only a one-time close/);
  throwsSql(() => db.exec("UPDATE instrument_listing SET valid_to='2026-10-20', closed_run_id=2 WHERE listing_id=1"), /CHECK|constraint/i);   // valid_to < valid_from
  db.exec("UPDATE instrument_listing SET valid_to='2026-10-21', closed_run_id=2 WHERE listing_id=1");
  throwsSql(() => db.exec("UPDATE instrument_listing SET valid_to='2026-10-25', closed_run_id=2 WHERE listing_id=1"), /only a one-time close/);                                  // cannot re-close
  db.exec("INSERT INTO instrument_listing (instrument_id,symbol,exchange,valid_from,opened_run_id) VALUES (2,'SBNY','NASDAQ','2026-10-22',2)");                                   // now allowed: interval closed
  throwsSql(() => db.exec('DELETE FROM instrument_listing WHERE listing_id=1'), /append-only/);

  // identifiers: normalized values only, append-only
  db.exec("INSERT INTO instrument_identifier VALUES (1,'isin','US0000000001','fixture',1)");
  throwsSql(() => db.exec("INSERT INTO instrument_identifier VALUES (1,'isin','us0000000002','fixture',1)"), /CHECK|constraint/i);
  throwsSql(() => db.exec("UPDATE instrument_identifier SET id_value='US0000000003'"), /append-only/);

  // bars: only into the latest bars run; append-only; basic value checks; restatement = new row in a later run
  const bar = (run, close, extra = '') => `INSERT INTO snapshot_bar (run_id,instrument_id,session_date,open,high,low,close,volume,is_backfill${extra}) VALUES (${run},1,'2026-10-20',1,2,1,${close},10,0)`;
  db.exec(bar(2, 1.5));
  throwsSql(() => db.exec(bar(2, 1.5)), /UNIQUE|PRIMARY/i);
  throwsSql(() => db.exec(bar(2, -1).replace('(2,1', '(2,2').replace("'2026-10-20'", "'2026-10-19'")), /CHECK|constraint/i);
  throwsSql(() => db.exec(bar(1, 1.5)), /latest run/);                                   // run 1 is a universe run and not the latest
  throwsSql(() => db.exec("UPDATE snapshot_bar SET close=9 WHERE run_id=2"), /append-only/);
  throwsSql(() => db.exec('DELETE FROM snapshot_bar'), /append-only/);
  const h3 = insertRun(db, { seq: 3, prev: h2, kind: 'bars', date: '2026-10-22' });
  db.exec(bar(3, 1.6));                                                                  // restated value for the same session, later run
  assert.equal(db.prepare('SELECT COUNT(*) n FROM snapshot_bar WHERE instrument_id=1 AND session_date=?').get('2026-10-20').n, 2);
  // corporate-action fields: numerator without denominator is refused; a full pair is accepted
  const splitBar = (date, cols, vals) => `INSERT INTO snapshot_bar (run_id,instrument_id,session_date,close,is_backfill${cols}) VALUES (3,1,'${date}',1.6,0${vals})`;
  throwsSql(() => db.exec(splitBar('2026-10-18', ',split_numerator', ',2')), /CHECK|constraint/i);
  db.exec(splitBar('2026-10-17', ',split_numerator,split_denominator', ',2,1'));

  // universe rows: only latest run + must match that run's date
  insertRun(db, { seq: 4, prev: h3, kind: 'universe', date: '2026-10-22' });
  db.exec("INSERT INTO snapshot_universe (run_id,instrument_id,snapshot_date,symbol,exchange,name,currency,instrument_type) VALUES (4,2,'2026-10-22','SBNY','NASDAQ','Zeta','USD','EQUITY')");
  throwsSql(() => db.exec("INSERT INTO snapshot_universe (run_id,instrument_id,snapshot_date,symbol,exchange,name,currency,instrument_type) VALUES (3,1,'2026-10-22','SBNY','NASDAQ','x','USD','EQUITY')"), /latest run/);
  throwsSql(() => db.exec("UPDATE snapshot_universe SET name='y'"), /append-only/);

  // status events: auto cannot reach 'delisted'; candidate -> active needs confirmation; terminal is terminal
  const ev = (iid, status, kind, extra = "NULL,NULL") => `INSERT INTO instrument_status_event (instrument_id,status,effective_date,kind,run_id,actor,evidence,recorded_at) VALUES (${iid},'${status}','2026-10-22','${kind}',4,${extra},'${T}')`;
  db.exec(ev(1, 'active', 'auto'));
  db.exec(ev(1, 'candidate_delisted', 'auto'));
  throwsSql(() => db.exec(ev(1, 'delisted', 'auto')), /CHECK|constraint/i);
  throwsSql(() => db.exec(ev(1, 'active', 'auto')), /without a confirmation/);
  throwsSql(() => db.exec(ev(1, 'active', 'confirmation')), /CHECK|constraint/i);        // no actor/evidence
  db.exec(ev(1, 'active', 'confirmation', "'owner','directory outage'"));
  db.exec(ev(1, 'candidate_delisted', 'auto'));
  db.exec(ev(1, 'delisted', 'confirmation', "'owner','exchange notice'"));
  throwsSql(() => db.exec(ev(1, 'active', 'confirmation', "'owner','x'")), /terminal/);
  db.exec(ev(2, 'active', 'auto'));
  db.exec(ev(2, 'ended_identity_conflict', 'auto'));
  throwsSql(() => db.exec(ev(2, 'candidate_delisted', 'auto')), /terminal/);
  assert.equal(db.prepare('SELECT status FROM instrument_current_status WHERE instrument_id=1').get().status, 'delisted');
  throwsSql(() => db.exec("DELETE FROM instrument_status_event"), /append-only/);

  // identity_conflict: old != new, review_flag has no new id, one-time resolution with actor/note, evidence frozen
  const conflict = (kind, oldId, newId) => `INSERT INTO identity_conflict (detected_run_id,snapshot_date,symbol,exchange,kind,old_instrument_id,new_instrument_id,reasons_json,evidence_json) VALUES (4,'2026-10-22','SBNY','NASDAQ','${kind}',${oldId},${newId},'["name_change"]','{}')`;
  throwsSql(() => db.exec(conflict('hard_split', 1, 1)), /CHECK|constraint/i);           // merge (same id) impossible
  throwsSql(() => db.exec(conflict('hard_split', 1, 'NULL')), /CHECK|constraint/i);
  throwsSql(() => db.exec(conflict('review_flag', 1, 2)), /CHECK|constraint/i);
  db.exec(conflict('hard_split', 1, 2));
  throwsSql(() => db.exec("UPDATE identity_conflict SET reasons_json='[\"x\"]'"), /one-time/);
  throwsSql(() => db.exec("UPDATE identity_conflict SET status='resolved', resolution='confirmed_distinct'"), /CHECK|constraint/i);   // no actor / note
  db.exec("UPDATE identity_conflict SET status='resolved', resolution='confirmed_succession', resolved_by='owner', resolved_at='2026-11-01T00:00:00Z', resolution_note='reviewed filings'");
  assert.deepEqual(db.prepare('SELECT predecessor_id p, successor_id s FROM instrument_confirmed_link').get(), { __proto__: null, p: 1, s: 2 });
  throwsSql(() => db.exec("UPDATE identity_conflict SET resolution='dismissed_false_alarm'"), /one-time/);
  throwsSql(() => db.exec('DELETE FROM identity_conflict'), /never deleted/);
  db.close();
});

test('end to end: code-computed content hashes and chain links satisfy the database chain guard', { skip: DatabaseSync ? false : 'node:sqlite not available' }, () => {
  const db = freshDb();
  let prev = id.GENESIS_HASH; const runs = [];
  for (let i = 1; i <= 3; i++) {
    const ch = id.contentHashForRun(runHeader(i), runRows(i));
    prev = insertRun(db, { seq: i, prev: runs.length ? runs[runs.length - 1].chain_hash : id.GENESIS_HASH }, { contentHash: ch, kind: 'bars', date: '2026-10-' + (16 + i), prevHash: runs.length ? runs[runs.length - 1].chain_hash : id.GENESIS_HASH });
    runs.push({ chain_hash: prev });
  }
  const rows = db.prepare('SELECT chain_seq seq, prev_hash prevHash, content_hash contentHash, chain_hash chainHash FROM snapshot_run ORDER BY chain_seq').all().map((r) => ({ ...r }));
  assert.equal(id.verifyChain(rows).ok, true);
  assert.equal(id.verifyChain(rows, { anchor: { seq: 3, chainHash: rows[2].chainHash } }).ok, true);
  db.close();
});

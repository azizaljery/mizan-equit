'use strict';
/**
 * Tests for research/experiments/universe-pit.cjs. SYNTHETIC DATA ONLY (no real prices, holdout untouched).
 * run: node --test research/experiments/__tests__/universe-pit.test.cjs
 * CODE-TESTED status only: passing these tests is NOT predictive evidence.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../negsel-lib.cjs');
const P = require('../universe-pit.cjs');

// ------------------------------------------------------------------ synthetic helpers
function genDates(n, start = '2015-01-05') {
  const out = [];
  let d = new Date(start + 'T00:00:00Z');
  while (out.length < n) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
function gauss(rng) { let u = 0; while (u === 0) u = rng(); const v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function synth(seed, nSym = 25, nDates = 400) {
  const rng = L.mulberry32(seed), dates = genDates(nDates), out = [];
  for (let k = 0; k < nSym; k++) {
    let p = 20 + rng() * 30;
    const drift = (k - nSym / 2) * 0.0002;
    const rows = dates.map((date) => { p *= Math.exp(drift + 0.012 * gauss(rng)); return [date, p, p, p, p, 1e6]; });
    out.push({symbol: `S${String(k).padStart(2, '0')}`, rows});
  }
  return {dates, series: out};
}
const clone = (series) => series.map((s) => ({...s, rows: s.rows.map((r) => r.slice())}));
const T = 300; // decision index; history >= 260 is available for all synthetic names
const H = 5;

/** Everything decided at t (universe, features, ranks, selection) — the object that must be future-invariant. */
function decisionAt(series, t, opts = {}) {
  const ctx = P.buildContextPIT(series);
  const uni = P.universeAtPIT(ctx, t, opts);
  const sel = P.selectAt(uni, opts);
  return {
    asOf: uni.asOf,
    universe: uni.members.map((m) => m.symbol),
    excluded: uni.excluded,
    features: uni.members.map((m) => [m.symbol, m.features]),
    ranks: sel.ranked,
    selection: sel.members.map((m) => [m.symbol, m.refClose, m.value, m.z]),
    N: sel.N, nSel: sel.nSel,
  };
}

// ------------------------------------------------------------------ rankAt
test('rankAt: average ranks for ties, z=(rank-1)/(N-1)-0.5, N=1 -> 0, NaN ignored', () => {
  assert.deepEqual(P.rankAt([3, 1, 2]), [0.5, -0.5, 0]);
  assert.deepEqual(P.rankAt([1, 2, 2, 3]), [-0.5, 0, 0, 0.5]); // ties share avg rank 2.5 -> 1.5/3-0.5 = 0
  assert.deepEqual(P.rankAt([7]), [0]);
  const r = P.rankAt([NaN, 5, 1]);
  assert.ok(Number.isNaN(r[0]));
  assert.deepEqual(r.slice(1), [0.5, -0.5]);
  assert.deepEqual(P.rankAt([]), []);
});

test('selectionCount: floor vs ceil without float artefacts', () => {
  assert.equal(P.selectionCount(35, 0.2, 'floor'), 7);
  assert.equal(P.selectionCount(35, 0.2, 'ceil'), 7);
  assert.equal(P.selectionCount(37, 0.2, 'floor'), 7);
  assert.equal(P.selectionCount(37, 0.2, 'ceil'), 8);
  assert.equal(P.selectionCount(1, 0.2, 'floor'), 0);
  assert.equal(P.selectionCount(1, 0.2, 'ceil'), 1);
  assert.equal(P.selectionCount(0, 0.2, 'ceil'), 0);
});

// ------------------------------------------------------------------ future poisoning
test('future poisoning: deleting / replacing / NaN-ing ALL data after t changes nothing decided at t', () => {
  const {dates, series} = synth(11);
  const base = decisionAt(series, T);
  assert.ok(base.N >= 20 && base.nSel >= 4, 'sanity: non-trivial universe');
  const cutDate = dates[T];
  const mutate = (fn) => clone(series).map((s) => ({...s, rows: fn(s.rows)}));
  const variants = {
    deleted: mutate((rows) => rows.filter((r) => r[0] <= cutDate)),
    nan: mutate((rows) => rows.map((r) => (r[0] > cutDate ? [r[0], NaN, NaN, NaN, NaN, NaN] : r))),
    replaced: (() => {
      const rng = L.mulberry32(999);
      return mutate((rows) => rows.map((r) => (r[0] > cutDate ? [r[0], 1, 1, 1, rng() * 1000 + 0.01, 1] : r)));
    })(),
    huge_jump: mutate((rows) => rows.map((r) => (r[0] > cutDate ? [r[0], r[1] * 50, r[2] * 50, r[3] * 50, r[4] * 50, r[5]] : r))),
    partial_delete: mutate((rows) => rows.filter((r, i) => r[0] <= cutDate || i % 3 === 0)),
    garbage_rows: mutate((rows) => rows.concat([['2099-01-01', 0, 0, 0, -5, 0], ['bad', 1, 1, 1, 1, 1]])),
    future_delisting_meta: clone(series).map((s, k) => (k % 4 === 0 ? {...s, delistedOn: dates[T + 2]} : s)),
  };
  for (const [name, v] of Object.entries(variants)) {
    assert.deepEqual(decisionAt(v, T), base, `variant ${name} changed the decision at t`);
  }
});

test('legacy contrast (read-only): frozen dir-0001 universeAt IS sensitive to data after t (the finding)', () => {
  const D = require('../dir-0001.cjs'); // FROZEN: required read-only, not modified
  const {dates, series} = synth(12, 22, 400);
  const withCur = (arr) => arr.map((s) => ({...s, currency: 'USD', rows: s.rows}));
  const full = D.buildContext('us', withCur(series));
  const cutDate = dates[T + 2];
  const poisoned = withCur(clone(series).map((s, k) => (k === 0 ? {...s, rows: s.rows.filter((r) => r[0] <= cutDate)} : s)));
  const ctxP = D.buildContext('us', poisoned);
  const a = D.universeAt(full, T, H, 0).map((si) => full.syms[si].symbol);
  const b = D.universeAt(ctxP, T, H, 0).map((si) => ctxP.syms[si].symbol);
  assert.notDeepEqual(a, b, 'legacy universe changed because a close after t disappeared');
  // the PIT universe does not move under the same poisoning
  assert.deepEqual(decisionAt(poisoned, T), decisionAt(withCur(series), T));
});

// ------------------------------------------------------------------ outcomes
test('missing end price keeps the symbol in the selection as missing (no invented price)', () => {
  const {dates, series} = synth(13);
  const ctx0 = P.buildContextPIT(series);
  const sel0 = P.selectAt(P.universeAtPIT(ctx0, T));
  const victim = sel0.members[0].symbol;
  const target = dates[T + H];
  const s2 = clone(series).map((s) => (s.symbol === victim ? {...s, rows: s.rows.filter((r) => r[0] !== target)} : s));
  const ctx = P.buildContextPIT(s2);
  const sel = P.selectAt(P.universeAtPIT(ctx, T));
  assert.deepEqual(sel.members.map((m) => m.symbol), sel0.members.map((m) => m.symbol));
  const out = P.attachOutcomes(sel, ctx, H);
  assert.equal(out.members.length, sel.members.length);
  const v = out.members.find((m) => m.symbol === victim);
  assert.equal(v.outcome.state, 'missing');
  assert.equal(v.outcome.endClose, null);
  assert.equal(v.outcome.ret, null);
  assert.equal(out.summary.n, sel.nSel);
  assert.equal(out.summary.missing, 1);
  assert.equal(out.summary.complete, sel.nSel - 1);
  // input selection not mutated
  assert.equal(sel.members[0].outcome, undefined);
});

test('target beyond the calendar -> missing, not dropped', () => {
  const {dates, series} = synth(14);
  const s2 = clone(series).map((s) => ({...s, rows: s.rows.filter((r) => r[0] <= dates[T + 1])}));
  const ctx = P.buildContextPIT(s2);
  const out = P.attachOutcomes(P.selectAt(P.universeAtPIT(ctx, T)), ctx, H);
  assert.ok(out.members.length > 0);
  assert.ok(out.members.every((m) => m.outcome.state === 'missing' && m.outcome.reason === 'target_beyond_calendar'));
  assert.equal(out.summary.upRateAll, 0);
});

test('delisted: after t -> stays selected, outcome delisted; as of t -> excluded from universe', () => {
  const {dates, series} = synth(15);
  const ctx0 = P.buildContextPIT(series);
  const victim = P.selectAt(P.universeAtPIT(ctx0, T)).members[0].symbol;
  const dl = dates[T + 2];
  const s2 = clone(series).map((s) => (s.symbol === victim ? {...s, delistedOn: dl, rows: s.rows.filter((r) => r[0] < dl)} : s));
  const ctx = P.buildContextPIT(s2);
  const sel = P.selectAt(P.universeAtPIT(ctx, T));
  assert.ok(sel.members.some((m) => m.symbol === victim), 'future delisting must not remove the name at t');
  const out = P.attachOutcomes(sel, ctx, H);
  const v = out.members.find((m) => m.symbol === victim);
  assert.equal(v.outcome.state, 'delisted');
  assert.equal(v.outcome.ret, null);
  assert.equal(out.summary.delisted, 1);
  assert.equal(out.summary.n, sel.nSel);
  // decision date on/after delisting: excluded with a reason
  const uLate = P.universeAtPIT(ctx, T + 2);
  assert.ok(!uLate.members.some((m) => m.symbol === victim));
  assert.ok(uLate.excluded.some((e) => e.symbol === victim && /delisted|no_close/.test(e.reason)));
});

test('split-like jump AFTER t does not remove the series; a jump inside the window before t does (PIT guard)', () => {
  const {dates, series} = synth(16);
  const victim = 'S20';
  const after = clone(series).map((s) => (s.symbol === victim ? {...s, rows: s.rows.map((r) => (r[0] > dates[T + 1] ? [r[0], r[1] / 4, r[2] / 4, r[3] / 4, r[4] / 4, r[5] * 4] : r))} : s));
  const ctxA = P.buildContextPIT(after);
  const uA = P.universeAtPIT(ctxA, T);
  assert.ok(uA.members.some((m) => m.symbol === victim));
  assert.deepEqual(decisionAt(after, T), decisionAt(series, T));
  // the outcome legitimately sees the jump (it is after t) — the series is still there
  const out = P.attachOutcomes(P.selectAt(uA, {q: 1}), ctxA, H);
  assert.equal(out.members.find((m) => m.symbol === victim).outcome.state, 'complete');
  // jump before t inside the lookback window: excluded at t (information available at t)
  const before = clone(series).map((s) => (s.symbol === victim ? {...s, rows: s.rows.map((r) => (r[0] > dates[T - 10] ? [r[0], r[1] / 4, r[2] / 4, r[3] / 4, r[4] / 4, r[5]] : r))} : s));
  const uB = P.universeAtPIT(P.buildContextPIT(before), T);
  assert.ok(uB.excluded.some((e) => e.symbol === victim && e.reason === 'split_like_jump_in_window'));
});

test('universe admission: needs a real close ON t and >= minHistory rows <= t', () => {
  const {dates, series} = synth(17);
  const s2 = clone(series).map((s) => {
    if (s.symbol === 'S01') return {...s, rows: s.rows.filter((r) => r[0] !== dates[T])}; // no close at t
    if (s.symbol === 'S02') return {...s, rows: s.rows.slice(T - 100)}; // short history
    return s;
  });
  const u = P.universeAtPIT(P.buildContextPIT(s2), T);
  const reason = (sym) => (u.excluded.find((e) => e.symbol === sym) || {}).reason;
  assert.equal(reason('S01'), 'no_close_on_t');
  assert.equal(reason('S02'), 'insufficient_history');
  assert.ok(u.members.every((m) => m.refDate === dates[T]));
});

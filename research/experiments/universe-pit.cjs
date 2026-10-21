'use strict';
/**
 * universe-pit.cjs — POINT-IN-TIME universe, ranking and outcome attachment (pure functions, no I/O).
 *
 * Why this exists (owner spec, finding (a)): research/experiments/dir-0001.cjs universeAt() admits a symbol at t only when
 * closeAtCal[t+h] exists, and buildContext() rejects a whole series when an unadjusted-split-like jump appears ANYWHERE in it
 * (including after t). Both let future price availability shape the universe and the cross-sectional ranks at t.
 * dir-0001.cjs is FROZEN (DIR-0001 REJECTED) and is NOT modified; this module is the replacement for any NEW experiment.
 *
 * Contract:
 *   - universeAtPIT(ctx, t, opts) reads ONLY rows dated <= cal[t] (and delisting metadata only if its date <= cal[t]).
 *   - rankAt(values) is a pure cross-sectional rank (average ranks for ties): z = (rank-1)/(N-1) - 0.5, N = 1 -> 0.
 *   - selectAt(universe, opts) is ex-ante: score desc, ties by symbol; count rule floor|ceil of q*N.
 *   - attachOutcomes(selection, ctx, h) is the ONLY function that reads data after t. It appends an outcome per member with
 *     state complete | missing | delisted. Missing / delisted members stay in the denominator; no price is invented
 *     (no forward fill, no last-close carry).
 * Deterministic: no Math.random, no Date.now.
 * Code status: CODE-TESTED (research/experiments/__tests__/universe-pit.test.cjs). Tests are NOT predictive evidence.
 */
const L = require('./negsel-lib.cjs');

const DEFAULTS = Object.freeze({
  minHistory: 260, // clean sessions with date <= cal[t] (NEGSEL rule, counted as of t only)
  feature: 'mom126_5', // key used for ranking / selection
  splitJumpRatio: 2, // PIT split guard: only jumps inside the lookback window ending at t count
  splitLookback: 253, // rows inspected by the split guard (covers the longest feature window c[i-252..i])
  liquidityThreshold: null, // optional: median 20-session traded value at t must be >= this (rows <= t only)
  liqWindow: 20,
  q: 0.2,
  countRule: 'floor', // 'floor' (negsel-v1 / DIR-0001) or 'ceil' (DIR-0002 ledger-v1)
});
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build a context WITHOUT any whole-series rejection. seriesList: [{symbol, rows:[[date,o,h,l,c,v],...], delistedOn?}].
 * Per-row cleaning (negsel-lib.cleanSeries) is row-local, so rows after t never change the cleaned rows <= t.
 * The calendar is the sorted union of clean dates; removing/altering rows after cal[t] cannot change cal[0..t].
 */
function buildContextPIT(seriesList) {
  const syms = [];
  const dset = new Set();
  for (const s of seriesList || []) {
    const {rows} = L.cleanSeries(s.rows);
    for (const r of rows) dset.add(r.date);
    const delistedOn = typeof s.delistedOn === 'string' && DATE_RE.test(s.delistedOn) ? s.delistedOn : null;
    syms.push({symbol: s.symbol, rows, delistedOn});
  }
  syms.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  const cal = Array.from(dset).sort();
  const calIndex = new Map(cal.map((d, i) => [d, i]));
  for (const s of syms) {
    s.rowOfDate = new Map(s.rows.map((r, i) => [r.date, i]));
  }
  return {cal, calIndex, syms};
}

/** Default feature function: negsel-lib featuresAt (reads c[0..i] only). Returns {mom126_5, trend50_200, mom252_21}. */
const defaultFeatureFn = (closes, i) => L.featuresAt(closes, i);

/** Jumps with ratio >= k or <= 1/k among rows (from..i]; rows after i are never read. */
function jumpsInWindow(rows, from, i, k) {
  const out = [];
  for (let j = Math.max(1, from + 1); j <= i; j++) {
    const r = rows[j].c / rows[j - 1].c;
    if (r >= k || r <= 1 / k) out.push({date: rows[j].date, ratio: r});
  }
  return out;
}

/**
 * Point-in-time universe at calendar index t. Admission uses only information available at cal[t]:
 *   1. not delisted as of t (delistedOn, if known, is > cal[t]);
 *   2. a valid close ON cal[t] (actual row, no forward fill);
 *   3. >= minHistory clean rows dated <= cal[t];
 *   4. the requested feature is finite (computed from rows <= t);
 *   5. no split-like jump inside the lookback window ending at t (jumps after t are invisible here);
 *   6. optional liquidity threshold on rows <= t.
 * Returns {asOf, t, members:[{symbol, row, refClose, refDate, features}], excluded:[{symbol, reason}]} (members sorted by symbol).
 */
function universeAtPIT(ctx, t, opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);
  const featureFn = o.featureFn || defaultFeatureFn;
  if (!Number.isInteger(t) || t < 0 || t >= ctx.cal.length) throw new Error(`t out of range: ${t}`);
  const asOf = ctx.cal[t];
  const members = [], excluded = [];
  for (const s of ctx.syms) {
    if (s.delistedOn && s.delistedOn <= asOf) { excluded.push({symbol: s.symbol, reason: 'delisted_as_of_t'}); continue; }
    const i = s.rowOfDate.get(asOf);
    if (i === undefined) { excluded.push({symbol: s.symbol, reason: 'no_close_on_t'}); continue; }
    if (i + 1 < o.minHistory) { excluded.push({symbol: s.symbol, reason: 'insufficient_history'}); continue; }
    // PIT view: closes[0..i] only — the feature function physically cannot see later rows.
    const closes = new Array(i + 1);
    for (let k = 0; k <= i; k++) closes[k] = s.rows[k].c;
    const features = featureFn(closes, i);
    if (!features || !L.isNum(features[o.feature])) { excluded.push({symbol: s.symbol, reason: 'feature_not_finite'}); continue; }
    if (o.splitJumpRatio && jumpsInWindow(s.rows, i - o.splitLookback + 1, i, o.splitJumpRatio).length) {
      excluded.push({symbol: s.symbol, reason: 'split_like_jump_in_window'}); continue;
    }
    if (o.liquidityThreshold !== null && o.liquidityThreshold !== undefined) {
      const m = L.medianTradedValue(s.rows, i, o.liqWindow);
      if (!(m >= o.liquidityThreshold)) { excluded.push({symbol: s.symbol, reason: 'illiquid_at_t'}); continue; }
    }
    members.push({symbol: s.symbol, row: i, refClose: s.rows[i].c, refDate: asOf, features});
  }
  return {asOf, t, members, excluded};
}

/**
 * Cross-sectional rank: average 1-based ranks for ties, z = (rank-1)/(N-1) - 0.5 in [-0.5, 0.5]; N = 1 -> 0.
 * Non-finite inputs get NaN and do not count in N.
 */
function rankAt(values) {
  const idx = [];
  for (let i = 0; i < values.length; i++) if (L.isNum(values[i])) idx.push(i);
  idx.sort((a, b) => values[a] - values[b] || a - b);
  const N = idx.length;
  const out = new Array(values.length).fill(NaN);
  let s = 0;
  while (s < N) {
    let e = s;
    while (e + 1 < N && values[idx[e + 1]] === values[idx[s]]) e++;
    const rank = (s + e) / 2 + 1;
    for (let k = s; k <= e; k++) out[idx[k]] = N === 1 ? 0 : (rank - 1) / (N - 1) - 0.5;
    s = e + 1;
  }
  return out;
}

/** Selection count: floor(q*N) or ceil(q*N), integer-percent arithmetic (no 0.2*35 float artefacts). */
function selectionCount(N, q, rule) {
  const pct = Math.round(q * 100);
  if (rule === 'floor') return Math.floor((N * pct) / 100);
  if (rule === 'ceil') return N <= 0 ? 0 : Math.ceil((N * pct) / 100);
  throw new Error(`unknown count rule: ${rule}`);
}

/**
 * Ex-ante top-q selection from a PIT universe: rank by opts.feature (z), select highest scores, ties by symbol.
 * Returns {asOf, t, feature, q, countRule, N, nSel, ranked:[{symbol, value, z}], members:[{symbol, refClose, refDate, value, z}]}.
 */
function selectAt(universe, opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);
  const vals = universe.members.map((m) => m.features[o.feature]);
  const z = rankAt(vals);
  const ranked = universe.members.map((m, j) => ({symbol: m.symbol, value: vals[j], z: z[j], refClose: m.refClose, refDate: m.refDate}));
  const order = ranked.slice().sort((a, b) => b.value - a.value || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  const N = order.length, nSel = selectionCount(N, o.q, o.countRule);
  return {
    asOf: universe.asOf, t: universe.t, feature: o.feature, q: o.q, countRule: o.countRule, N, nSel,
    ranked: ranked.map(({symbol, value, z: zz}) => ({symbol, value, z: zz})),
    members: order.slice(0, nSel),
  };
}

/**
 * Appends outcomes h sessions after selection.t. The ONLY function here that reads data after t.
 *   complete : the symbol has an actual clean close on cal[t+h]  -> endClose, ret = endClose/refClose - 1.
 *   delisted : no close on cal[t+h] and delistedOn <= cal[t+h] (or the target session is beyond the calendar and the
 *              symbol is delisted) -> endClose null, ret null.
 *   missing  : anything else (no row on the target date, or the calendar does not reach t+h) -> endClose null, ret null.
 * Members are never dropped; the summary denominator is ALL selected members.
 * Returns a NEW object; the input selection is not mutated.
 */
function attachOutcomes(selection, ctx, h) {
  if (!Number.isInteger(h) || h < 1) throw new Error('h must be a positive integer');
  const ti = selection.t + h;
  const targetDate = ti < ctx.cal.length ? ctx.cal[ti] : null;
  const bySym = new Map(ctx.syms.map((s) => [s.symbol, s]));
  const members = selection.members.map((m) => {
    const s = bySym.get(m.symbol);
    let outcome;
    const i = s && targetDate ? s.rowOfDate.get(targetDate) : undefined;
    if (i !== undefined && L.isNum(s.rows[i].c) && s.rows[i].c > 0) {
      outcome = {state: 'complete', targetDate, endClose: s.rows[i].c, ret: s.rows[i].c / m.refClose - 1};
    } else if (s && s.delistedOn && (targetDate === null || s.delistedOn <= targetDate)) {
      outcome = {state: 'delisted', targetDate, delistedOn: s.delistedOn, endClose: null, ret: null};
    } else {
      outcome = {state: 'missing', targetDate, endClose: null, ret: null, reason: targetDate ? 'no_close_on_target' : 'target_beyond_calendar'};
    }
    return Object.assign({}, m, {outcome});
  });
  const n = members.length;
  const cnt = (st) => members.filter((m) => m.outcome.state === st).length;
  const completeRets = members.filter((m) => m.outcome.state === 'complete').map((m) => m.outcome.ret);
  const up = completeRets.filter((r) => r > 0).length;
  return Object.assign({}, selection, {
    h, targetDate, members,
    summary: {
      n, complete: cnt('complete'), missing: cnt('missing'), delisted: cnt('delisted'),
      // conservative: missing/delisted count as "not up" and stay in the denominator
      upRateAll: n ? up / n : NaN,
      meanRetComplete: completeRets.length ? L.mean(completeRets) : NaN,
    },
  });
}

module.exports = {buildContextPIT, universeAtPIT, rankAt, selectionCount, selectAt, attachOutcomes, jumpsInWindow, DEFAULTS};

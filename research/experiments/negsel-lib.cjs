'use strict';
/**
 * negsel-lib.cjs — pure helper functions for PROTOCOL-NEGSEL-0002.
 * No I/O, no Math.random, no Date.now. Everything is deterministic given its inputs.
 * Code status: CODE-TESTED (see research/tests/negsel-0002.test.cjs). Tests are NOT predictive evidence.
 */

// ---------------------------------------------------------------- basic numerics
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function mean(a) {
  if (!a || !a.length) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}
function sd(a) {
  if (!a || a.length < 2) return NaN;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
  return Math.sqrt(s / (a.length - 1));
}
function median(a) {
  const b = Array.from(a).filter(isNum).sort((x, y) => x - y);
  const n = b.length;
  if (!n) return NaN;
  return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
}

// ---------------------------------------------------------------- seeded PRNG (no Math.random)
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seededRng = (base, key) => mulberry32(fnv1a(`${base}|${key}`));

// ---------------------------------------------------------------- input cleaning
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Raw rows [date,o,h,l,c,v] -> clean rows {date,c,v}. Drops rows with invalid date or non-finite / non-positive close.
 * Non-finite or negative volume is treated as 0 (conservative for the liquidity rule). Sorts by date and drops duplicate dates (keeps first).
 */
function cleanSeries(rawRows) {
  const stats = {input: 0, badDate: 0, badClose: 0, badVolumeSetToZero: 0, duplicateDates: 0, wasUnsorted: false};
  const ok = [];
  for (const r of rawRows || []) {
    stats.input++;
    if (!Array.isArray(r) || typeof r[0] !== 'string' || !DATE_RE.test(r[0])) { stats.badDate++; continue; }
    const c = r[4];
    if (!isNum(c) || c <= 0) { stats.badClose++; continue; }
    let v = r[5];
    if (!isNum(v) || v < 0) { v = 0; stats.badVolumeSetToZero++; }
    ok.push({date: r[0], c, v});
  }
  for (let i = 1; i < ok.length; i++) if (ok[i].date < ok[i - 1].date) { stats.wasUnsorted = true; break; }
  if (stats.wasUnsorted) {
    const tagged = ok.map((x, i) => [x, i]);
    tagged.sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1]));
    ok.length = 0;
    for (const [x] of tagged) ok.push(x);
  }
  const rows = [];
  for (const x of ok) {
    if (rows.length && rows[rows.length - 1].date === x.date) { stats.duplicateDates++; continue; }
    rows.push(x);
  }
  return {rows, stats};
}

// ---------------------------------------------------------------- development cut (holdout structural guard)
/** Number of dev dates = n - ceil(0.3 n). Integer arithmetic only. */
function devCount(n) { return n - Math.ceil((n * 3) / 10); }

/** Last development date for one sorted unique calendar. Depends on the calendar (dates) only, never on prices. */
function devCutoffForCalendar(dates) {
  const k = devCount(dates.length);
  return k > 0 ? dates[k - 1] : null;
}
/** Most conservative reading: earliest of the per-calendar cutoffs (so no calendar's last-30% block is entered). */
function determineDevCutoff(calendars) {
  const per = calendars.map((c) => devCutoffForCalendar(c.dates));
  const valid = per.filter((x) => x !== null);
  return {
    cutoff: valid.length ? valid.reduce((a, b) => (a < b ? a : b)) : null,
    perCalendar: calendars.map((c, i) => ({name: c.name, n_dates: c.dates.length, dev_cutoff: per[i]})),
  };
}
/** Physically removes every row dated after the cutoff (string compare on ISO dates). */
function cutRows(rawRows, cutoff) {
  const out = [];
  for (const r of rawRows || []) if (Array.isArray(r) && typeof r[0] === 'string' && r[0] <= cutoff) out.push(r);
  return out;
}

// ---------------------------------------------------------------- features (rows <= i only)
function smaAt(c, i, n) {
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += c[k];
  return s / n;
}
/**
 * mom126_5 = ln(c[i-5]/c[i-126]); trend50_200 = ln(SMA50/SMA200); mom252_21 = ln(c[i-21]/c[i-252]).
 * Reads c[0..i] only. Returns NaN features if history is insufficient or any value is non-finite / non-positive.
 */
function featuresAt(c, i) {
  const bad = {mom126_5: NaN, trend50_200: NaN, mom252_21: NaN};
  if (!Number.isInteger(i) || i < 252 || i >= c.length) return bad;
  const need = [c[i - 5], c[i - 126], c[i - 21], c[i - 252]];
  for (let k = i - 199; k <= i; k++) need.push(c[k]);
  for (const x of need) if (!isNum(x) || x <= 0) return bad;
  return {
    mom126_5: Math.log(c[i - 5] / c[i - 126]),
    trend50_200: Math.log(smaAt(c, i, 50) / smaAt(c, i, 200)),
    mom252_21: Math.log(c[i - 21] / c[i - 252]),
  };
}
const featuresFinite = (f) => isNum(f.mom126_5) && isNum(f.trend50_200) && isNum(f.mom252_21);

/** Average ranks for ties, normalised to [0,1] by (rank-1)/(n-1). Non-finite inputs get NaN and are ignored by the ranking. n=1 -> 0.5. */
function rankNormalized(values) {
  const idx = [];
  for (let i = 0; i < values.length; i++) if (isNum(values[i])) idx.push(i);
  idx.sort((a, b) => values[a] - values[b] || a - b);
  const out = new Array(values.length).fill(NaN);
  const n = idx.length;
  let s = 0;
  while (s < n) {
    let e = s;
    while (e + 1 < n && values[idx[e + 1]] === values[idx[s]]) e++;
    const avg = (s + e) / 2 + 1; // average 1-based rank
    for (let k = s; k <= e; k++) out[idx[k]] = n === 1 ? 0.5 : (avg - 1) / (n - 1);
    s = e + 1;
  }
  return out;
}
const round12 = (x) => Math.round(x * 1e12) / 1e12;

/** Composite = mean cross-sectional normalised rank of the three features, over rows whose three features are all finite. */
function compositeScores(featRows) {
  const valid = featRows.map(featuresFinite);
  const pick = (key) => rankNormalized(featRows.map((f, i) => (valid[i] ? f[key] : NaN)));
  const r1 = pick('mom126_5'), r2 = pick('trend50_200'), r3 = pick('mom252_21');
  return featRows.map((_, i) => (valid[i] ? round12((r1[i] + r2[i] + r3[i]) / 3) : NaN));
}
/** Single-feature baseline score (mom126_5 rank). */
function singleScores(featRows) {
  return rankNormalized(featRows.map((f) => (f && isNum(f.mom126_5) ? f.mom126_5 : NaN))).map((x) => (isNum(x) ? round12(x) : NaN));
}

// ---------------------------------------------------------------- exclusion
/** floor(N*q) using integer percent arithmetic (avoids 0.3*40 float artefacts). */
function exclusionCount(N, q) { return Math.floor((N * Math.round(q * 100)) / 100); }

/** Lowest `nEx` finite scores are excluded; ties broken by id (lexical) — ex-ante, independent of returns. */
function selectExcluded(scores, ids, nEx) {
  const order = [];
  for (let i = 0; i < scores.length; i++) if (isNum(scores[i])) order.push(i);
  order.sort((a, b) => scores[a] - scores[b] || (ids[a] < ids[b] ? -1 : ids[a] > ids[b] ? 1 : 0));
  return {excluded: order.slice(0, nEx), survivors: order.slice(nEx)};
}

// ---------------------------------------------------------------- non-overlapping dates
/** Greedy from the first: pick idx, then the next idx >= last + h. Input: ascending session indices. */
function selectNonOverlapping(eligibleIdx, h) {
  if (!Number.isInteger(h) || h < 1) throw new Error('h must be a positive integer');
  const out = [];
  let next = -Infinity;
  for (const t of eligibleIdx) if (t >= next) { out.push(t); next = t + h; }
  return out;
}

// ---------------------------------------------------------------- liquidity
/** median over the last `win` rows (inclusive) of close*volume; NaN if fewer than `win` rows exist. */
function medianTradedValue(rows, i, win = 20) {
  if (i < win - 1) return NaN;
  const vals = [];
  for (let k = i - win + 1; k <= i; k++) vals.push(rows[k].c * rows[k].v);
  return median(vals);
}
/** threshold = frac * (market-wide median of the training observations). Uses ONLY the values passed in. */
function liquidityThreshold(trainingValues, frac) {
  const m = median(trainingValues);
  return isNum(m) ? frac * m : null;
}

// ---------------------------------------------------------------- identity guards
/**
 * Rejects a series when (reasons are all recorded):
 *  - it starts after a known listing date (expected start = first calendar session >= max(listingDate, calendar start); zero tolerance),
 *  - it has a gap of more than maxGap missing market sessions (including a trailing gap to the calendar end),
 *  - its currency differs from the market's, or currency/name history shows a jump (>1 distinct value).
 * `rows` = clean rows; `calIndex` = Map(date -> session idx); `cal` = sorted calendar.
 */
function checkIdentity(series, ctx) {
  const reasons = [];
  const {cal, calIndex, expectedCurrency, listingDate, maxGap = 20} = ctx;
  const rows = series.rows;
  let maxGapSeen = 0;
  if (!rows.length) return {ok: false, reasons: ['no_valid_rows'], maxGapSeen};
  const first = calIndex.get(rows[0].date);
  if (listingDate) {
    let exp = cal.findIndex((d) => d >= listingDate);
    if (exp < 0) exp = cal.length; // listed after the dev window: any data would be inconsistent
    if (first > exp) reasons.push(`starts_after_listing: first=${rows[0].date} expected_session=${cal[exp] || 'beyond_window'} listing=${listingDate}`);
    if (exp >= cal.length) reasons.push(`listing_after_window_end:${listingDate}`);
  }
  for (let k = 1; k < rows.length; k++) {
    const g = calIndex.get(rows[k].date) - calIndex.get(rows[k - 1].date) - 1;
    if (g > maxGapSeen) maxGapSeen = g;
    if (g > maxGap) reasons.push(`gap_${g}_sessions_before_${rows[k].date}`);
  }
  const tail = cal.length - 1 - calIndex.get(rows[rows.length - 1].date);
  if (tail > maxGapSeen) maxGapSeen = tail;
  if (tail > maxGap) reasons.push(`trailing_gap_${tail}_sessions`);
  if (expectedCurrency && series.currency !== expectedCurrency) reasons.push(`currency_${series.currency}_expected_${expectedCurrency}`);
  const distinct = (a) => new Set((a || []).filter((x) => x !== null && x !== undefined)).size;
  if (distinct(series.currencyHistory) > 1) reasons.push('currency_jump');
  if (distinct(series.nameHistory) > 1) reasons.push('name_jump');
  return {ok: reasons.length === 0, reasons, maxGapSeen};
}

// ---------------------------------------------------------------- per-date evaluation & costs
const mean01 = (a) => mean(a.map((x) => (x > 0 ? 1 : 0)));

/** fwd = simple forward returns aligned with ids/scores. Returns group means; excluded = lowest nEx scores. */
function evaluateDate(ids, scores, fwd, q) {
  const N = scores.filter(isNum).length;
  const nEx = exclusionCount(N, q);
  const sel = selectExcluded(scores, ids, nEx);
  const fe = sel.excluded.map((i) => fwd[i]), fs = sel.survivors.map((i) => fwd[i]);
  const all = sel.excluded.concat(sel.survivors).map((i) => fwd[i]);
  return {
    N, nEx, nSurv: fs.length,
    excluded: sel.excluded, survivors: sel.survivors,
    retAll: mean(all), retSurv: mean(fs), retExcl: mean(fe),
    hitAll: mean01(all), hitSurv: mean01(fs), hitExcl: mean01(fe),
  };
}
/** Weights after drifting an equal-weight book by simple returns `ret` (sum to 1). */
function driftWeights(syms, ret) {
  const g = ret.map((r) => 1 + (isNum(r) ? r : 0));
  const m = mean(g);
  const w = new Map();
  syms.forEach((s, i) => w.set(s, g[i] / m / syms.length));
  return w;
}
/** One-way turnover = fraction of the portfolio replaced = 0.5 * sum|w_new - w_old|. First date (no prior book) = 1. */
function turnoverOf(prevWeights, newSyms) {
  if (!prevWeights || prevWeights.size === 0) return 1;
  const wNew = 1 / newSyms.length;
  const seen = new Set(newSyms);
  let s = 0;
  for (const sym of newSyms) s += Math.abs(wNew - (prevWeights.get(sym) || 0));
  for (const [sym, w] of prevWeights) if (!seen.has(sym)) s += w;
  return 0.5 * s;
}
/** net excess = gross excess - turnover * c(bps)/1e4. */
const netExcess = (grossExcess, turnover, cBps) => grossExcess - turnover * (cBps / 1e4);

// ---------------------------------------------------------------- block bootstrap (circular blocks over dates)
const blockLength = (n) => Math.max(1, Math.ceil(Math.cbrt(n)));
function makeBootIndexSets(n, B, L, rng) {
  const out = new Int32Array(B * n);
  for (let b = 0; b < B; b++) {
    let k = 0;
    while (k < n) {
      const s = Math.floor(rng() * n);
      for (let j = 0; j < L && k < n; j++) out[b * n + k++] = (s + j) % n;
    }
  }
  return out;
}
function bootMeans(values, sets, B) {
  const n = values.length, out = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += values[sets[b * n + k]];
    out[b] = s / n;
  }
  return out;
}
function percentileCI(means, alpha = 0.05) {
  const s = Float64Array.from(means).sort();
  const B = s.length;
  return [s[Math.floor((B * alpha) / 2)], s[Math.ceil(B * (1 - alpha / 2)) - 1]];
}
/** One-sided bootstrap p for H0: mean <= 0 (null imposed by centring; (1+#)/(B+1)). */
function bootPOneSided(values, means) {
  const obs = mean(values);
  let c = 0;
  for (let b = 0; b < means.length; b++) if (means[b] - obs >= obs) c++;
  return (1 + c) / (means.length + 1);
}
/** Convenience: stats for one series using shared index sets. */
function bootSummary(values, sets, B) {
  const n = values.length;
  if (n < 5) return {n, mean: n ? mean(values) : NaN, ci95: [NaN, NaN], p_one_sided: NaN, p_two_sided: NaN};
  const means = bootMeans(values, sets, B);
  const p1 = bootPOneSided(values, means);
  return {n, mean: mean(values), ci95: percentileCI(means), p_one_sided: p1, p_two_sided: Math.min(1, 2 * p1)};
}

// ---------------------------------------------------------------- Holm
function holm(p) {
  const m = p.length;
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b] || a - b);
  const adj = new Array(m);
  let prev = 0;
  for (let k = 0; k < m; k++) {
    const v = Math.min(1, (m - k) * p[idx[k]]);
    prev = Math.max(prev, v);
    adj[idx[k]] = prev;
  }
  return adj;
}

// ---------------------------------------------------------------- random-exclusion permutation baseline
/**
 * Null: the excluded set is a uniformly random subset of the same size on each date (independent per date).
 * Statistic = mean over dates of (mean fwd of random survivors - mean fwd of all) — GROSS (see interpretation_notes).
 * fwdPerDate: array of arrays; nExPerDate: array of ints; obsStat: observed mean gross excess.
 */
function permutationBaseline(fwdPerDate, nExPerDate, obsStat, B, rng) {
  const D = fwdPerDate.length;
  const work = fwdPerDate.map((f) => Array.from({length: f.length}, (_, i) => i));
  const totals = fwdPerDate.map((f) => f.reduce((s, x) => s + x, 0));
  const stats = new Float64Array(B);
  let ge = 0;
  for (let b = 0; b < B; b++) {
    let acc = 0;
    for (let d = 0; d < D; d++) {
      const f = fwdPerDate[d], idx = work[d], N = f.length, nEx = nExPerDate[d];
      let sumEx = 0;
      for (let k = 0; k < nEx; k++) {
        const j = k + Math.floor(rng() * (N - k));
        const tmp = idx[k]; idx[k] = idx[j]; idx[j] = tmp;
        sumEx += f[idx[k]];
      }
      acc += (totals[d] - sumEx) / (N - nEx) - totals[d] / N;
    }
    stats[b] = acc / D;
    if (stats[b] >= obsStat - 1e-15) ge++;
  }
  return {p: (1 + ge) / (B + 1), null_mean: mean(Array.from(stats)), null_sd: sd(Array.from(stats)), B};
}

// ---------------------------------------------------------------- delisting sensitivity (bounds, not a correction)
/**
 * Adds M = phi*(h/252)*N hypothetical names, each returning dRet (-50%) over the window.
 * A fraction pex of them fall in the excluded group, (1-pex) in the survivors; observed names keep their groups.
 * Returns the adjusted GROSS excess (survivors - all). phi is a fraction per year (0.02 = 2%).
 */
function delistAdjustedExcess(d, phi, pex, h, dRet = -0.5, tdy = 252) {
  const M = phi * (h / tdy) * d.N;
  const wS = (1 - pex) * M;
  const S = (d.nSurv * d.retSurv + wS * dRet) / (d.nSurv + wS);
  const A = (d.N * d.retAll + M * dRet) / (d.N + M);
  return S - A;
}

// ---------------------------------------------------------------- decision
/**
 * criteria: c1 primary CI>0 after c=25; c2 >=70% positive folds; c3 survives (phi=2%,pex=0.3); c4 permutation p<0.05.
 * true/false/null(null = could not be evaluated). Never returns RESEARCH-VALIDATED.
 * SHADOW-VALIDATED additionally requires the holdout to have been opened (it never is in the development phase).
 */
function decide({criteria, nEff, powerMinN, holdoutOpened}) {
  const vals = Object.entries(criteria);
  const failed = vals.filter(([, v]) => v === false).map(([k]) => k);
  const unknown = vals.filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  if (failed.length) return {decision: 'REJECTED', reason: `failed:${failed.join(',')}`};
  if (unknown.length) return {decision: 'INCONCLUSIVE', reason: `not_evaluable:${unknown.join(',')}`};
  if (!(nEff >= powerMinN)) return {decision: 'INCONCLUSIVE', reason: `criteria_met_but_n_eff_${nEff}_below_power_minimum_${powerMinN}`};
  if (!holdoutOpened) return {decision: 'INCONCLUSIVE', reason: 'development_criteria_met_holdout_not_opened'};
  return {decision: 'SHADOW-VALIDATED', reason: 'all_criteria_met_with_sufficient_power_and_holdout_opened'};
}

module.exports = {
  isNum, mean, sd, median, fnv1a, mulberry32, seededRng,
  cleanSeries, devCount, devCutoffForCalendar, determineDevCutoff, cutRows,
  featuresAt, featuresFinite, rankNormalized, compositeScores, singleScores,
  exclusionCount, selectExcluded, selectNonOverlapping,
  medianTradedValue, liquidityThreshold, checkIdentity,
  evaluateDate, driftWeights, turnoverOf, netExcess,
  blockLength, makeBootIndexSets, bootMeans, percentileCI, bootPOneSided, bootSummary,
  holm, permutationBaseline, delistAdjustedExcess, decide,
};

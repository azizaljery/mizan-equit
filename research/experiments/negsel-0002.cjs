#!/usr/bin/env node
'use strict';
/**
 * NEGSEL-0002 — Development/Validation runner ONLY (PROTOCOL-NEGSEL-0002.md, frozen).
 *   usage: node research/experiments/negsel-0002.cjs <prices-dir> [out.json]
 *
 * HOLDOUT: the last 30% of dates is NOT implemented here. The cutoff is derived from the date calendar only, every row dated after
 * it is physically removed BEFORE any feature / universe / threshold / rank / return / statistic is computed (see applyDevCut +
 * assertNoHoldout). runHoldout() is a stub that throws.
 *
 * Deterministic: seeded PRNG, no Math.random, no Date.now in results. Status of this code: CODE-TESTED (tests are not predictive evidence).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./negsel-lib.cjs');

// ------------------------------------------------------------------ protocol constants (nothing here is tuned)
const SEED = 2026101502; // fixed; per-test streams are derived with fnv1a(SEED|key)
const MARKETS = ['sa', 'us'];
const QS = [0.2, 0.3, 0.5];
const HS = [5, 21, 63];
const COSTS_BPS = [0, 10, 25, 50];
const BASE_COST_BPS = 25;
const PRIMARY = {market: 'sa', h: 21, q: 0.3};
const B_DEFAULT = 2000; // bootstrap resamples AND permutation iterations
const MIN_HISTORY = 260; // sessions of clean history (protocol 4)
const LIQ_WINDOW = 20; // median traded value over 20 sessions (protocol 4)
const GAP_MAX = 20; // protocol 4 identity guard
const PHIS = [0, 0.01, 0.02, 0.04];
const PEXS = [0.3, 0.6];
const DELIST_RET = -0.5;
const TRADING_DAYS_PER_YEAR = 252;
// --- values the frozen protocol leaves open; fixed here BEFORE running, listed in interpretation_notes ---
const LIQ_FRAC = 0.25; // fraction of the market-wide training median traded value
const MIN_UNIVERSE = 20; // carried over from EXP-0003
const POWER_MIN_N = 60; // minimum non-overlapping dates for "sufficient power" (primary)
const FOLD_POSITIVE_MIN = 0.7; // protocol 8
const Z_POWER = 1.959964 + 0.841621; // two-sided alpha .05, power .80
const BREAK_EVEN_SCAN_MAX = 0.5; // reporting range only
const BREAK_EVEN_STEP = 0.0025;

const marketOf = (sym) => (/\.SR$/.test(sym) ? 'sa' : 'us');
const currencyOf = (m) => (m === 'sa' ? 'SAR' : 'USD');
const comboKey = (m, h, q) => `${m}|h${h}|q${q}`;
const rnd = (x, d = 5) => (L.isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const rndArr = (a, d = 5) => a.map((x) => rnd(x, d));

// ------------------------------------------------------------------ holdout stub
function runHoldout() {
  throw new Error('HOLDOUT NOT IMPLEMENTED: the holdout (last 30% of dates) may be opened once, only after owner review of the development results.');
}

// ------------------------------------------------------------------ development cut
function applyDevCut(series) {
  // dates only (no price field is read) -> calendars -> cutoff
  const calOf = (list) => {
    const s = new Set();
    for (const x of list) for (const r of x.rows || []) if (Array.isArray(r) && typeof r[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r[0])) s.add(r[0]);
    return Array.from(s).sort();
  };
  const calendars = [
    {name: 'sa', dates: calOf(series.filter((x) => marketOf(x.symbol) === 'sa'))},
    {name: 'us', dates: calOf(series.filter((x) => marketOf(x.symbol) === 'us'))},
    {name: 'union', dates: calOf(series)},
  ];
  const {cutoff, perCalendar} = L.determineDevCutoff(calendars);
  if (!cutoff) throw new Error('cannot determine dev cutoff');
  const cut = series.map((x) => ({
    symbol: x.symbol, currency: x.currency, tz: x.tz, splitsInRange: x.splitsInRange,
    currencyHistory: x.currencyHistory, nameHistory: x.nameHistory,
    rows: L.cutRows(x.rows, cutoff),
  }));
  return {cutoff, perCalendar, cut};
}
function assertNoHoldout(cut, cutoff) {
  for (const s of cut) for (const r of s.rows) if (!(r[0] <= cutoff)) throw new Error(`holdout row leaked into development data: ${s.symbol} ${r[0]} > ${cutoff}`);
}

// ------------------------------------------------------------------ market context (dev data only)
function buildMarket(mkt, seriesList, listingDates) {
  const cleaned = seriesList.map((s) => ({meta: s, ...L.cleanSeries(s.rows)}));
  const dset = new Set();
  for (const c of cleaned) for (const r of c.rows) dset.add(r.date);
  const cal = Array.from(dset).sort();
  const calIndex = new Map(cal.map((d, i) => [d, i]));
  const rejections = [], accepted = [], gapReport = [];
  for (const c of cleaned) {
    const sym = c.meta.symbol;
    const id = L.checkIdentity({rows: c.rows, currency: c.meta.currency, currencyHistory: c.meta.currencyHistory, nameHistory: c.meta.nameHistory},
      {cal, calIndex, expectedCurrency: currencyOf(mkt), listingDate: listingDates[sym] || null, maxGap: GAP_MAX});
    gapReport.push({symbol: sym, max_gap_sessions: id.maxGapSeen});
    if (!id.ok) { rejections.push({symbol: sym, reasons: id.reasons}); continue; }
    accepted.push(c);
  }
  accepted.sort((a, b) => (a.meta.symbol < b.meta.symbol ? -1 : 1));
  const syms = accepted.map((c) => {
    const rows = c.rows, n = rows.length, closes = rows.map((r) => r.c);
    const featOk = new Uint8Array(n), f1 = new Float64Array(n), f2 = new Float64Array(n), f3 = new Float64Array(n), med20 = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (i >= MIN_HISTORY - 1) {
        const f = L.featuresAt(closes, i);
        f1[i] = f.mom126_5; f2[i] = f.trend50_200; f3[i] = f.mom252_21;
        featOk[i] = L.featuresFinite(f) ? 1 : 0;
      }
      med20[i] = L.medianTradedValue(rows, i, LIQ_WINDOW);
    }
    const rowOfCal = new Int32Array(cal.length).fill(-1), closeAtCal = new Float64Array(cal.length).fill(NaN);
    for (let i = 0; i < n; i++) rowOfCal[calIndex.get(rows[i].date)] = i;
    let last = NaN;
    for (let t = 0; t < cal.length; t++) { if (rowOfCal[t] >= 0) last = rows[rowOfCal[t]].c; closeAtCal[t] = last; }
    return {symbol: c.meta.symbol, rows, featOk, f1, f2, f3, med20, rowOfCal, closeAtCal, cleanStats: c.stats};
  });
  return {mkt, cal, calIndex, syms, rejections, gapReport, cleanStats: cleaned.map((c) => ({symbol: c.meta.symbol, ...c.stats}))};
}

/** Liquidity threshold for the fold of calendar year Y: fraction * median of 20-session median traded values over rows dated before Y-01-01. */
function foldThreshold(ctx, year) {
  const lim = `${year}-01-01`, vals = [];
  for (const s of ctx.syms) for (let i = 0; i < s.rows.length; i++) {
    if (s.rows[i].date >= lim) break;
    if (L.isNum(s.med20[i])) vals.push(s.med20[i]);
  }
  return L.liquidityThreshold(vals, LIQ_FRAC);
}

function universeAt(ctx, t, h, thr) {
  const out = [];
  for (let si = 0; si < ctx.syms.length; si++) {
    const s = ctx.syms[si], r = s.rowOfCal[t];
    if (r < MIN_HISTORY - 1 || !s.featOk[r]) continue;
    if (!(s.med20[r] >= thr)) continue;
    if (!L.isNum(s.closeAtCal[t + h])) continue;
    out.push(si);
  }
  return out;
}

function selectDates(ctx, h, thrCache) {
  const last = ctx.cal.length - 1, elig = [], unis = new Map();
  for (let t = 0; t + h <= last; t++) {
    const year = Number(ctx.cal[t].slice(0, 4));
    if (!thrCache.has(year)) thrCache.set(year, foldThreshold(ctx, year));
    const thr = thrCache.get(year);
    if (thr === null) continue;
    const uni = universeAt(ctx, t, h, thr);
    if (uni.length >= MIN_UNIVERSE) { elig.push(t); unis.set(t, uni); }
  }
  const chosen = L.selectNonOverlapping(elig, h);
  return {
    nEligible: elig.length,
    recs: chosen.map((t) => {
      const uni = unis.get(t), date = ctx.cal[t];
      return {
        t, date, fold: Number(date.slice(0, 4)), uni,
        ids: uni.map((si) => ctx.syms[si].symbol),
        feats: uni.map((si) => { const s = ctx.syms[si], r = s.rowOfCal[t]; return {mom126_5: s.f1[r], trend50_200: s.f2[r], mom252_21: s.f3[r]}; }),
        fwd: uni.map((si) => ctx.syms[si].closeAtCal[t + h] / ctx.syms[si].closeAtCal[t] - 1),
      };
    }),
  };
}

function evalScheme(ctx, recs, scoreFn, q) {
  let prev = null;
  return recs.map((rec) => {
    const scores = scoreFn(rec.feats);
    const ev = L.evaluateDate(rec.ids, scores, rec.fwd, q);
    const names = ev.survivors.map((i) => rec.ids[i]);
    let prevW = null;
    if (prev) {
      const rets = prev.uniIdx.map((si) => ctx.syms[si].closeAtCal[rec.t] / ctx.syms[si].closeAtCal[prev.t] - 1);
      prevW = L.driftWeights(prev.names, rets);
    }
    const turnover = L.turnoverOf(prevW, names);
    prev = {t: rec.t, names, uniIdx: ev.survivors.map((i) => rec.uni[i])};
    return {
      date: rec.date, fold: rec.fold, N: ev.N, nEx: ev.nEx, nSurv: ev.nSurv,
      retAll: ev.retAll, retSurv: ev.retSurv, retExcl: ev.retExcl,
      hitAll: ev.hitAll, hitSurv: ev.hitSurv, hitExcl: ev.hitExcl,
      turnover, gross: ev.retSurv - ev.retAll,
    };
  });
}

// ------------------------------------------------------------------ per-combination analysis
const pct = (x) => 100 * x;
const bsOut = (b) => ({n: b.n, mean: rnd(b.mean), ci95: rndArr(b.ci95), p_one_sided: rnd(b.p_one_sided, 5), p_two_sided: rnd(b.p_two_sided, 5)});

function analyzeCombo(ctx, mkt, h, q, sel, B) {
  const key = comboKey(mkt, h, q);
  const recs = sel.recs, n = recs.length;
  const comp = evalScheme(ctx, recs, L.compositeScores, q);
  const single = evalScheme(ctx, recs, L.singleScores, q);
  const blk = L.blockLength(Math.max(n, 1));
  const sets = n >= 5 ? L.makeBootIndexSets(n, B, blk, L.seededRng(SEED, `${key}|boot`)) : null;
  const S = (vals) => (n >= 5 ? L.bootSummary(vals, sets, B) : {n, mean: n ? L.mean(vals) : NaN, ci95: [NaN, NaN], p_one_sided: NaN, p_two_sided: NaN});

  const gross = comp.map((d) => pct(d.gross));
  const netBy = {};
  for (const c of COSTS_BPS) netBy[c] = comp.map((d) => pct(L.netExcess(d.gross, d.turnover, c)));
  const hitLift = comp.map((d) => pct(d.hitSurv - d.hitAll));
  const exclMinusAll = comp.map((d) => pct(d.retExcl - d.retAll));
  const sGross = single.map((d) => pct(d.gross));
  const sNet25 = single.map((d) => pct(L.netExcess(d.gross, d.turnover, BASE_COST_BPS)));
  const diffNet25 = netBy[BASE_COST_BPS].map((x, i) => x - sNet25[i]);

  // folds
  const foldYears = Array.from(new Set(comp.map((d) => d.fold))).sort();
  const folds = foldYears.map((y) => {
    const ix = comp.map((d, i) => (d.fold === y ? i : -1)).filter((i) => i >= 0);
    const g = L.mean(ix.map((i) => gross[i])), nt = L.mean(ix.map((i) => netBy[BASE_COST_BPS][i]));
    return {fold: y, n_dates: ix.length, gross_excess_pct: rnd(g), net25_excess_pct: rnd(nt), hit_lift_pts: rnd(L.mean(ix.map((i) => hitLift[i]))), positive_net25: nt > 0};
  });
  const posShare = folds.length ? folds.filter((f) => f.positive_net25).length / folds.length : null;

  // permutation (gross, see interpretation_notes)
  let permutation = null;
  if (n >= 5) {
    const p = L.permutationBaseline(recs.map((r) => r.fwd), comp.map((d) => d.nEx), L.mean(comp.map((d) => d.gross)), B, L.seededRng(SEED, `${key}|perm`));
    permutation = {statistic: 'mean gross excess of survivors vs all (fraction)', observed: rnd(L.mean(comp.map((d) => d.gross)), 6), null_mean: rnd(p.null_mean, 6), null_sd: rnd(p.null_sd, 6), p_one_sided: rnd(p.p, 5), iterations: p.B};
  }

  // delisting sensitivity
  const delist = [];
  const adjSeries = (phi, pex) => comp.map((d) => pct(L.delistAdjustedExcess(d, phi, pex, h, DELIST_RET, TRADING_DAYS_PER_YEAR) - d.turnover * (BASE_COST_BPS / 1e4)));
  for (const pex of PEXS) for (const phi of PHIS) {
    const s = S(adjSeries(phi, pex));
    delist.push({phi_pct_per_year: pct(phi), p_ex: pex, net25_excess_pct: rnd(s.mean), ci95: rndArr(s.ci95)});
  }
  const breakEven = {};
  for (const pex of PEXS) {
    let found = null;
    for (let phi = 0; phi <= BREAK_EVEN_SCAN_MAX + 1e-12; phi += BREAK_EVEN_STEP) {
      if (!(L.mean(adjSeries(phi, pex)) > 0)) { found = rnd(pct(phi), 3); break; }
    }
    breakEven[`p_ex_${pex}`] = found; // null = effect still > 0 at the top of the scanned range
  }
  const adjPrimaryCell = S(adjSeries(0.02, 0.3));

  const netSummaries = {};
  for (const c of COSTS_BPS) netSummaries[`c${c}bps`] = bsOut(S(netBy[c]));
  const sdNet = L.sd(netBy[BASE_COST_BPS]);
  const before = comp.map((d) => d.N), after = comp.map((d) => d.nSurv);
  const out = {
    key, market: mkt, horizon: h, q, n_dates_eff: n, n_eligible_dates_before_spacing: sel.nEligible, block_length: blk,
    first_date: recs[0] ? recs[0].date : null, last_date: recs.length ? recs[recs.length - 1].date : null,
    candidates: {mean_before: rnd(L.mean(before), 2), min_before: Math.min(...before), max_before: Math.max(...before), mean_after: rnd(L.mean(after), 2), mean_excluded: rnd(L.mean(comp.map((d) => d.nEx)), 2)},
    composite: {
      gross_excess_pct: bsOut(S(gross)),
      net_excess_pct_by_cost: netSummaries,
      hit_rate_lift_pts: bsOut(S(hitLift)),
      excluded_minus_all_ret_pct: bsOut(S(exclMinusAll)),
      mean_one_way_turnover: rnd(L.mean(comp.map((d) => d.turnover)), 4),
    },
    folds, folds_positive_share: rnd(posShare, 4),
    permutation_random_exclusion: permutation,
    baselines: {
      universe_equal_weight: {mean_fwd_ret_pct: rnd(pct(L.mean(comp.map((d) => d.retAll)))), hit_rate_pct: rnd(pct(L.mean(comp.map((d) => d.hitAll)))), excess_vs_itself: 0},
      single_mom126_5: {gross_excess_pct: bsOut(S(sGross)), net25_excess_pct: bsOut(S(sNet25)), mean_one_way_turnover: rnd(L.mean(single.map((d) => d.turnover)), 4)},
      composite_minus_single_net25_pct: bsOut(S(diffNet25)),
    },
    delisting_sensitivity: {grid: delist, break_even_phi_pct_per_year: breakEven, scan_range_pct_per_year: [0, pct(BREAK_EVEN_SCAN_MAX)], note: 'null break-even = net25 excess still > 0 at the top of the scanned range'},
    power: {sd_net25_pct: rnd(sdNet), se_pct: rnd(sdNet / Math.sqrt(n)), mde80_pct: rnd((Z_POWER * sdNet) / Math.sqrt(n))},
  };
  return {out, internals: {comp, netBy, adjPrimaryCell, posShare, p2: S(netBy[BASE_COST_BPS]).p_two_sided, net25: S(netBy[BASE_COST_BPS]), permP: permutation ? permutation.p_one_sided : null, n}};
}

// ------------------------------------------------------------------ interpretation notes (declared before running)
const INTERPRETATION_NOTES = [
  {id: 'N01', topic: 'dev cutoff', note: 'Holdout = last ceil(30%) of dates, so dev = floor(70%) of the calendar. The cutoff is the EARLIEST of the SA, US and union calendar cutoffs. Rows after it are removed before any computation; forward returns therefore need t+h <= cutoff (natural purge).', note_ar: 'الـHoldout = آخر ⌈30%⌉ من التواريخ، فالتطوير = ⌊70%⌋ من التقويم. الـcutoff هو الأبكر بين cutoff التقويم السعودي والأمريكي والمدمج. تُحذف الصفوف اللاحقة له قبل أي حساب؛ فيلزم t+h ≤ cutoff (إقصاء طبيعي لأي تداخل مع الـHoldout).'},
  {id: 'N02', topic: 'liquidity fraction', note: `Protocol says "a fixed fraction of the market median" without the fraction. Fixed at ${LIQ_FRAC} (of the market-wide median of per-symbol 20-session median traded value close*volume, per market) before running; recomputed per fold from data dated before that fold's calendar year only (expanding window). It is the only quantity fitted from training data.`, note_ar: 'لم يحدد البروتوكول النسبة من «الوسيط العام للسوق». ثُبتت على 0.25 (من الوسيط العام لوسيط قيمة التداول إغلاق×حجم لـ20 جلسة لكل رمز، لكل سوق) قبل التشغيل، وتُعاد لكل طية من بيانات سابقة لسنة الطية فقط (نافذة توسعية). هي الكمية الوحيدة المقدَّرة من بيانات التدريب.'},
  {id: 'N03', topic: 'min universe', note: `A date needs >= ${MIN_UNIVERSE} eligible names (value inherited from EXP-0003; protocol silent).`, note_ar: 'الحد الأدنى 20 سهماً مؤهلاً للتاريخ (قيمة موروثة من EXP-0003؛ البروتوكول صامت).'},
  {id: 'N04', topic: 'folds', note: 'Folds = calendar years of the evaluation date t that contain >=1 selected date, including partial first/last years (no minimum size). There is nothing to fit per fold except the liquidity threshold, so folds only report stability. The share of positive folds is the share of folds with mean net(25bps) excess > 0.', note_ar: 'الطيّات = السنوات التقويمية لتاريخ التقييم t التي تحتوي تاريخاً واحداً على الأقل، بما فيها السنة الأولى والأخيرة الجزئيتان (دون حد أدنى للحجم). لا شيء يُقدَّر لكل طية سوى عتبة السيولة، فالطيّات تقيس الاستقرار فقط. حصة الطيّات الموجبة = نسبة الطيّات التي متوسط عائدها الزائد الصافي (25 نقطة أساس) > 0.'},
  {id: 'N05', topic: 'non-overlapping dates', note: 'Greedy from the first eligible session in the dev window: next date = first eligible session >= previous + h (market-calendar sessions). The same dates are used for every q and for the baselines. n_eff = number of these dates, pooled over folds.', note_ar: 'انتقاء جشع يبدأ من أول جلسة مؤهلة في نافذة التطوير: التاريخ التالي = أول جلسة مؤهلة ≥ السابق + h (بجلسات تقويم السوق). التواريخ نفسها لكل q ولخطوط الأساس. n الفعّال = عدد هذه التواريخ مجمّعة عبر الطيّات.'},
  {id: 'N06', topic: 'returns', note: 'Simple (not log) price returns, equal-weighted; Yahoo close without dividend adjustment (adjclose not in the files). Missing close at t+h = last close at or before t+h. Hit = forward return > 0.', note_ar: 'عوائد بسيطة (لا لوغاريتمية) سعرية بأوزان متساوية؛ إغلاق Yahoo دون تعديل التوزيعات (adjclose غير موجود في الملفات). الإغلاق الغائب عند t+h يُستبدل بآخر إغلاق عنده أو قبله. الإصابة = عائد أمامي > 0.'},
  {id: 'N07', topic: 'turnover and costs', note: 'Turnover = fraction of the portfolio replaced = 0.5*sum|w_new - w_old drifted|, first rebalance = 1. Cost = turnover * c/1e4 subtracted from the survivors only; the full-universe benchmark is charged nothing (literal reading of protocol 4; conservative for H1). c is per full round trip.', note_ar: 'الدوران = نسبة المحفظة المستبدلة = 0.5×Σ|w_new − w_old بعد الانجراف|، وأول إعادة توازن = 1. التكلفة = الدوران × c/10000 تُخصم من الناجين فقط، ولا يُحمَّل الكون الكامل أي تكلفة (قراءة حرفية للبند 4؛ محافِظة تجاه H1). c للرحلة الكاملة.'},
  {id: 'N08', topic: 'exclusion count & ties', note: 'nEx = floor(N*q). Composite ties (average ranks) at the cut are broken by symbol string order, which is unrelated to returns.', note_ar: 'عدد المستبعَدين = ⌊N×q⌋. تعادل المركّب عند الحد (رتب متوسطة) يُكسر بترتيب نص الرمز، ولا علاقة له بالعوائد.'},
  {id: 'N09', topic: 'bootstrap', note: 'Circular moving-block bootstrap over the non-overlapping dates, block length ceil(n^(1/3)), 2000 resamples, fixed seed per combination, percentile 95% CI. Protocol did not give a block length. Secondary p-values: one-sided centred-bootstrap p for mean net(25) excess > 0, doubled (two-sided) and capped at 1 to be consistent with the two-sided 95% CI used for the primary.', note_ar: 'Bootstrap بكتل دائرية متحركة على التواريخ غير المتداخلة، طول الكتلة ⌈n^(1/3)⌉ (لم يحدده البروتوكول)، 2000 إعادة، بذرة ثابتة لكل تركيبة، فترة ثقة بالمئينات. قيمة p الثانوية: p أحادي من Bootstrap مركَّز لفرضية «متوسط العائد الزائد الصافي (25) > 0»، تُضاعف (ثنائية) وتُحدّ بـ1 لتتسق مع فترة الثقة الثنائية 95% للأساسي.'},
  {id: 'N10', topic: 'permutation', note: 'Random-exclusion null: independent uniform random subset of the same size on each date, 2000 iterations. Compared on GROSS excess (before costs) because random subsets would be charged far higher turnover; comparing net would favour the composite for persistence alone. One-sided p = (1+#{null >= observed})/(B+1).', note_ar: 'فرضية الصفر: مجموعة مستبعَدة عشوائية منتظمة بالحجم نفسه في كل تاريخ، مستقلة بين التواريخ، 2000 تكرار. المقارنة على العائد الزائد الإجمالي (قبل التكاليف) لأن المجموعات العشوائية تتحمل دوراناً أعلى بكثير، والمقارنة الصافية كانت ستفضّل المركّب لمجرد ثباته. p أحادي = (1+#{null ≥ observed})/(B+1).'},
  {id: 'N11', topic: 'Holm', note: 'Family = the 17 non-primary (market x h x q) combinations, p = two-sided bootstrap p of net(25) excess; a secondary success needs Holm-adjusted p < 0.05 and a positive mean.', note_ar: 'عائلة Holm = التركيبات الـ17 غير الأساسية (سوق × h × q)، p = p ثنائي بالـBootstrap للعائد الزائد الصافي (25). النجاح الثانوي يتطلب p بعد Holm < 0.05 ومتوسطاً موجباً.'},
  {id: 'N12', topic: 'delisting model', note: 'Expected-value approximation: per window M = phi*(h/252)*N hypothetical names each returning -50%; fraction p_ex of them fall in the excluded group, (1-p_ex) among survivors; observed names keep their groups; costs unchanged. p_ex is applied literally (0.3, 0.6) for every q, so "0.3 = random" holds only at q=0.3. When p_ex > exclusion share the adjustment RAISES the excess (the rule would have excluded the delisters); when p_ex < share it lowers it. Criterion "effect survives at (phi=2%, p_ex=0.3)" is read strictly: lower bound of the 95% CI of the adjusted net(25) excess > 0. Break-even is a grid scan (0.25% steps up to 50%/yr) of the mean adjusted net(25) excess; null = never reached.', note_ar: 'تقريب بالقيمة المتوقعة: لكل نافذة M = φ×(h/252)×N ورقة افتراضية بعائد −50%؛ نسبة p_ex منها بين المستبعَدين و(1−p_ex) بين الناجين؛ الأوراق المرصودة تحتفظ بمجموعاتها؛ التكاليف دون تغيير. تُطبَّق p_ex حرفياً (0.3، 0.6) لكل q، فعبارة «0.3 = عشوائي» صحيحة عند q=0.3 فقط. حين تكون p_ex أكبر من حصة الاستبعاد يرفع التعديل العائد الزائد (القاعدة كانت ستستبعد المشطوبات)، وحين تكون أصغر يخفضه. معيار «بقاء الأثر عند (φ=2%، p_ex=0.3)» يُقرأ صارماً: الحد الأدنى لفترة الثقة 95% للعائد الزائد الصافي (25) المعدَّل > 0. نقطة التعادل = بحث على شبكة (خطوة 0.25% حتى 50% سنوياً) على المتوسط المعدَّل؛ null = لم تُبلَغ.'},
  {id: 'N13', topic: 'identity guards', note: 'Implemented: start-after-listing (zero tolerance, expected start = first session >= max(listing date, calendar start)), gap > 20 missing market sessions (also trailing), currency != market currency or currency/name history with >1 value. No listing-date registry and no name field exist offline, so the listing and name guards are inactive on the real run (listing_registry_size = 0). They are CODE-TESTED on synthetic data only.', note_ar: 'المنفَّذ: البدء بعد الإدراج (تسامح صفر؛ البدء المتوقع = أول جلسة ≥ max(تاريخ الإدراج، بداية التقويم))، وفجوة > 20 جلسة سوق مفقودة (وكذلك الفجوة الأخيرة)، وعملة تخالف عملة السوق أو سجل عملة/اسم بأكثر من قيمة. لا يوجد دون اتصال سجل تواريخ إدراج ولا حقل اسم، لذا حارسا الإدراج والاسم غير فعّالين في التشغيل الحقيقي (listing_registry_size = 0)، ومُختبَران على بيانات اصطناعية فقط (CODE-TESTED).'},
  {id: 'N14', topic: 'power rule', note: `Protocol refers to a "declared power limit" without a number. Declared before running: sufficient power requires n_eff >= ${POWER_MIN_N} non-overlapping dates for the primary (about five years of monthly observations; EXP-0003 had 33, which the protocol calls insufficient). The detectable-effect figure (80% power, alpha .05) is reported for transparency but is not used in the decision.`, note_ar: 'يشير البروتوكول إلى «حد معلن للقوة» دون رقم. أُعلن قبل التشغيل: القوة الكافية تتطلب n الفعّال ≥ 60 تاريخاً غير متداخل للاختبار الأساسي (نحو خمس سنوات من الملاحظات الشهرية؛ EXP-0003 كان 33 ويعدّه البروتوكول غير كافٍ). أصغر أثر قابل للكشف (قوة 80%، α=0.05) يُعرض للإفصاح ولا يدخل القرار.'},
  {id: 'N15', topic: 'decision gate', note: 'Decision table applied in protocol order: any failed criterion -> REJECTED; else n_eff below the power minimum -> INCONCLUSIVE; else SHADOW-VALIDATED only if the holdout was opened, which this phase never does, so a full development pass is reported as INCONCLUSIVE (development criteria met, holdout pending). RESEARCH-VALIDATED is impossible.', note_ar: 'جدول القرار بترتيب البروتوكول: أي معيار فاشل → REJECTED؛ وإلا فإن n أقل من حد القوة → INCONCLUSIVE؛ وإلا SHADOW-VALIDATED شرط أن يكون الـHoldout قد فُتح، وهذه المرحلة لا تفتحه، فنجاح كل معايير التطوير يُبلَّغ INCONCLUSIVE (معايير التطوير تحققت والـHoldout معلّق). RESEARCH-VALIDATED غير ممكن.'},
  {id: 'N16', topic: 'calendar & suspended days', note: 'Market calendar = union of dates of the market in the dev window. Saudi rows with zero volume (flat prices) are kept as rows. Rows with an invalid date or non-finite / non-positive close are dropped (counted in data.markets.*.clean_stats_nonzero) and show up as gaps; non-finite volume is treated as 0.', note_ar: 'تقويم السوق = اتحاد تواريخ رموز السوق في نافذة التطوير. صفوف السعودي ذات الحجم صفر (أسعار ثابتة) تبقى صفوفاً. تُحذف الصفوف ذات التاريخ غير الصالح أو الإغلاق غير المنتهي/غير الموجب (تُحصى في data.markets.*.clean_stats_nonzero) وتظهر كفجوات؛ والحجم غير المنتهي يُعامل صفراً.'},
];

const KNOWN_LIMITATIONS = [
  'Survivorship: the universe is today\'s large caps; delisted names are absent (Yahoo no longer serves them). The delisting grid is a bound, not a correction.',
  'The development window overlaps the period already examined in EXP-0003 (same composite and q levels were looked at there), so development results are not independent of that exploration; the holdout region was also seen in EXP-0003 (aggregate statistics only).',
  'Single regime (2020-2024 development window), 40 names per market, price-only, no dividends.',
  'Universe = liquidity at t, not index membership.',
];

const KNOWN_LIMITATIONS_AR = [
  'تحيز البقاء: الكون = كبرى الشركات الحالية؛ المشطوبات غائبة (Yahoo لم يعد يوفرها). شبكة الشطب حدّ لا تصحيح.',
  'نافذة التطوير تتقاطع مع الفترة التي فُحصت في EXP-0003 (المركّب ومستويات q نفسها)، فنتائج التطوير ليست مستقلة عن ذلك الاستكشاف؛ ومنطقة الـHoldout رُئيت أيضاً في EXP-0003 (إحصاءات مجمّعة).',
  'نظام سوق واحد (نافذة التطوير 2020–2024)، 40 سهماً لكل سوق، بيانات سعرية فقط، بلا توزيعات.',
  'الكون = سيولة عند t لا عضوية مؤشر.',
];

// ------------------------------------------------------------------ main entry (development phase only)
function runDev(inputSeries, opts = {}) {
  const B = opts.B || B_DEFAULT;
  const listingDates = opts.listingDates || {};
  const input = inputSeries.slice().sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));

  // 1) cut FIRST — nothing below sees a row after the cutoff
  const {cutoff, perCalendar, cut} = applyDevCut(input);
  assertNoHoldout(cut, cutoff);

  // 2) market contexts
  const ctxs = {};
  for (const m of MARKETS) ctxs[m] = buildMarket(m, cut.filter((x) => marketOf(x.symbol) === m), listingDates);

  // 3) combos
  const combos = [], internals = {};
  const datesInfo = {}, universeShare = {};
  for (const m of MARKETS) {
    const thrCache = new Map();
    for (const h of HS) {
      const sel = selectDates(ctxs[m], h, thrCache);
      if (h === 21) universeShare[m] = Object.fromEntries(ctxs[m].syms.map((sy, si) => [sy.symbol, sel.recs.length ? rnd(sel.recs.filter((r) => r.uni.includes(si)).length / sel.recs.length, 3) : null]));
      datesInfo[`${m}|h${h}`] = {n_eligible_before_spacing: sel.nEligible, n_nonoverlapping: sel.recs.length, first: sel.recs[0] ? sel.recs[0].date : null, last: sel.recs.length ? sel.recs[sel.recs.length - 1].date : null};
      for (const q of QS) {
        const r = analyzeCombo(ctxs[m], m, h, q, sel, B);
        combos.push(r.out);
        internals[r.out.key] = r.internals;
      }
    }
  }

  // 4) primary + secondary (Holm)
  const pKey = comboKey(PRIMARY.market, PRIMARY.h, PRIMARY.q);
  const P = combos.find((c) => c.key === pKey), PI = internals[pKey];
  const secondary = combos.filter((c) => c.key !== pKey);
  const pvals = secondary.map((c) => { const p = internals[c.key].p2; return L.isNum(p) ? p : 1; });
  const adj = L.holm(pvals);
  const secondaryTests = secondary.map((c, i) => ({
    key: c.key, market: c.market, horizon: c.horizon, q: c.q, n_dates_eff: c.n_dates_eff,
    net25_excess_pct: c.composite.net_excess_pct_by_cost.c25bps.mean, ci95: c.composite.net_excess_pct_by_cost.c25bps.ci95,
    p_two_sided_bootstrap: rnd(pvals[i], 5), p_holm: rnd(adj[i], 5),
    significant_after_holm: adj[i] < 0.05 && c.composite.net_excess_pct_by_cost.c25bps.mean > 0,
    permutation_p_one_sided: c.permutation_random_exclusion ? c.permutation_random_exclusion.p_one_sided : null,
  }));

  const primNet = PI.net25;
  const criteria = {
    primary_ci_lower_gt_0_net25: PI.n >= 5 ? primNet.ci95[0] > 0 : null,
    positive_in_ge_70pct_of_folds: PI.posShare === null ? null : PI.posShare >= FOLD_POSITIVE_MIN,
    survives_delisting_phi2_pex0_3: PI.n >= 5 ? PI.adjPrimaryCell.ci95[0] > 0 : null,
    permutation_p_lt_0_05: PI.permP === null ? null : PI.permP < 0.05,
  };
  const dec = L.decide({criteria, nEff: PI.n, powerMinN: POWER_MIN_N, holdoutOpened: false});

  const perMarket = {};
  for (const m of MARKETS) {
    const c = ctxs[m];
    perMarket[m] = {
      n_symbols_input: input.filter((x) => marketOf(x.symbol) === m).length,
      n_symbols_accepted: c.syms.length,
      n_dev_calendar_dates: c.cal.length, first_date: c.cal[0], last_date: c.cal[c.cal.length - 1],
      rejected: c.rejections, max_gap_sessions_overall: Math.max(...c.gapReport.map((g) => g.max_gap_sessions)),
      symbols_with_any_gap: c.gapReport.filter((g) => g.max_gap_sessions > 0).map((g) => ({symbol: g.symbol, max_gap_sessions: g.max_gap_sessions})),
      clean_stats_nonzero: c.cleanStats.filter((s) => s.badDate || s.badClose || s.badVolumeSetToZero || s.duplicateDates || s.wasUnsorted),
      liquidity_thresholds_by_fold: Object.fromEntries(Array.from(new Set(combos.filter((x) => x.market === m).flatMap((x) => x.folds.map((f) => f.fold)))).sort().map((y) => [y, rnd(foldThreshold(c, y), 0)])),
      nonoverlapping_dates: Object.fromEntries(HS.map((h) => [`h${h}`, datesInfo[`${m}|h${h}`]])),
      large_daily_moves_over_25pct: c.syms.flatMap((sy) => sy.rows.map((r, i) => [r, i]).filter(([r, i]) => i > 0 && Math.abs(r.c / sy.rows[i - 1].c - 1) > 0.25).map(([r, i]) => ({symbol: sy.symbol, date: r.date, ret_pct: rnd(100 * (r.c / sy.rows[i - 1].c - 1), 2)}))), // diagnostics only; nothing is cleaned or removed
      universe_membership_share_h21: universeShare[m], // diagnostics only: share of the selected h=21 dates on which each symbol was in the universe
    };
  }

  return {
    experiment: 'NEGSEL-0002', phase: 'development_validation_only', holdout_opened: false,
    code_status: 'CODE-TESTED (unit tests are not predictive evidence)',
    protocol: {file: 'research/PROTOCOL-NEGSEL-0002.md', sha256: opts.protocolSha256 || null, commit: opts.protocolCommit || null, version: 'frozen pre-registration 2026-10-15'},
    seed: SEED, bootstrap_resamples: B, permutation_iterations: B,
    dev_cutoff: {date: cutoff, rule: 'dev = n - ceil(0.3 n) dates; earliest of SA / US / union calendar cutoffs', per_calendar: perCalendar},
    data: {n_symbols_input: input.length, listing_registry_size: Object.keys(listingDates).length, markets: perMarket},
    parameters: {q: QS, h: HS, costs_bps: COSTS_BPS, base_cost_bps: BASE_COST_BPS, primary: PRIMARY, phi: PHIS, p_ex: PEXS, delist_return: DELIST_RET, liq_fraction: LIQ_FRAC, min_universe: MIN_UNIVERSE, min_history_sessions: MIN_HISTORY, power_min_n_eff: POWER_MIN_N, folds_positive_min: FOLD_POSITIVE_MIN},
    primary_test: {
      key: pKey, n_dates_eff: P.n_dates_eff, net25_excess_pct: P.composite.net_excess_pct_by_cost.c25bps,
      gross_excess_pct: P.composite.gross_excess_pct, candidates: P.candidates, folds: P.folds, folds_positive_share: P.folds_positive_share,
      permutation: P.permutation_random_exclusion, delisting_phi2_pex0_3: {net25_excess_pct: rnd(PI.adjPrimaryCell.mean), ci95: rndArr(PI.adjPrimaryCell.ci95)},
      power: P.power, criteria, per_date: PI.comp.map((d, i) => ({date: d.date, N: d.N, n_surv: d.nSurv, gross_pct: rnd(100 * d.gross), net25_pct: rnd(PI.netBy[25][i]), turnover: rnd(d.turnover, 4)})),
    },
    secondary_tests: secondaryTests,
    results: combos,
    decision: {decision: dec.decision, reason: dec.reason, criteria, n_eff: PI.n, power_min_n_eff: POWER_MIN_N, max_possible_status: 'SHADOW-VALIDATED', note: 'development phase; RESEARCH-VALIDATED is impossible with a survivor-limited universe'},
    interpretation_notes: INTERPRETATION_NOTES,
    known_limitations: KNOWN_LIMITATIONS,
    known_limitations_ar: KNOWN_LIMITATIONS_AR,
  };
}

module.exports = {runDev, runHoldout, applyDevCut, assertNoHoldout, buildMarket, foldThreshold, selectDates, SEED, CONSTANTS: {QS, HS, COSTS_BPS, PHIS, PEXS, LIQ_FRAC, MIN_UNIVERSE, POWER_MIN_N, B_DEFAULT}};

// ------------------------------------------------------------------ CLI
if (require.main === module) {
  const [, , dir, outArg] = process.argv;
  if (!dir) { console.error('usage: node negsel-0002.cjs <prices-dir> [out.json]'); process.exit(2); }
  const series = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const protoPath = path.join(__dirname, '..', 'PROTOCOL-NEGSEL-0002.md');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(protoPath)).digest('hex');
  let commit = null;
  try { commit = require('child_process').execSync('git log -1 --format=%H -- research/PROTOCOL-NEGSEL-0002.md', {cwd: path.join(__dirname, '..', '..'), stdio: ['ignore', 'pipe', 'ignore']}).toString().trim() || null; } catch (e) { commit = null; }
  const res = runDev(series, {protocolSha256: sha, protocolCommit: commit});
  const out = outArg || path.join(__dirname, '..', 'results', 'NEGSEL-0002-dev.json');
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
  console.log(JSON.stringify({out, holdout_opened: res.holdout_opened, dev_cutoff: res.dev_cutoff.date, decision: res.decision}, null, 1));
}

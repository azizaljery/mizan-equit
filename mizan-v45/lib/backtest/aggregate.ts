/** Aggregate immutable backtest reports without merging currencies or claiming independence. */
import type { BacktestRunResult, HorizonResult } from './types';

export type Distribution = { count: number; min: number | null; median: number | null; max: number | null; mean: number | null };
export type CurrencyAggregate = { pointCount: number; mae: Distribution; weightedMae: number | null };
export type AggregatedHorizon = {
  horizon: number; runsContributing: number; totalSamples: number; totalCompleted: number; totalExcluded: number; totalPending: number;
  directionCount: number; directionAccuracy: Distribution;
  rangeCount: number; rangeHitRate: Distribution;
  pointCount: number; maeByCurrency: Record<string, CurrencyAggregate>; meanRelativeErrorPct: Distribution;
  returnCount: number; meanReturn: Distribution; stdReturn: Distribution; sharpe: Distribution;
  benchmarkCount: number; benchmarkSharpe: Distribution; alpha: Distribution;
};
export type AggregateResult = {
  runsScanned: number; runsUsed: number; duplicatesSkipped: number;
  duplicateReasons: Record<'same-run-id' | 'same-signature', number>;
  byHorizon: AggregatedHorizon[]; bestHorizon: number | null; worstHorizon: number | null; notes: string[];
};
export type BacktestSummary = { byHorizon: HorizonResult[] };
export type SummarizeFn = (run: BacktestRunResult) => BacktestSummary;
export type AggregateOptions = { summarizeFn: SummarizeFn };

const finite = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value);
function mean(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function distribution(values: number[]): Distribution {
  return values.length
    ? { count: values.length, min: Math.min(...values), median: median(values), max: Math.max(...values), mean: mean(values) }
    : { count: 0, min: null, median: null, max: null, mean: null };
}
function newer(a: BacktestRunResult, b: BacktestRunResult) {
  const left = Date.parse(a.completedAt), right = Date.parse(b.completedAt);
  return Number.isFinite(left) && (!Number.isFinite(right) || left > right) ? a : b;
}
function signature(run: BacktestRunResult) {
  const symbols = [...run.config.symbols].sort().join('|');
  const horizons = [...run.config.horizons].sort((a, b) => a - b).join(',');
  const c = run.config.costs;
  return JSON.stringify({
    startDate: run.config.startDate, endDate: run.config.endDate, symbols, horizons,
    commissionBps: c.commissionBps, slippageBps: c.slippageBps, doubleSided: c.doubleSided,
    minSessions: run.config.minSessions, model: run.config.model ?? null,
  });
}

type CurrencyAccumulator = { pointCount: number; maes: number[]; weightedError: number };
type HorizonAccumulator = {
  runsContributing: number; totalSamples: number; totalCompleted: number; totalExcluded: number; totalPending: number;
  directionCount: number; directions: number[]; rangeCount: number; ranges: number[];
  pointCount: number; currencies: Map<string, CurrencyAccumulator>; relativeErrors: number[];
  returnCount: number; returns: number[]; standardDeviations: number[]; sharpes: number[];
  benchmarkCount: number; benchmarkSharpes: number[]; alphas: number[];
};
function emptyAccumulator(): HorizonAccumulator {
  return {
    runsContributing: 0, totalSamples: 0, totalCompleted: 0, totalExcluded: 0, totalPending: 0,
    directionCount: 0, directions: [], rangeCount: 0, ranges: [], pointCount: 0,
    currencies: new Map<string, CurrencyAccumulator>(), relativeErrors: [], returnCount: 0,
    returns: [], standardDeviations: [], sharpes: [], benchmarkCount: 0, benchmarkSharpes: [], alphas: [],
  };
}

export function aggregateBacktests(runs: BacktestRunResult[], options: AggregateOptions): AggregateResult {
  if (!options || typeof options.summarizeFn !== 'function') throw new Error('summarizeFn is required');
  const reasons = { 'same-run-id': 0, 'same-signature': 0 };
  const byId = new Map<string, BacktestRunResult>();
  for (const run of runs) {
    const previous = byId.get(run.runId);
    if (!previous) byId.set(run.runId, run);
    else { reasons['same-run-id']++; byId.set(run.runId, newer(run, previous)); }
  }
  const bySignature = new Map<string, BacktestRunResult>();
  for (const run of byId.values()) {
    const key = signature(run), previous = bySignature.get(key);
    if (!previous) bySignature.set(key, run);
    else { reasons['same-signature']++; bySignature.set(key, newer(run, previous)); }
  }
  const unique = [...bySignature.values()], accumulators = new Map<number, HorizonAccumulator>();
  for (const run of unique) {
    let summary: BacktestSummary;
    try { summary = options.summarizeFn(run); }
    catch { throw new Error('summarizeFn must accept BacktestRunResult and return {byHorizon:HorizonResult[]}'); }
    if (!summary || !Array.isArray(summary.byHorizon)) throw new Error('summarizeFn must return {byHorizon:HorizonResult[]}');
    for (const horizon of summary.byHorizon) {
      const current = accumulators.get(horizon.horizon) ?? emptyAccumulator();
      current.runsContributing++;
      current.totalSamples += horizon.total; current.totalCompleted += horizon.completed;
      current.totalExcluded += horizon.excluded; current.totalPending += horizon.pending;
      current.directionCount += horizon.directionCount; current.rangeCount += horizon.rangeCount;
      current.pointCount += horizon.pointCount; current.returnCount += horizon.returnCount;
      current.benchmarkCount += horizon.benchmarkCount;
      if (finite(horizon.directionAccuracy)) current.directions.push(horizon.directionAccuracy);
      if (finite(horizon.rangeHitRate)) current.ranges.push(horizon.rangeHitRate);
      if (finite(horizon.meanRelativeErrorPct)) current.relativeErrors.push(horizon.meanRelativeErrorPct);
      if (finite(horizon.meanReturn)) current.returns.push(horizon.meanReturn);
      if (finite(horizon.stdReturn)) current.standardDeviations.push(horizon.stdReturn);
      if (finite(horizon.sharpe)) current.sharpes.push(horizon.sharpe);
      if (finite(horizon.benchmarkSharpe)) current.benchmarkSharpes.push(horizon.benchmarkSharpe);
      if (finite(horizon.alpha)) current.alphas.push(horizon.alpha);
      for (const [currency, metric] of Object.entries(horizon.maeByCurrency)) {
        if (!Number.isInteger(metric.count) || metric.count < 0 || !Number.isFinite(metric.mae)) continue;
        const value = current.currencies.get(currency) ?? { pointCount: 0, maes: [], weightedError: 0 };
        value.pointCount += metric.count; value.maes.push(metric.mae); value.weightedError += metric.mae * metric.count;
        current.currencies.set(currency, value);
      }
      accumulators.set(horizon.horizon, current);
    }
  }
  const byHorizon: AggregatedHorizon[] = [...accumulators.entries()].map(([horizon, value]) => ({
    horizon, runsContributing: value.runsContributing, totalSamples: value.totalSamples,
    totalCompleted: value.totalCompleted, totalExcluded: value.totalExcluded, totalPending: value.totalPending,
    directionCount: value.directionCount, directionAccuracy: distribution(value.directions),
    rangeCount: value.rangeCount, rangeHitRate: distribution(value.ranges), pointCount: value.pointCount,
    maeByCurrency: Object.fromEntries([...value.currencies.entries()].map(([currency, metric]) => [currency, {
      pointCount: metric.pointCount, mae: distribution(metric.maes),
      weightedMae: metric.pointCount ? metric.weightedError / metric.pointCount : null,
    }])),
    meanRelativeErrorPct: distribution(value.relativeErrors), returnCount: value.returnCount,
    meanReturn: distribution(value.returns), stdReturn: distribution(value.standardDeviations),
    sharpe: distribution(value.sharpes), benchmarkCount: value.benchmarkCount,
    benchmarkSharpe: distribution(value.benchmarkSharpes), alpha: distribution(value.alphas),
  })).sort((a, b) => a.horizon - b.horizon);
  const ranked = byHorizon.filter(row => row.directionAccuracy.median !== null);
  const bestHorizon = ranked.length ? ranked.reduce((best, row) => (row.directionAccuracy.median! > best.directionAccuracy.median! ? row : best)).horizon : null;
  const worstHorizon = ranked.length ? ranked.reduce((worst, row) => (row.directionAccuracy.median! < worst.directionAccuracy.median! ? row : worst)).horizon : null;
  const notes = [
    'المقامات محفوظة لكل قياس؛ لا تفترض توزيعات المقاييس المقامة على عينات مختلفة المقام نفسه.',
    'MAE مفصول بحسب العملة، ويعرض عدد عينات السعر والتوزيع والمتوسط الموزون داخل العملة فقط.',
    'Sharpe وAlpha وبقية قياسات الدورات معروضة كتوزيعات؛ ليست محفظة موحدة.',
    'تطابق إعدادات الدورات يزيل نسخة إعداد مكررة فقط؛ لا يثبت استقلال المشاهدات أو إزالة تداخلها.',
  ];
  if (reasons['same-run-id'] || reasons['same-signature']) notes.unshift('استُبعدت دورات مكررة مع احتساب سبب الاستبعاد.');
  return { runsScanned: runs.length, runsUsed: unique.length, duplicatesSkipped: runs.length - unique.length, duplicateReasons: reasons, byHorizon, bestHorizon, worstHorizon, notes };
}

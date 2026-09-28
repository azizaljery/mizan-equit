/** Machine-readable exports for one immutable backtest run. */
import { csvLine, csvText } from '../export-data';
import type { BacktestRunResult } from './types';

type Cell = string | number | boolean | null | undefined;
export type ExportSection = { name: string; header: string[]; rows: Cell[][] };

function runInfo(run: BacktestRunResult): ExportSection {
  return { name: 'run_info', header: ['field', 'value'], rows: [
    ['run_id', run.runId], ['started_at', run.startedAt], ['completed_at', run.completedAt],
    ['window_start', run.config.startDate], ['window_end', run.config.endDate],
    ['model', run.config.model ?? null], ['min_sessions', run.config.minSessions],
    ['symbols_succeeded', run.symbolsSucceeded], ['symbols_failed', run.symbolsFailed.length],
    ['horizons', run.config.horizons.join('|')], ['costs_commission_bps', run.config.costs.commissionBps],
    ['costs_slippage_bps', run.config.costs.slippageBps], ['costs_double_sided', run.config.costs.doubleSided],
  ] };
}
function horizons(run: BacktestRunResult): ExportSection {
  return { name: 'horizons', header: [
    'run_id','horizon','total','completed','excluded','pending','direction_count','direction_accuracy',
    'range_count','range_hit_rate','point_count','mean_relative_error_pct','return_count','mean_return',
    'std_return','sharpe','benchmark_count','benchmark_sharpe','alpha',
  ], rows: run.byHorizon.map(h => [
    run.runId,h.horizon,h.total,h.completed,h.excluded,h.pending,h.directionCount,h.directionAccuracy,
    h.rangeCount,h.rangeHitRate,h.pointCount,h.meanRelativeErrorPct,h.returnCount,h.meanReturn,
    h.stdReturn,h.sharpe,h.benchmarkCount,h.benchmarkSharpe,h.alpha,
  ]) };
}
function currencies(run: BacktestRunResult): ExportSection | null {
  const rows: Cell[][] = [];
  for (const h of run.byHorizon) for (const [currency, metric] of Object.entries(h.maeByCurrency)) {
    rows.push([run.runId, h.horizon, currency, metric.count, metric.mae]);
  }
  return rows.length ? { name: 'currency_mae', header: ['run_id','horizon','currency','point_count','mae'], rows } : null;
}
function failures(run: BacktestRunResult): ExportSection | null {
  return run.symbolsFailed.length ? { name: 'failed_symbols', header: ['symbol','reason'], rows: run.symbolsFailed.map(x => [x.symbol, x.reason]) } : null;
}
export function backtestToSections(run: BacktestRunResult): ExportSection[] {
  const sections = [runInfo(run), horizons(run)], currency = currencies(run), failed = failures(run);
  if (currency) sections.push(currency); if (failed) sections.push(failed);
  return sections;
}
function records(section: ExportSection): Record<string, unknown>[] {
  return section.rows.map(row => Object.fromEntries(section.header.map((key, index) => [key, row[index] ?? null])));
}
export function renderSectionCsv(section: ExportSection) { return csvText(records(section)); }
export function backtestToCsv(run: BacktestRunResult) { return renderSectionCsv(horizons(run)); }

const tsvCell = (value: Cell) => {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  if (/^[\t\r\n ]*[=+@-]/.test(text)) text = "'" + text;
  return text.replace(/[\t\r\n]/g, ' ');
};
export function renderSectionTsv(section: ExportSection) {
  return [section.header.map(tsvCell).join('\t'), ...section.rows.map(row => row.map(tsvCell).join('\t'))].join('\r\n');
}
export function backtestToTsv(run: BacktestRunResult) { return renderSectionTsv(horizons(run)); }

/** Human inspection only. Importers should use one file per backtestToSections() item. */
export function backtestToDetailedCsv(run: BacktestRunResult) {
  return backtestToSections(run).map(section => csvLine(['section', section.name]) + renderSectionCsv(section).replace(/^\uFEFF/, '')).join('\r\n');
}
export function suggestedFileName(run: BacktestRunResult, sectionName: string, ext: 'csv' | 'tsv') {
  const safeRun = run.runId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'backtest';
  const safeSection = sectionName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'section';
  return `${safeRun}__${safeSection}.${ext}`;
}

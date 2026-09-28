/** Read-only retention preview. This module never deletes or updates records. */

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_KEEP_RUNS = 50;
const SAMPLE_LIMIT = 50;

export class RetentionInputError extends Error {}

export type OutcomeCandidate = {
  outcomeId: string;
  recordId: string;
  symbol: string;
  horizon: number;
  evaluatedAt: string;
  state: string | null;
  jsonValid: boolean;
};

export type BacktestCandidate = {
  id: string;
  createdAt: string;
  symbolsSucceeded: number | null;
  jsonValid: boolean;
};

export type RetentionPreview = {
  generatedAt: string;
  cutoffDate: string;
  retentionDays: number;
  keepRuns: number;
  outcomes: {
    totalCandidates: number;
    invalidJson: number;
    samples: OutcomeCandidate[];
    oldest: string | null;
    newest: string | null;
  };
  backtests: {
    totalRuns: number;
    totalCandidates: number;
    invalidJson: number;
    samples: BacktestCandidate[];
    oldest: string | null;
    newest: string | null;
  };
};

function boundedInteger(value: unknown, fallback: number, min: number, max: number, label: string) {
  const selected = value === undefined ? fallback : value;
  if (typeof selected !== 'number' || !Number.isInteger(selected) || selected < min || selected > max) {
    throw new RetentionInputError(`${label} يجب أن يكون عددًا صحيحًا بين ${min} و${max}.`);
  }
  return selected;
}

const numberOrZero = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const nullableText = (value: unknown) => typeof value === 'string' ? value : null;

export async function previewOldOutcomes(
  db: any,
  retentionDays = DEFAULT_RETENTION_DAYS,
): Promise<RetentionPreview['outcomes']> {
  const days = boundedInteger(retentionDays, DEFAULT_RETENTION_DAYS, 7, 3650, 'أيام الاحتفاظ');
  const cutoffDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const stats = await db.prepare(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN json_valid(o.data)=0 THEN 1 ELSE 0 END) AS invalid_json,
            MIN(o.evaluated_at) AS oldest,MAX(o.evaluated_at) AS newest
     FROM forecast_outcomes o JOIN forecast_records f ON f.id=o.id
     WHERE o.evaluated_at<? AND f.available=1`,
  ).bind(cutoffDate).first();
  const result = await db.prepare(
    `SELECT o.id AS outcome_id,f.id AS record_id,f.symbol,f.horizon,o.evaluated_at,
            json_valid(o.data) AS json_valid,
            CASE WHEN json_valid(o.data)=1 THEN json_extract(o.data,'$.state') ELSE NULL END AS state
     FROM forecast_outcomes o JOIN forecast_records f ON f.id=o.id
     WHERE o.evaluated_at<? AND f.available=1
     ORDER BY o.evaluated_at ASC,o.id ASC LIMIT ?`,
  ).bind(cutoffDate, SAMPLE_LIMIT).all();
  return {
    totalCandidates: numberOrZero(stats?.n),
    invalidJson: numberOrZero(stats?.invalid_json),
    samples: (result.results ?? []).map((row: any) => ({
      outcomeId: String(row.outcome_id), recordId: String(row.record_id), symbol: String(row.symbol),
      horizon: Number(row.horizon), evaluatedAt: String(row.evaluated_at), state: nullableText(row.state),
      jsonValid: row.json_valid === 1,
    })),
    oldest: nullableText(stats?.oldest), newest: nullableText(stats?.newest),
  };
}

export async function previewOldBacktests(
  db: any,
  keepRuns = DEFAULT_KEEP_RUNS,
): Promise<RetentionPreview['backtests']> {
  const keep = boundedInteger(keepRuns, DEFAULT_KEEP_RUNS, 10, 10000, 'عدد الدورات المحفوظة');
  const totalRow = await db.prepare('SELECT COUNT(*) AS n FROM backtest_runs').first();
  const totalRuns = numberOrZero(totalRow?.n);
  if (totalRuns <= keep) return { totalRuns, totalCandidates: 0, invalidJson: 0, samples: [], oldest: null, newest: null };
  const stats = await db.prepare(
    `SELECT COUNT(*) AS n,SUM(CASE WHEN json_valid(data)=0 THEN 1 ELSE 0 END) AS invalid_json,
            MIN(created_at) AS oldest,MAX(created_at) AS newest
     FROM backtest_runs WHERE id NOT IN (
       SELECT id FROM backtest_runs ORDER BY created_at DESC,id DESC LIMIT ?
     )`,
  ).bind(keep).first();
  const result = await db.prepare(
    `SELECT id,created_at,json_valid(data) AS json_valid,
            CASE WHEN json_valid(data)=1 THEN json_extract(data,'$.symbolsSucceeded') ELSE NULL END AS symbols_succeeded
     FROM backtest_runs WHERE id NOT IN (
       SELECT id FROM backtest_runs ORDER BY created_at DESC,id DESC LIMIT ?
     ) ORDER BY created_at ASC,id ASC LIMIT ?`,
  ).bind(keep, SAMPLE_LIMIT).all();
  return {
    totalRuns,
    totalCandidates: numberOrZero(stats?.n),
    invalidJson: numberOrZero(stats?.invalid_json),
    samples: (result.results ?? []).map((row: any) => ({
      id: String(row.id), createdAt: String(row.created_at),
      symbolsSucceeded: typeof row.symbols_succeeded === 'number' ? row.symbols_succeeded : null,
      jsonValid: row.json_valid === 1,
    })),
    oldest: nullableText(stats?.oldest), newest: nullableText(stats?.newest),
  };
}

export async function previewRetention(
  db: any,
  options: { days?: number; keepRuns?: number } = {},
): Promise<RetentionPreview> {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new RetentionInputError('خيارات المعاينة غير صالحة.');
  const unknown = Object.keys(options).filter(key => !['days', 'keepRuns'].includes(key));
  if (unknown.length) throw new RetentionInputError('تحتوي خيارات المعاينة على حقل غير معروف.');
  const days = boundedInteger(options.days, DEFAULT_RETENTION_DAYS, 7, 3650, 'أيام الاحتفاظ');
  const keepRuns = boundedInteger(options.keepRuns, DEFAULT_KEEP_RUNS, 10, 10000, 'عدد الدورات المحفوظة');
  const [outcomes, backtests] = await Promise.all([
    previewOldOutcomes(db, days), previewOldBacktests(db, keepRuns),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    cutoffDate: new Date(Date.now() - days * 86400000).toISOString().slice(0, 10),
    retentionDays: days, keepRuns, outcomes, backtests,
  };
}

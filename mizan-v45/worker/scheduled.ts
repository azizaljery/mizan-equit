/** Evaluate already-issued forecasts only; never create forecasts or start research. */
import { EVALUATE_DUE_CRON, EVALUATE_DUE_STATE_ID, EVALUATE_DUE_CRON_STATE_ID } from '../lib/jobs/schedule';
import { configuredReader } from '../lib/source-status';
import { readSettings } from '../lib/site-settings';
import { fetchCompany, validSymbol } from '../lib/market-data';
import { resolveForecasts, MATURITY_PREDICATE, ForecastResolutionError } from '../lib/forecast-journal';
import { newHeartbeatRunId, pingArrival, pingEvaluation, pingSaveFailure } from '../lib/jobs/heartbeat';

const LOCK_ID = 'cron:resolution:v1';
const LOCK_MS = 15 * 60 * 1000;
const STATE_ID = EVALUATE_DUE_STATE_ID;
// Full production fetchCompany includes filings, peers and benchmarks. Live
// provider checks exceeded 25s; stay below the 90s symbol lease without dropping them.
const FETCH_TIMEOUT_MS = 60 * 1000; // fetchCompany only, not D1 writes.
const SYMBOL_LOCK_MS = 90 * 1000;
const RUN_BUDGET_MS = 10 * 60 * 1000; // Do not outlive the global lease on large limits.
export const RESOLUTION_CRON = EVALUATE_DUE_CRON;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export type ScheduledRunSummary = {
  runId: string; startedAt: string; finishedAt: string; durationMs: number; limit: number;
  symbolsScanned: number; symbolsResolved: number; symbolsSkipped: number; symbolsFailed: number;
  evaluationsSaved: number; triggeredBy: 'cron' | 'manual'; cron?: string; scheduledTime?: number;
  errors: Array<{symbol: string; error: string}>; lockAcquired: boolean; lockSkipped?: string;
  status: 'completed' | 'partial' | 'failed' | 'locked'; stateSaved: boolean;
  fatalError?: string;
  sources?: Array<{symbol:string; trace:import('../lib/sources/bridge').CompanySourceTrace}>;
  integrity: {outcomesDuplicates: number; revisionsDuplicates: number; consecutiveRevisionDuplicates: number; revisionNumberDuplicates: number};
};

/** Observations, not a proof of idempotency. A -> B -> A is a valid correction
 * history, so repeated historical fingerprints must be distinguished from
 * duplicate consecutive revisions. -1 means the query failed, never zero. */
export async function checkResolutionIntegrity(db: any): Promise<ScheduledRunSummary['integrity']> {
  const count = async (sql: string) => {
    try { const row = await db.prepare(sql).first(); return typeof row?.n === 'number' && Number.isInteger(row.n) && row.n >= 0 ? row.n : -1; }
    catch (error) { console.error('[mizan-cron] integrity-check', sql.slice(0, 60), errorText(error)); return -1; }
  };
  return {
    outcomesDuplicates: await count('SELECT COUNT(*) n FROM (SELECT id FROM forecast_outcomes GROUP BY id HAVING COUNT(*)>1)'),
    revisionsDuplicates: await count('SELECT COUNT(*) n FROM (SELECT forecast_id,fingerprint FROM evaluation_revisions GROUP BY forecast_id,fingerprint HAVING COUNT(*)>1)'),
    consecutiveRevisionDuplicates: await count('SELECT COUNT(*) n FROM (SELECT fingerprint,LAG(fingerprint) OVER(PARTITION BY forecast_id ORDER BY revision) previous FROM evaluation_revisions) WHERE fingerprint=previous'),
    revisionNumberDuplicates: await count('SELECT COUNT(*) n FROM (SELECT forecast_id,revision FROM evaluation_revisions GROUP BY forecast_id,revision HAVING COUNT(*)>1)'),
  };
}

export async function withResolutionTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('fetch-timeout')), ms);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function tryAcquireLock(db: any, id: string, ms: number): Promise<string | null> {
  const token = crypto.randomUUID(), now = Date.now();
  // Storage errors are errors, not evidence that another run owns the lock.
  const row = await db.prepare('INSERT INTO research_locks(id,token,until_ms) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,until_ms=excluded.until_ms WHERE until_ms<? RETURNING token')
    .bind(id, token, now + ms, now).first();
  return row?.token === token ? token : null;
}

export async function releaseLock(db: any, id: string, token: string) {
  try { await db.prepare('DELETE FROM research_locks WHERE id=? AND token=?').bind(id, token).run(); }
  catch (error) { console.error('[mizan-cron] release-lock', id, errorText(error)); /* Lease expires; never delete a successor's lease. */ }
}

async function saveLastRun(db: any, summary: ScheduledRunSummary) {
  summary.finishedAt = new Date().toISOString();
  summary.durationMs = Date.parse(summary.finishedAt) - Date.parse(summary.startedAt);
  summary.stateSaved = true;
  try {
    const ids=summary.triggeredBy==='cron'?[STATE_ID,EVALUATE_DUE_CRON_STATE_ID]:[STATE_ID];
    await db.batch(ids.map(id=>db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
      .bind(id, JSON.stringify(summary), summary.finishedAt)));
  } catch (error) {
    console.error('[mizan-cron] evaluate-due', 'save-last-run', errorText(error));
    summary.stateSaved = false;
    if (summary.status !== 'failed') summary.status = 'partial';
    summary.errors.push({symbol: '', error: 'تعذر حفظ سجل التشغيل؛ لا يؤثر ذلك في النتائج التي حُفظت بالفعل.'});
  }
}

export async function readLastRun(db: any): Promise<ScheduledRunSummary | null> {
  const row = await db.prepare('SELECT data FROM research_state WHERE id=?').bind(STATE_ID).first()
    ?? await db.prepare('SELECT data FROM research_state WHERE id=?').bind('cron:resolution:last').first();
  return row?.data ? JSON.parse(row.data) : null;
}

export async function runResolutionCycle(db: any, options: {limit: number; triggeredBy: 'cron' | 'manual'; cron?: string; scheduledTime?: number; runId?: string}): Promise<ScheduledRunSummary> {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error('limit must be an integer from 1 to 100');
  const start = Date.now();
  const summary: ScheduledRunSummary = {
    runId: options.runId ?? crypto.randomUUID(), startedAt: new Date(start).toISOString(), finishedAt: '', durationMs: 0,
    limit: options.limit, symbolsScanned: 0, symbolsResolved: 0, symbolsSkipped: 0, symbolsFailed: 0,
    evaluationsSaved: 0, triggeredBy: options.triggeredBy, ...(options.cron ? {cron: options.cron} : {}), ...(Number.isFinite(options.scheduledTime)?{scheduledTime:options.scheduledTime}:{}),
    errors: [], lockAcquired: false, status: 'completed', stateSaved: false,
    integrity: {outcomesDuplicates: -1, revisionsDuplicates: -1, consecutiveRevisionDuplicates: -1, revisionNumberDuplicates: -1},
  };
  let globalToken: string | null = null;
  try {
    globalToken = await tryAcquireLock(db, LOCK_ID, LOCK_MS);
    if (!globalToken) {
      summary.status = 'locked'; summary.lockSkipped = 'تشغيل آخر ما زال قائمًا.';
      summary.integrity = await checkResolutionIntegrity(db);
      // Do not overwrite a completed/in-progress owner's last run with a contender.
      summary.finishedAt = new Date().toISOString(); summary.durationMs = Date.now() - start;
      return summary;
    }
    summary.lockAcquired = true;
    const settings = await readSettings(db), read = await configuredReader(db, settings);
    const asOf = new Date().toISOString().slice(0, 10);
    const pending = await db.prepare(`SELECT f.symbol, MIN(f.created_at) AS first_pending
      FROM forecast_records f LEFT JOIN forecast_outcomes o ON o.id=f.id
      LEFT JOIN research_state a ON a.id='cron:resolution:attempt:'||f.symbol
      WHERE f.available=1 AND o.id IS NULL AND ${MATURITY_PREDICATE}
      GROUP BY f.symbol ORDER BY COALESCE(MAX(a.updated_at),''), first_pending, f.symbol LIMIT ?`)
      .bind(asOf, options.limit).all();
    for (const row of pending.results || []) {
      if (Date.now() - start > RUN_BUDGET_MS - SYMBOL_LOCK_MS) {
        summary.status = 'partial'; summary.errors.push({symbol: '', error: 'بلغت الدورة حد وقتها؛ بقيت المستحقات للدورة التالية.'}); break;
      }
      const symbol = row.symbol; summary.symbolsScanned++;
      const fail = (error: string) => { if (summary.errors.length < 20) summary.errors.push({symbol, error}); };
      // Rotate attempted symbols so a broken oldest symbol cannot starve the queue.
      const attemptedAt = new Date().toISOString();
      await db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
        .bind('cron:resolution:attempt:' + symbol, JSON.stringify({runId: summary.runId, attemptedAt}), attemptedAt).run();
      // Restrict this stock job to unambiguous symbols; never infer every other asset is US.
      const market = /^\d{4,5}\.SR$/.test(symbol) ? 'sa' : /^[A-Z][A-Z0-9-]*$/.test(symbol) ? 'us' : null;
      if (!validSymbol(symbol) || !market || !settings.enabledMarkets.includes(market)) {
        summary.symbolsSkipped++; fail('رمز غير صالح أو سوق متوقف من إعدادات الإدارة.'); continue;
      }
      const symId = 'resolve:' + symbol;
      let token: string | null = null;
      try {
        token = await tryAcquireLock(db, symId, SYMBOL_LOCK_MS);
        if (!token) { summary.symbolsSkipped++; fail('قفل الرمز مأخوذ من تشغيل آخر.'); continue; }
        const deadline = Date.now() + FETCH_TIMEOUT_MS;
        // Promise timeout cannot undo an in-flight provider request. Existing readers
        // have per-request aborts; this guard prevents follow-up requests after timeout.
        const boundedRead: (...args:Parameters<typeof read>)=>ReturnType<typeof read> = (...args) => {
          if (Date.now() >= deadline) return Promise.reject(new Error('fetch-timeout'));
          return read(...args);
        };
        const report = await withResolutionTimeout(fetchCompany(symbol, Object.assign(boundedRead,{sourceAttempts:read.sourceAttempts})), FETCH_TIMEOUT_MS);
        if(report.sourceLayer)(summary.sources??=[]).push({symbol,trace:report.sourceLayer});
        if (!report.prices.length) { summary.symbolsSkipped++; fail('لم تصل سلسلة أسعار صالحة.'); continue; }
        // Coverage is checked per forecast inside evaluateForecast, NOT by combining
        // oldest anchor + largest horizon, which could hide valid newer forecasts.
        const count = await resolveForecasts(db, report);
        if (count > 0) { summary.symbolsResolved++; summary.evaluationsSaved += count; }
        else { summary.symbolsSkipped++; fail('لم تصل بيانات كافية لإتمام تقييم جديد؛ تبقى التوقعات محفوظة.'); }
      } catch (error) {
        console.error('[mizan-cron] evaluate-due', 'symbol', symbol, errorText(error));
        summary.symbolsFailed++;
        // Earlier per-forecast transactions may already be committed. Report them
        // even when a later forecast of this symbol fails; never undo their history.
        if (error instanceof ForecastResolutionError) summary.evaluationsSaved += error.evaluationsSaved;
        // Never persist provider URLs, credentials, SQL details or raw exception text.
        fail(error instanceof Error && error.message === 'fetch-timeout' ? 'انتهت مهلة جلب بيانات الرمز.' : 'تعذر جلب بيانات الرمز أو حفظ تقييمه.');
      } finally { if (token) await releaseLock(db, symId, token); }
    }
    if (summary.symbolsFailed || summary.symbolsSkipped) summary.status = 'partial';
  } catch (error) {
    console.error('[mizan-cron] evaluate-due', 'cycle', errorText(error));
    summary.status = 'failed';
    summary.fatalError = 'تعذر قراءة قاعدة البيانات أو إعدادات دورة التقييم.';
    summary.errors.push({symbol: '*', error: summary.fatalError});
  } finally {
    // Save while still holding the global lease, so a slower old run cannot replace
    // the next run's status. Failed acquisition has no owner state to overwrite.
    if (globalToken || summary.status === 'failed') {
      summary.integrity = await checkResolutionIntegrity(db);
      if (Object.values(summary.integrity).some(n => n === -1) && summary.status !== 'failed') summary.status = 'partial';
      await saveLastRun(db, summary);
    }
    if (globalToken) await releaseLock(db, LOCK_ID, globalToken);
  }
  return summary;
}

export async function scheduledResolution(controller: {cron: string; scheduledTime?: number}, runtime: {DB: any; MIZAN_BACKGROUND_CRON_ENABLED?: string}) {
  if (runtime.MIZAN_BACKGROUND_CRON_ENABLED !== 'true' || controller.cron !== RESOLUTION_CRON) return;
  const runId = newHeartbeatRunId();
  const arrival = await pingArrival(runtime.DB, true, runId);
  if (!arrival.ok) await pingSaveFailure(runtime.DB, runId, true, arrival.error ?? 'تعذر حفظ نبضة الوصول.');
  const result = await runResolutionCycle(runtime.DB, {limit: 20, triggeredBy: 'cron', cron: controller.cron, scheduledTime:controller.scheduledTime, runId});
  const evaluation = await pingEvaluation(runtime.DB, runId, true, {
    state: result.status,
    symbolsScanned: result.symbolsScanned,
    symbolsResolved: result.symbolsResolved,
    symbolsSkipped: result.symbolsSkipped,
    symbolsFailed: result.symbolsFailed,
    evaluationsSaved: result.evaluationsSaved,
    durationMs: result.durationMs,
    stateSaved: result.stateSaved,
  });
  if (!evaluation.ok) await pingSaveFailure(runtime.DB, runId, true, evaluation.error ?? 'تعذر حفظ نبضة التقييم.');
  console.log('[mizan-cron] evaluate-due',JSON.stringify(result));
  if (!arrival.ok || !evaluation.ok || result.status === 'failed' || !result.stateSaved && result.status !== 'locked') throw new Error('Background evaluation failed; inspect owner-only run status.');
  return result;
}

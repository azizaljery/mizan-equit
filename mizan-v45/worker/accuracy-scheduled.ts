/**
 * جدولة عينة الدقة — تنشئ وتُقدِّم عينات تاريخية (سياق سوق حقيقي مؤرَّخ
 * فعلياً، لا مُفبرَك) بانتظام، بدل انتظار نضوج توقعات حية أو الاعتماد حصراً
 * على نقر إداري يدوي لكل صف كما في app/api/accuracy-sample/route.ts.
 *
 * منفصلة كلياً عن scheduled.ts (EVALUATE_DUE_CRON): تلك تقيّم توقعات حية
 * صدرت فعلاً؛ هذه تُنشئ وتقيس عينات تاريخية جديدة. كل منهما تتحقق من
 * cron الخاص بها في المُرسِل المشترك (worker/index.ts) ولا تتداخلان.
 *
 * تدوير سوق×أفق محفوظ في research_state (لا عشوائي في كل دورة) يضمن
 * تغطية الأسواق والآفاق الستة تباعاً بدل تكرار نفس المجموعة، ونافذة
 * الاسترجاع (lookbackDays) لكل أفق تُحسب لتقع دوماً بعد نضوجه فعلياً —
 * لا حاجة لانتظار الزمن الحقيقي حتى لأفق السنة الكامل.
 */
import { readSettings } from '../lib/site-settings';
import { configuredReader } from '../lib/source-status';
import { createAccuracyRun, processAccuracyRow, lastCompleteDay } from '../lib/accuracy-sample';
import { HORIZONS } from '../lib/forecast-horizons';
import { readStateField } from '../lib/jobs/read-state';
import { ACCURACY_SAMPLE_CRON, ACCURACY_SAMPLE_STATE_ID, ACCURACY_SAMPLE_CRON_STATE_ID, ACCURACY_SAMPLE_ROTATION_ID } from '../lib/jobs/accuracy-schedule';
import { tryAcquireLock, releaseLock } from './scheduled';
import { newHeartbeatRunId, pingAccuracyArrival, pingAccuracyEvaluation, pingAccuracySaveFailure } from '../lib/jobs/heartbeat';

const LOCK_ID = 'cron:accuracy-sample:v1';
const LOCK_MS = 15 * 60 * 1000;
const RUN_BUDGET_MS = 8 * 60 * 1000;
/** أقل من حد resolution (20 رمزاً) عمداً: كل صف هنا يحتاج شبكياً حتى 3 طلبات (سعر السهم + سعر المؤشر + أرشيف مالي). */
const ROW_BUDGET_PER_CYCLE = 10;
export const ACCURACY_SAMPLE_LOCK_ID = LOCK_ID;

export type AccuracyScheduleSummary = {
  runId: string; startedAt: string; finishedAt: string; durationMs: number;
  triggeredBy: 'cron' | 'manual'; cron?: string; scheduledTime?: number;
  runsCreated: number; rowsAdvanced: number; rowsFailed: number;
  lockAcquired: boolean; lockSkipped?: string;
  status: 'completed' | 'partial' | 'failed' | 'locked'; stateSaved: boolean; fatalError?: string;
  errors: Array<{context: string; error: string}>;
};

async function saveAccuracyRun(db: any, summary: AccuracyScheduleSummary) {
  summary.finishedAt = new Date().toISOString();
  summary.durationMs = Date.parse(summary.finishedAt) - Date.parse(summary.startedAt);
  summary.stateSaved = true;
  try {
    const ids = summary.triggeredBy === 'cron' ? [ACCURACY_SAMPLE_STATE_ID, ACCURACY_SAMPLE_CRON_STATE_ID] : [ACCURACY_SAMPLE_STATE_ID];
    await db.batch(ids.map((id: string) => db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
      .bind(id, JSON.stringify(summary), summary.finishedAt)));
  } catch {
    summary.stateSaved = false;
    if (summary.status !== 'failed') summary.status = 'partial';
    summary.errors.push({context: '', error: 'تعذر حفظ سجل التشغيل؛ لا يؤثر ذلك في النتائج التي حُفظت بالفعل.'});
  }
}

/** أيام تقويمية كافية لضمان نضوج h.sessions جلسة تداول قبل تاريخ الإنشاء — هامش أمان 1.6× + 30 يوماً. */
function lookbackDaysFor(sessions: number): number {
  return Math.ceil(sessions * 1.6) + 30;
}

export async function runAccuracySampleCycle(
  db: any, options: {triggeredBy: 'cron' | 'manual'; cron?: string; scheduledTime?: number; runId?: string},
): Promise<AccuracyScheduleSummary> {
  const start = Date.now();
  const summary: AccuracyScheduleSummary = {
    runId: options.runId ?? crypto.randomUUID(), startedAt: new Date(start).toISOString(), finishedAt: '', durationMs: 0,
    triggeredBy: options.triggeredBy, ...(options.cron ? {cron: options.cron} : {}), ...(Number.isFinite(options.scheduledTime) ? {scheduledTime: options.scheduledTime} : {}),
    runsCreated: 0, rowsAdvanced: 0, rowsFailed: 0, lockAcquired: false, status: 'completed', stateSaved: false, errors: [],
  };
  let token: string | null = null;
  try {
    token = await tryAcquireLock(db, LOCK_ID, LOCK_MS);
    if (!token) {
      summary.status = 'locked'; summary.lockSkipped = 'تشغيل آخر ما زال قائمًا.';
      return summary;
    }
    summary.lockAcquired = true;
    const settings = await readSettings(db), read = await configuredReader(db, settings), now = Date.now();

    // 1) لا صفوف معلّقة إطلاقاً → أنشئ عينة واحدة جديدة حسب دور السوق×الأفق الحالي.
    const pendingCount = await db.prepare("SELECT COUNT(*) n FROM accuracy_rows WHERE state NOT IN ('complete','excluded','unavailable')").first();
    if (Number(pendingCount?.n ?? 0) === 0) {
      try {
        const rotation = await readStateField(db, ACCURACY_SAMPLE_ROTATION_ID, ['index']);
        const index = Number.isInteger(rotation?.index) ? (rotation!.index as number) : 0;
        const market: 'sa' | 'us' = index % 2 === 0 ? 'sa' : 'us';
        const horizon = HORIZONS[Math.floor(index / 2) % HORIZONS.length];
        const date = new Date(now - lookbackDaysFor(horizon.sessions) * 86400000).toISOString().slice(0, 10);
        const id = crypto.randomUUID();
        await createAccuracyRun(db, {id, market, date: date <= lastCompleteDay(now) ? date : lastCompleteDay(now), sessions: horizon.sessions}, settings, now);
        summary.runsCreated = 1;
        await db.prepare("INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at")
          .bind(ACCURACY_SAMPLE_ROTATION_ID, JSON.stringify({index: index + 1, market, sessions: horizon.sessions}), new Date().toISOString()).run();
      } catch (error) {
        summary.errors.push({context: 'create', error: error instanceof Error ? error.message.slice(0, 200) : 'تعذر إنشاء عينة جديدة.'});
      }
    }

    // 2) تقدّم على الصفوف المعلّقة (الأقدم تحديثاً أولاً) ضمن ميزانية زمنية وعددية.
    const pending = await db.prepare(
      "SELECT id, run_id, forecast FROM accuracy_rows WHERE state NOT IN ('complete','excluded','unavailable') ORDER BY updated_at ASC LIMIT ?",
    ).bind(ROW_BUDGET_PER_CYCLE).all();
    for (const row of pending.results || []) {
      if (Date.now() - start > RUN_BUDGET_MS) {
        summary.status = 'partial'; summary.errors.push({context: '', error: 'بلغت الدورة حد وقتها؛ بقيت صفوف للدورة التالية.'}); break;
      }
      const action: 'forecast' | 'measure' = row.forecast ? 'measure' : 'forecast';
      try {
        // processAccuracyRow لا تُلقي استثناءً أبداً على فشل شبكي — تكتب state='failed'
        // داخل الصف وتُعيد النتيجة بنجاح دوماً. عدّ "لم يُرمَ استثناء" كنجاح كان يُخفي
        // فشلاً حقيقياً بالكامل خلف rowsFailed=0 دوماً؛ نفحص حالة الصف نفسه بعد المحاولة.
        const result = await processAccuracyRow(db, row.run_id, row.id, action, read, now);
        const updated = (result?.rows ?? []).find((r: any) => r.id === row.id);
        if (updated?.state === 'failed') { summary.rowsFailed++; summary.errors.push({context: row.id, error: String(updated.error || 'فشل تقدّم الصف.').slice(0, 200)}); }
        else summary.rowsAdvanced++;
      } catch (error) {
        summary.rowsFailed++; summary.errors.push({context: row.id, error: error instanceof Error ? error.message.slice(0, 200) : 'تعذر تقدّم الصف.'});
      }
    }
    if (summary.rowsFailed) summary.status = 'partial';
  } catch {
    summary.status = 'failed';
    summary.fatalError = 'تعذر قراءة قاعدة البيانات أو إعدادات دورة العينة.';
    summary.errors.push({context: '*', error: summary.fatalError});
  } finally {
    if (token || summary.status === 'failed') await saveAccuracyRun(db, summary);
    if (token) await releaseLock(db, LOCK_ID, token);
  }
  return summary;
}

export async function scheduledAccuracySample(
  controller: {cron: string; scheduledTime?: number}, runtime: {DB: any; MIZAN_BACKGROUND_CRON_ENABLED?: string},
) {
  if (runtime.MIZAN_BACKGROUND_CRON_ENABLED !== 'true' || controller.cron !== ACCURACY_SAMPLE_CRON) return;
  const runId = newHeartbeatRunId();
  const arrival = await pingAccuracyArrival(runtime.DB, true, runId);
  if (!arrival.ok) await pingAccuracySaveFailure(runtime.DB, runId, true, arrival.error ?? 'تعذر حفظ نبضة الوصول.');
  const result = await runAccuracySampleCycle(runtime.DB, {triggeredBy: 'cron', cron: controller.cron, scheduledTime: controller.scheduledTime, runId});
  const evaluation = await pingAccuracyEvaluation(runtime.DB, runId, true, {
    state: result.status,
    runsCreated: result.runsCreated,
    rowsAdvanced: result.rowsAdvanced,
    rowsFailed: result.rowsFailed,
    durationMs: result.durationMs,
    stateSaved: result.stateSaved,
  });
  if (!evaluation.ok) await pingAccuracySaveFailure(runtime.DB, runId, true, evaluation.error ?? 'تعذر حفظ نبضة التقييم.');
  console.log('[mizan-cron] accuracy-sample', JSON.stringify(result));
  if (!arrival.ok || !evaluation.ok || result.status === 'failed' || !result.stateSaved && result.status !== 'locked') throw new Error('Background accuracy-sample failed; inspect owner-only run status.');
  return result;
}

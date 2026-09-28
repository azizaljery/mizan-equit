import {readStateField} from './read-state';

/**
 * جدولة "عينة الدقة" — قياس forecasts() بسياق سوق حقيقي (تاسي/S&P 500
 * مؤرَّخ فعلياً من Yahoo، لا مُفبرَك) على تواريخ ماضية مُختارة، لا انتظار
 * سلبي لنضوج توقعات حية. راجع lib/accuracy-sample.ts::historicalReport —
 * السياق فيها حقيقي مجلوب لكل تاريخ، على خلاف lib/backtest/forecast-walk-forward.ts
 * الذي يحذف السياق عمداً لغياب أرشيف زمني له.
 *
 * منفصلة تماماً عن EVALUATE_DUE_CRON (schedule.ts): تلك تقيّم توقعات
 * صدرت فعلاً حية؛ هذه تُنشئ وتقيس عينات تاريخية جديدة بانتظام لتوسيع
 * حجم العينة بسرعة بلا انتظار الزمن الحقيقي.
 */
export const ACCURACY_SAMPLE_CRON = '0 3 * * *'; // يومياً 03:00 UTC — مرة واحدة كافية؛ التقدم تراكمي عبر الدورات.
export const ACCURACY_SAMPLE_STATE_ID = 'job:accuracy-sample:last';
export const ACCURACY_SAMPLE_CRON_STATE_ID = 'job:accuracy-sample:last-cron';
export const ACCURACY_SAMPLE_ROTATION_ID = 'job:accuracy-sample:rotation';

/** نفس منهج forecastSchedulerStatus في schedule.ts: لا نصدّق تشغيلاً إلا بدليل محفوظ فعلياً. */
export async function accuracySampleSchedulerStatus(db: any) {
  const base = {configured: false, codeConfigured: true, cron: ACCURACY_SAMPLE_CRON, timezone: 'UTC', lastRunAt: null as string | null};
  try {
    const run = await readStateField(db, ACCURACY_SAMPLE_CRON_STATE_ID,
      ['triggeredBy', 'cron', 'lockAcquired', 'stateSaved', 'status', 'fatalError', 'scheduledTime', 'finishedAt', 'runsCreated', 'rowsAdvanced', 'rowsFailed']);
    const valid = run?.triggeredBy === 'cron' && run.cron === ACCURACY_SAMPLE_CRON && run.lockAcquired === true && run.stateSaved === true
      && typeof run.status === 'string' && ['completed', 'partial'].includes(run.status) && !run.fatalError && Number.isFinite(run.scheduledTime)
      && typeof run.finishedAt === 'string' && Number.isFinite(Date.parse(run.finishedAt)) && run._updatedAt === run.finishedAt;
    if (!valid) return {...base, message: 'الكود مهيأ؛ لم يُسجل تشغيل Cron ناجح يمكن التحقق منه.'};
    return {
      ...base, configured: true, lastRunAt: run.finishedAt,
      lastResult: {status: run.status, runsCreated: run.runsCreated, rowsAdvanced: run.rowsAdvanced, rowsFailed: run.rowsFailed},
      message: 'رُصد تشغيل فعلي للمجدول في ' + run.finishedAt + '؛ حالة آخر دورة: ' + run.status,
    };
  } catch { return {...base, message: 'تعذرت قراءة سجل المجدول؛ حالة التشغيل غير متحققة.'}; }
}

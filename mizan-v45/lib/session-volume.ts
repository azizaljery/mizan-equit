// FCST-0004: is the last daily bar's volume final? Answered from evidence, never from an assumed settlement time.
//
// A daily bar can be read as a COMPLETE session only when there is evidence for it:
//   historical-snapshot : the report is a historical snapshot, not a live read;
//   later-session       : the LAST TRADE time of the quote lies inside a LATER session than the bar (so the bar's session is over).
//                         A provider window that merely advanced, with no trade in it, is NOT evidence (window-ahead-no-trade);
//   assumed-settlement  : OPT-IN policy only (assumeCompleteAfterMs, default null = never): N ms after the provider's session end.
// Otherwise the bar is either 'in-session' (the provider's own session window contains `now`: certain) or 'unverified'
// (the session is over by the calendar, but nothing shows that the source has finalised the bar's volume). There is
// deliberately NO built-in "N minutes after close" rule: the source publishes no finalisation signal, and its settlement
// time is not known for any provider or market. Consumers decide what to do with 'unverified' (see CONSUMER POLICY).
//
// CONSUMER POLICY (one definition of completeness does not force one calculation):
//   statistics (technical, forecast conditions, liquidity evidence): use confirmed sessions only, label dates;
//   zero-volume counts (liquidity veto/factor): a zero in the unconfirmed bar still counts (the conservative direction);
//   decision gates (tradeScenario, finalDecision): unchanged; a partial volume is a lower bound of the final volume;
//   price indicators: out of scope, not changed.
import type {Price} from './analysis';

type QuoteLike = {isOpen?: boolean; sessionKnown?: boolean; sessionStart?: number | null; sessionEnd?: number | null;
  gmtOffsetSeconds?: number | null; quoteTime?: string} | null | undefined;
export type SessionReport = {prices: Price[]; liveQuote?: QuoteLike; mode?: string};
export type BarState = 'complete' | 'in-session' | 'unverified';
export type BarStatus = {state: BarState; barDate: string | null; reasonCode: string; evidence: string};
export type SessionPolicy = {assumeCompleteAfterMs?: number | null};

const day = (ms: number, offsetSeconds: number) => new Date(ms + offsetSeconds * 1000).toISOString().slice(0, 10);
const st = (state: BarState, barDate: string | null, reasonCode: string, evidence: string): BarStatus => ({state, barDate, reasonCode, evidence});

export function lastBarStatus(report: SessionReport, now = Date.now(), policy: SessionPolicy = {}): BarStatus {
  const bar = report.prices.at(-1), q = report.liveQuote;
  if (!bar) return st('complete', null, 'no-bar', 'لا توجد شمعة.');
  const d = bar.date;
  if (report.mode === 'historical') return st('complete', d, 'historical-snapshot', 'لقطة تاريخية، لا قراءة حية.');
  if (!q) return st('unverified', d, 'no-quote', 'لا يوجد سعر حي يحدد جلسة الشمعة؛ اكتمالها غير مؤكد.');
  const start = typeof q.sessionStart === 'number' && Number.isFinite(q.sessionStart) ? q.sessionStart : null;
  const end = typeof q.sessionEnd === 'number' && Number.isFinite(q.sessionEnd) ? q.sessionEnd : null;
  if (!q.sessionKnown || end === null) {
    // No session window from the provider: only its open flag and quote date can say anything.
    if (q.isOpen === true && typeof q.quoteTime === 'string' && d === q.quoteTime.slice(0, 10)) return st('in-session', d, 'open-flag', 'المزود يعلن أن السوق مفتوح ولم تُعرف نافذة الجلسة.');
    return st('unverified', d, 'no-session-window', 'لم يصل تقويم الجلسة من المزود؛ اكتمال الشمعة غير مؤكد.');
  }
  // Session date in the EXCHANGE's local time, with the same offset the provider used to date the bars.
  const off = typeof q.gmtOffsetSeconds === 'number' && Number.isFinite(q.gmtOffsetSeconds) ? q.gmtOffsetSeconds : null;
  const anchors = [start ?? end - 1, end - 1];
  const dates = off !== null ? [day(anchors[1], off)] : [...new Set(anchors.map(a => day(a, 0)))];
  const tzNote = off === null ? ' (المنطقة الزمنية غير معروفة: قورن بتاريخ UTC)' : '';
  if (dates.every(s => d < s)) {
    // The provider's window can advance past midnight with NO new trade (observed: Saudi bar still null-close ~10h after the close).
    // So the window alone proves nothing. Evidence = the last TRADE time (quoteTime) lies inside that later window.
    const qtl = typeof q.quoteTime === 'string' ? Date.parse(q.quoteTime) : NaN;
    // A trade stamped in the future (clock skew, bad data) is not evidence: allow 5 s of skew, like parseLiveQuote.
    if (Number.isFinite(qtl) && qtl > now + 5000) return st('unverified', d, 'quote-time-in-future', `وقت آخر صفقة (${q.quoteTime}) بعد الوقت الحالي؛ لا يُعدّ دليلًا.`);
    // Local-date comparison whenever the exchange offset is known (a window-start test would call a final bar unverified if the provider skipped a session).
    const tradeInLater = Number.isFinite(qtl) && (off !== null ? day(qtl, off) > d : start !== null ? qtl >= start : day(qtl, 0) > d);
    if (tradeInLater) return st('complete', d, 'later-session', `آخر صفقة (${q.quoteTime}) تقع في جلسة أحدث (${dates[0]}) من تاريخ الشمعة ${d}${tzNote}.`);
    return st('unverified', d, 'window-ahead-no-trade', `نافذة المزود تقدمت إلى ${dates[0]} لكن لا صفقة فيها بعد؛ لا دليل على اكتمال شمعة ${d}.`);
  }
  if (!dates.includes(d)) return st('unverified', d, 'date-conflict', `تاريخ الشمعة ${d} لا يطابق جلسة السعر الحي ${dates.join('/')}${tzNote}.`);
  if (start !== null && now >= start && now < end) return st('in-session', d, 'session-open', `الجلسة ${d} مفتوحة الآن حسب نافذة المزود.`);
  if (start === null && now < end) return st('in-session', d, 'session-open', `الجلسة ${d} لم تنتهِ بعد حسب المزود.`);
  if (start !== null && now < start) return st('unverified', d, 'before-open', `الوقت قبل افتتاح جلسة ${d} حسب المزود.`);
  const after = policy.assumeCompleteAfterMs;
  if (typeof after === 'number' && Number.isFinite(after) && after >= 0 && now >= end + after) return st('complete', d, 'assumed-settlement', `سياسة اختيارية: مضى ${Math.round(after / 60000)} دقيقة على نهاية الجلسة (افتراض، لا إثبات).`);
  const qt = typeof q.quoteTime === 'string' ? Date.parse(q.quoteTime) : NaN;
  const late = Number.isFinite(qt) && qt < end ? ' آخر وقت للسعر سابق لنهاية الجلسة (بيانات متأخرة أو بلا صفقات في الختام).' : '';
  return st('unverified', d, 'closed-unconfirmed', `الجلسة ${d} انتهت بالتقويم، لكن لا دليل على أن المصدر أنهى حجمها.${late}`);
}

/** True unless the last bar is CONFIRMED complete. */
export const lastBarNotConfirmed = (report: SessionReport, now = Date.now(), policy: SessionPolicy = {}) => lastBarStatus(report, now, policy).state !== 'complete';
/** Prices whose volume may be compared with each other: the not-confirmed bar is removed. */
export const confirmedSessionPrices = (report: SessionReport, now = Date.now(), policy: SessionPolicy = {}): Price[] =>
  lastBarNotConfirmed(report, now, policy) ? report.prices.slice(0, -1) : report.prices;

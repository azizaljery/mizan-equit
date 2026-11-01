// FCST-0004: one definition of "the last daily bar is still incomplete", shared by every place that reads its volume.
// A bar whose session is open (or just closed) carries partial volume. Comparing it with complete sessions understates
// relative volume. The helper is pure: it needs `now` as an argument and reads no clock except as a default.
import type {Price} from './analysis';

/** Minutes after the official close during which the last bar is still treated as possibly incomplete.
 *  UNVERIFIED PRECAUTION: no provider documentation or measurement here shows how long the provider needs to publish the
 *  final volume (closing auction, late prints). 0 would trust the bar at the close; 60 min is a conservative choice. */
export const POST_CLOSE_GRACE_MS = 60 * 60 * 1000;

type QuoteLike = {isOpen?: boolean; sessionKnown?: boolean; sessionEnd?: number | null; quoteTime?: string} | null | undefined;
export type SessionReport = {prices: Price[]; liveQuote?: QuoteLike; mode?: string};

/** True when the last bar is the session that is open now or closed less than POST_CLOSE_GRACE_MS ago. */
export function lastBarIncomplete(report: SessionReport, now = Date.now()): boolean {
  const bar = report.prices.at(-1), q = report.liveQuote;
  if (!bar || !q || report.mode === 'historical') return false;
  if (q.sessionKnown && typeof q.sessionEnd === 'number' && Number.isFinite(q.sessionEnd)) {
    // The session date is the UTC date of the last millisecond of the regular session (true for SA and US sessions).
    const sessionDate = new Date(q.sessionEnd - 1).toISOString().slice(0, 10);
    return bar.date === sessionDate && now < q.sessionEnd + POST_CLOSE_GRACE_MS;
  }
  // Session times unknown: fall back to the provider's open flag and the quote date.
  return q.isOpen === true && typeof q.quoteTime === 'string' && bar.date === q.quoteTime.slice(0, 10);
}

/** Prices whose volume may be compared with each other: the in-progress bar is removed. */
export function completedSessionPrices(report: SessionReport, now = Date.now()): Price[] {
  return lastBarIncomplete(report, now) ? report.prices.slice(0, -1) : report.prices;
}

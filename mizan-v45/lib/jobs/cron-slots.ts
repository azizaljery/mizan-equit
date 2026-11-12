/**
 * One heavy job per scheduled invocation.
 *
 * Cloudflare runs every handler started in one scheduled() call inside the SAME
 * invocation and CPU budget (limits.cpu_ms). Jobs that previously shared a cron
 * expression (market collection + market watch + resolution at '0 *\/6', accuracy +
 * council at '0 3') now get their own invocation. To stay within a small number
 * of cron triggers (5 in total, see vite.config.ts), the lighter periodic jobs share
 * one "slot" expression and are dispatched by the UTC hour of scheduledTime, so each
 * firing still runs exactly one job.
 */
export const MAINTENANCE_SLOT_CRON = '30 0,1,4,6,7,8,9,11,12,13,15,16,17,18,19,20,21 * * *';

/** BOT-0001 steps: Tadawul 08:30/09:30/11:30 UTC (open 07:00-12:00), US 15:30/16:30/17:30/20:30 UTC (open 14:30-21:00). Closed markets only record the reason. */
export const PAPER_BOT_HOURS = [8, 9, 11, 15, 16, 17, 20];

export type SlotJob = 'market-collection' | 'market-watch' | 'council' | 'daily-picks' | 'paper-bot';

/** UTC hour -> job for MAINTENANCE_SLOT_CRON. Hours not listed run nothing. */
export function slotJob(controller: {cron: string; scheduledTime?: number}): SlotJob | null {
  if (controller.cron !== MAINTENANCE_SLOT_CRON) return null;
  const t = Number(controller.scheduledTime);
  if (!Number.isFinite(t)) return null;
  const hour = new Date(t).getUTCHours();
  if (hour === 4) return 'council';
  // 21:30 UTC: after both markets close (Tadawul 12:00 UTC, NYSE 20:00/21:00 UTC) — PROTOCOL-DIR-0002 §4.
  if (hour === 21) return 'daily-picks';
  // 09:30 (Tadawul mid-session) and 16:30 UTC (US mid-session): BOT-0001 paper-trading step. Neither hour is a multiple of 6 (+0/+1), so no collision.
  if (PAPER_BOT_HOURS.includes(hour)) return 'paper-bot';
  if (hour % 6 === 0) return 'market-collection';
  if (hour % 6 === 1) return 'market-watch';
  return null;
}

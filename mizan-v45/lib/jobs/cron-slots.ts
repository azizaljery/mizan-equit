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
export const MAINTENANCE_SLOT_CRON = '30 0,1,4,6,7,12,13,18,19 * * *';

export type SlotJob = 'market-collection' | 'market-watch' | 'council';

/** UTC hour -> job for MAINTENANCE_SLOT_CRON. Hours not listed run nothing. */
export function slotJob(controller: {cron: string; scheduledTime?: number}): SlotJob | null {
  if (controller.cron !== MAINTENANCE_SLOT_CRON) return null;
  const t = Number(controller.scheduledTime);
  if (!Number.isFinite(t)) return null;
  const hour = new Date(t).getUTCHours();
  if (hour === 4) return 'council';
  if (hour % 6 === 0) return 'market-collection';
  if (hour % 6 === 1) return 'market-watch';
  return null;
}

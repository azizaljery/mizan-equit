/** Dedicated lightweight cadence for resumable screener followup. Disabled by config until acceptance.
 * Offset by 2 minutes from DAILY_ARCHIVE_CRON ('*\/5') so the two heavy jobs never share one invocation/CPU budget. */
export const SCREENER_FOLLOWUP_CRON='2,7,12,17,22,27,32,37,42,47,52,57 * * * *';

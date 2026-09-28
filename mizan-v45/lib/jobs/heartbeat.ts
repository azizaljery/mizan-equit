/** Verifiable observations around the existing scheduled forecast-resolution job. */

export const HEARTBEAT_ARRIVAL_ID = 'job:cron:heartbeat:last-arrival';
export const HEARTBEAT_EVALUATION_ID = 'job:cron:heartbeat:last-evaluation';
export const HEARTBEAT_SAVE_FAILURE_ID = 'job:cron:heartbeat:last-save-failure';

export type HeartbeatState = 'completed' | 'partial' | 'failed' | 'locked' | 'skipped';
export type HeartbeatEvent = 'arrival' | 'evaluation' | 'save-failed';

export type HeartbeatEvaluation = {
  state: HeartbeatState;
  symbolsScanned: number;
  symbolsResolved: number;
  symbolsSkipped: number;
  symbolsFailed: number;
  evaluationsSaved: number;
  durationMs: number;
  stateSaved: boolean;
};

export type HeartbeatRecord = {
  event: HeartbeatEvent;
  at: string;
  version: string;
  enabled: boolean;
  runId: string;
  evaluation?: HeartbeatEvaluation;
  error?: string;
};

export type HeartbeatRead =
  | { status: 'ok'; record: HeartbeatRecord; updatedAt: string }
  | { status: 'missing' }
  | { status: 'invalid'; updatedAt: string | null }
  | { status: 'read-failed' };

const safeError = (_value: unknown) => 'تعذر حفظ سجل نبضة المهمة.';

export function newHeartbeatRunId(): string {
  return crypto.randomUUID();
}

async function writeKey(
  db: any,
  key: string,
  record: HeartbeatRecord,
): Promise<{ ok: boolean; error?: string }> {
  const data = JSON.stringify(record);
  try {
    await db.prepare(
      `INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?)
       ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`,
    ).bind(key, data, record.at).run();
    const saved = await db.prepare(
      'SELECT data,updated_at FROM research_state WHERE id=?',
    ).bind(key).first();
    if (!saved || saved.data !== data || saved.updated_at !== record.at) {
      return { ok: false, error: 'تعذر تأكيد حفظ سجل نبضة المهمة.' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

export function pingArrival(
  db: any,
  enabled: boolean,
  runId: string,
  version = '1.0.0',
) {
  return writeKey(db, HEARTBEAT_ARRIVAL_ID, {
    event: 'arrival', at: new Date().toISOString(), version, enabled, runId,
  });
}

export function pingEvaluation(
  db: any,
  runId: string,
  enabled: boolean,
  evaluation: HeartbeatEvaluation,
  version = '1.0.0',
) {
  return writeKey(db, HEARTBEAT_EVALUATION_ID, {
    event: 'evaluation', at: new Date().toISOString(), version, enabled, runId, evaluation,
  });
}

export async function pingSaveFailure(
  db: any,
  runId: string,
  enabled: boolean,
  error: string,
  version = '1.0.0',
): Promise<{ ok: boolean; error?: string }> {
  return writeKey(db, HEARTBEAT_SAVE_FAILURE_ID, {
    event: 'save-failed', at: new Date().toISOString(), version, enabled, runId,
    error: error.slice(0, 500),
  });
}

function validRecord(value: unknown): value is HeartbeatRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Partial<HeartbeatRecord>;
  const base = ['arrival', 'evaluation', 'save-failed'].includes(String(r.event))
    && typeof r.at === 'string' && Number.isFinite(Date.parse(r.at))
    && typeof r.version === 'string' && r.version.length > 0
    && typeof r.enabled === 'boolean'
    && typeof r.runId === 'string' && r.runId.length > 0;
  if (!base) return false;
  if (r.event === 'evaluation') {
    const e = r.evaluation;
    return !!e && ['completed', 'partial', 'failed', 'locked', 'skipped'].includes(String(e.state))
      && ['symbolsScanned', 'symbolsResolved', 'symbolsSkipped', 'symbolsFailed', 'evaluationsSaved', 'durationMs']
        .every(key => Number.isSafeInteger((e as unknown as Record<string, unknown>)[key]) && Number((e as unknown as Record<string, unknown>)[key]) >= 0)
      && typeof e.stateSaved === 'boolean';
  }
  return r.evaluation === undefined;
}

export async function readHeartbeat(db: any, key: string): Promise<HeartbeatRead> {
  try {
    const row = await db.prepare(
      'SELECT data,updated_at FROM research_state WHERE id=?',
    ).bind(key).first();
    if (!row) return { status: 'missing' };
    try {
      const record = JSON.parse(row.data);
      return validRecord(record)
        ? { status: 'ok', record, updatedAt: row.updated_at }
        : { status: 'invalid', updatedAt: row.updated_at ?? null };
    } catch {
      return { status: 'invalid', updatedAt: row.updated_at ?? null };
    }
  } catch {
    return { status: 'read-failed' };
  }
}

export const readArrival = (db: any) => readHeartbeat(db, HEARTBEAT_ARRIVAL_ID);
export const readEvaluation = (db: any) => readHeartbeat(db, HEARTBEAT_EVALUATION_ID);
export const readSaveFailure = (db: any) => readHeartbeat(db, HEARTBEAT_SAVE_FAILURE_ID);

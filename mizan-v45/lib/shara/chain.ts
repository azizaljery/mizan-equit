import type {AuditEvent, AuditSink} from './contracts';
import {assertJsonSafe} from './audit';
import {canonicalJson} from './gates';
import {sha256Hex} from './sha256';

export const AUDIT_GENESIS = 'GENESIS';

export interface ChainedAuditRecord {
  readonly index: number;
  readonly prev: string;
  readonly hash: string;
  readonly event: AuditEvent;
}
export interface ChainHead {
  readonly count: number;
  readonly hash: string;
}
export type ChainVerification = {ok: true; head: ChainHead} | {ok: false; reason: string; index?: number};

const recordHash = (index: number, prev: string, event: AuditEvent): string => sha256Hex(canonicalJson({index, prev, event}));

/**
 * Tamper-evident audit sink (hash chain). Deterministic: the hash covers only index, previous hash and the event itself
 * (no wall-clock, no random ids). Editing, reordering or deleting a record in the middle breaks verification; deleting
 * the TAIL is only detectable against an externally stored head ({count, hash}) — keep it elsewhere (e.g. D1 row).
 * Status: experimental, in-memory; not wired into production.
 */
export class ChainedAuditSink implements AuditSink {
  readonly records: ChainedAuditRecord[] = [];

  append(event: AuditEvent): void {
    assertJsonSafe(event);
    const index = this.records.length;
    const prev = index === 0 ? AUDIT_GENESIS : this.records[index - 1].hash;
    this.records.push({index, prev, hash: recordHash(index, prev, event), event});
  }
  head(): ChainHead {
    return {count: this.records.length, hash: this.records.length ? this.records[this.records.length - 1].hash : AUDIT_GENESIS};
  }
  exportJson(): string {
    return JSON.stringify(this.records);
  }
  verify(expected?: ChainHead): ChainVerification {
    return verifyAuditChain(this.records, expected);
  }
}

export function verifyAuditChain(records: readonly ChainedAuditRecord[], expected?: ChainHead): ChainVerification {
  let prev = AUDIT_GENESIS;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r || r.index !== i) return {ok: false, reason: 'INDEX-MISMATCH', index: i};
    if (r.prev !== prev) return {ok: false, reason: 'PREV-MISMATCH', index: i};
    let expectedHash: string;
    try { assertJsonSafe(r.event); expectedHash = recordHash(i, prev, r.event); } catch { return {ok: false, reason: 'EVENT-NOT-JSON-SAFE', index: i}; }
    if (r.hash !== expectedHash) return {ok: false, reason: 'HASH-MISMATCH', index: i};
    prev = r.hash;
  }
  const head: ChainHead = {count: records.length, hash: prev};
  if (expected && (expected.count !== head.count || expected.hash !== head.hash)) return {ok: false, reason: 'HEAD-MISMATCH (records appended/removed after the anchor)'};
  return {ok: true, head};
}

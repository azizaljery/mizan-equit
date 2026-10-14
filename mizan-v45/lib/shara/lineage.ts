import type {CandidateIdentity, SharaStatus} from './contracts';

export interface CandidateRef {
  readonly candidateId: string;
  readonly version: number;
}
const keyOf = (ref: CandidateRef): string => `${ref.candidateId}@${ref.version}`;

/**
 * Immutable version lineage (DAG by construction: a node may only point at parents that already exist, so cycles are impossible).
 * Rules: version is a positive integer; versions of one candidate strictly increase; a registered (id, version) is immutable
 * (re-registering with the same payloadHash is a harmless no-op, a different payloadHash throws); parents must exist.
 * Status: experimental, in-memory; not wired into production.
 */
export class SharaLineage {
  readonly #nodes = new Map<string, {identity: CandidateIdentity; parents: readonly string[]}>();
  readonly #latest = new Map<string, number>();

  register(identity: CandidateIdentity, parents: readonly CandidateRef[] = []): void {
    if (!Number.isInteger(identity.version) || identity.version < 1) throw new RangeError(`version must be a positive integer (${identity.candidateId})`);
    const key = keyOf(identity);
    const existing = this.#nodes.get(key);
    if (existing) {
      if (existing.identity.payloadHash === identity.payloadHash) return;
      throw new Error(`immutable version already exists with different payload: ${key}`);
    }
    const latest = this.#latest.get(identity.candidateId);
    if (latest !== undefined && identity.version <= latest) throw new Error(`version must increase: ${identity.candidateId} latest=${latest}, got ${identity.version}`);
    const parentKeys = parents.map((parent) => {
      const parentKey = keyOf(parent);
      if (!this.#nodes.has(parentKey)) throw new Error(`unknown parent ${parentKey}`);
      return parentKey;
    });
    this.#nodes.set(key, {identity, parents: parentKeys});
    this.#latest.set(identity.candidateId, identity.version);
  }
  has(ref: CandidateRef): boolean {
    return this.#nodes.has(keyOf(ref));
  }
  latestVersion(candidateId: string): number | undefined {
    return this.#latest.get(candidateId);
  }
  ancestors(ref: CandidateRef): string[] {
    const start = this.#nodes.get(keyOf(ref));
    if (!start) throw new Error(`unknown node ${keyOf(ref)}`);
    const seen = new Set<string>();
    const stack = [...start.parents];
    while (stack.length) {
      const k = stack.pop() as string;
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push(...(this.#nodes.get(k)?.parents ?? []));
    }
    return [...seen].sort();
  }
}

export class SharaResurrectionError extends Error {}

/**
 * No Resurrection within one run: once (run, candidate, version) is KILLed, nothing — score, ranker, retry, re-evaluation —
 * may change that status. SUSPEND may later resolve (evidence arrived); PASS may be tightened to KILL; never KILL -> anything else.
 * A new immutable version is a different key and is evaluated from scratch (the KILL is NOT inherited).
 */
export class SharaRunLedger {
  readonly #status = new Map<string, SharaStatus>();

  record(runId: string, ref: CandidateRef, status: SharaStatus): void {
    const key = `${runId}|${keyOf(ref)}`;
    const previous = this.#status.get(key);
    if (previous === 'KILL' && status !== 'KILL') throw new SharaResurrectionError(`KILL cannot be revoked in run ${runId}: ${keyOf(ref)} -> ${status}`);
    this.#status.set(key, status);
  }
  statusOf(runId: string, ref: CandidateRef): SharaStatus | undefined {
    return this.#status.get(`${runId}|${keyOf(ref)}`);
  }
  /** Rankable only if the latest recorded status in this run is PASS. Unknown candidates are NOT rankable. */
  isRankable(runId: string, ref: CandidateRef): boolean {
    return this.statusOf(runId, ref) === 'PASS';
  }
}

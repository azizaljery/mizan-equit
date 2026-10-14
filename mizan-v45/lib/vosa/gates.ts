import type {CandidateEvidenceEnvelope, GateResult, JsonValue, VosaFinding, VosaGate} from './contracts';

/** Deterministic 32-bit FNV-1a over canonical JSON (sync, dependency-free; identifies a gate configuration, not a secret). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
export function fingerprint(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export type EvidenceRead<T> = {ok: true; value: T} | {ok: false; finding: VosaFinding};

/** Missing / non-finite / wrongly typed evidence is NEVER a pass: callers must turn the finding into SUSPEND. */
export function readNumber(candidate: CandidateEvidenceEnvelope, key: string): EvidenceRead<number> {
  const record = candidate.evidence[key];
  if (!record) return {ok: false, finding: {ruleId: 'DATA-MISSING', message: `${key} missing`, required: key}};
  const raw = record.value;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return {ok: false, finding: {ruleId: 'INVALID-NUMERIC-VALUE', message: `${key} is not a finite number`, observed: raw as JsonValue, required: 'finite number'}};
  }
  return {ok: true, value: raw};
}
export function readString(candidate: CandidateEvidenceEnvelope, key: string): EvidenceRead<string> {
  const record = candidate.evidence[key];
  if (!record) return {ok: false, finding: {ruleId: 'DATA-MISSING', message: `${key} missing`, required: key}};
  if (typeof record.value !== 'string') {
    return {ok: false, finding: {ruleId: 'INVALID-VALUE', message: `${key} is not a string`, observed: record.value, required: 'string'}};
  }
  return {ok: true, value: record.value};
}
export function readValue(candidate: CandidateEvidenceEnvelope, key: string): EvidenceRead<JsonValue> {
  const record = candidate.evidence[key];
  if (!record) return {ok: false, finding: {ruleId: 'DATA-MISSING', message: `${key} missing`, required: key}};
  return {ok: true, value: record.value};
}

type GateBody = (candidate: CandidateEvidenceEnvelope) => {status: 'PASS'} | {status: 'KILL' | 'SUSPEND'; findings: VosaFinding[]};

/** Build a pure (read-only, deterministic) gate. */
export function defineGate(spec: {id: string; version?: string; description: string; config?: Record<string, JsonValue>; run: GateBody}): VosaGate {
  const gateVersion = spec.version ?? '1';
  return {
    gateId: spec.id,
    gateVersion,
    pure: true,
    description: spec.description,
    configHash: fingerprint({id: spec.id, version: gateVersion, config: spec.config ?? {}}),
    evaluate(candidate): GateResult {
      const out = spec.run(candidate);
      return out.status === 'PASS'
        ? {gateId: spec.id, gateVersion, status: 'PASS', findings: []}
        : {gateId: spec.id, gateVersion, status: out.status, findings: out.findings};
    },
  };
}

/** KILL when value < min (proof attached); SUSPEND when the evidence is missing or invalid. */
export function minimumGate(id: string, key: string, min: number, description: string, version = '1'): VosaGate {
  return defineGate({id, version, description, config: {key, min}, run: (c) => {
    const read = readNumber(c, key);
    if (!read.ok) return {status: 'SUSPEND', findings: [read.finding]};
    if (read.value < min) return {status: 'KILL', findings: [{ruleId: id, message: `${key} below minimum`, observed: read.value, required: min}]};
    return {status: 'PASS'};
  }});
}
/** KILL when value > max (proof attached); SUSPEND when the evidence is missing or invalid. */
export function maximumGate(id: string, key: string, max: number, description: string, version = '1'): VosaGate {
  return defineGate({id, version, description, config: {key, max}, run: (c) => {
    const read = readNumber(c, key);
    if (!read.ok) return {status: 'SUSPEND', findings: [read.finding]};
    if (read.value > max) return {status: 'KILL', findings: [{ruleId: id, message: `${key} above maximum`, observed: read.value, required: max}]};
    return {status: 'PASS'};
  }});
}

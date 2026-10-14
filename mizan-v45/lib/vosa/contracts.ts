/** VOSA (Veto-Only Survival Architecture) — contracts. Origin: owner-proposed architecture; blueprint from the owner archive (2026-10-14). */
export const VOSA_STATUSES = ["PASS", "KILL", "SUSPEND"] as const;
export type VosaStatus = (typeof VOSA_STATUSES)[number];

export const VOSA_RUN_MODES = ["EXECUTION", "AUDIT"] as const;
export type VosaRunMode = (typeof VOSA_RUN_MODES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface CandidateIdentity {
  readonly candidateId: string;
  readonly version: number;
  readonly payloadHash: string;
}

export interface EvidenceRecord {
  readonly evidenceId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly observedAt: string;
  readonly value: JsonValue;
  readonly sourceRef?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface CandidateEvidenceEnvelope {
  readonly identity: CandidateIdentity;
  readonly assembledAt: string;
  readonly evidence: Readonly<Record<string, EvidenceRecord>>;
}

export interface VosaFinding {
  readonly ruleId: string;
  readonly message: string;
  readonly observed?: JsonValue;
  readonly required?: JsonValue;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface GateIdentity {
  readonly gateId: string;
  readonly gateVersion: string;
}

export interface GateContext {
  readonly pipelineId: string;
  readonly pipelineVersion: string;
  readonly runId: string;
  readonly mode: VosaRunMode;
  readonly gateOrder: number;
}

export interface GateResult extends GateIdentity {
  readonly status: VosaStatus;
  readonly findings: readonly VosaFinding[];
}

export interface VosaGate extends GateIdentity {
  readonly pure: boolean;
  readonly description?: string;
  readonly configHash: string;

  evaluate(
    candidate: CandidateEvidenceEnvelope,
    context: GateContext,
  ): GateResult | Promise<GateResult>;
}

export interface AuditEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly pipelineId: string;
  readonly pipelineVersion: string;
  readonly mode: VosaRunMode;

  readonly candidate: CandidateIdentity;
  readonly gate: GateIdentity;
  readonly gateOrder: number;
  readonly gateConfigHash: string;

  readonly status: VosaStatus;
  readonly findings: readonly VosaFinding[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface VosaEvaluation {
  readonly candidate: CandidateIdentity;
  readonly finalStatus: VosaStatus;
  readonly gateResults: readonly GateResult[];
  readonly auditTrail: readonly AuditEvent[];
  readonly pipelineId: string;
  readonly pipelineVersion: string;
  readonly runId: string;
  readonly mode: VosaRunMode;
}

export interface RankedSurvivor<T = CandidateEvidenceEnvelope> {
  readonly rank: number;
  readonly score: number;
  readonly candidate: T;
}

export interface VosaSelection<T = CandidateEvidenceEnvelope> {
  readonly evaluations: readonly VosaEvaluation[];
  readonly ranking: readonly RankedSurvivor<T>[];
}

export type SurvivorRanker<T = CandidateEvidenceEnvelope> = (
  candidate: T,
) => number | Promise<number>;

export interface AuditSink {
  append(event: AuditEvent): void | Promise<void>;
}

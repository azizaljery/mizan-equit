import type {
  AuditEvent,
  AuditSink,
  CandidateEvidenceEnvelope,
  GateContext,
  GateResult,
  SurvivorRanker,
  VosaEvaluation,
  VosaGate,
  VosaRunMode,
  VosaSelection,
  VosaStatus,
} from "./contracts";
import type { VosaOrchestrator } from "./interface";
import { assertJsonSafe } from "./audit";

const PRECEDENCE: Readonly<Record<VosaStatus, number>> = {
  PASS: 0,
  SUSPEND: 1,
  KILL: 2,
};

export interface VosaEngineOptions {
  readonly pipelineId: string;
  readonly pipelineVersion: string;
  readonly mode?: VosaRunMode;
  readonly auditSink?: AuditSink;
  readonly now?: () => Date;
  readonly makeId?: () => string;
}

export class VosaEngine implements VosaOrchestrator {
  readonly #gates: readonly VosaGate[];
  readonly #pipelineId: string;
  readonly #pipelineVersion: string;
  readonly #mode: VosaRunMode;
  readonly #auditSink: AuditSink | undefined;
  readonly #now: () => Date;
  readonly #makeId: () => string;

  constructor(gates: readonly VosaGate[], options: VosaEngineOptions) {
    if (gates.length === 0) throw new Error("At least one VOSA gate is required");

    const identities = gates.map((gate) => `${gate.gateId}@${gate.gateVersion}`);
    if (new Set(identities).size !== identities.length) {
      throw new Error("Duplicate VOSA gate identity");
    }

    const mode = options.mode ?? "EXECUTION";
    if (mode === "AUDIT" && gates.some((gate) => !gate.pure)) {
      throw new Error("AUDIT mode permits pure read-only gates only");
    }

    this.#gates = [...gates];
    this.#pipelineId = options.pipelineId;
    this.#pipelineVersion = options.pipelineVersion;
    this.#mode = mode;
    this.#auditSink = options.auditSink;
    this.#now = options.now ?? (() => new Date());
    this.#makeId = options.makeId ?? (() => crypto.randomUUID());
  }

  async evaluate(candidate: CandidateEvidenceEnvelope): Promise<VosaEvaluation> {
    const runId = this.#makeId();
    try {
      assertJsonSafe(candidate);
    } catch (error) {
      // NaN / Infinity / unsupported values in the evidence: never rankable, never throw.
      const finding = {
        ruleId: "NON-FINITE-OR-INVALID-EVIDENCE",
        message: "Evidence envelope failed JSON-safety validation",
        observed: error instanceof Error ? error.message : String(error),
        required: "Finite, JSON-safe evidence",
      };
      const at = this.#now().toISOString();
      const gate = { gateId: "ENVELOPE_INTEGRITY", gateVersion: "1" };
      const result: GateResult = { ...gate, status: "SUSPEND", findings: [finding] };
      const integrityEvent: AuditEvent = {
        eventId: this.#makeId(),
        runId,
        pipelineId: this.#pipelineId,
        pipelineVersion: this.#pipelineVersion,
        mode: this.#mode,
        candidate: candidate.identity,
        gate,
        gateOrder: 0,
        gateConfigHash: "none",
        status: "SUSPEND",
        findings: [finding],
        startedAt: at,
        completedAt: at,
        durationMs: 0,
      };
      // The rejection itself must be auditable; a failing sink must not turn a safe SUSPEND into a crash.
      try {
        await this.#auditSink?.append(integrityEvent);
      } catch {
        /* identity itself may be non-JSON-safe; the SUSPEND result below still carries the event */
      }
      return {
        candidate: candidate.identity,
        finalStatus: "SUSPEND",
        gateResults: [result],
        auditTrail: [integrityEvent],
        pipelineId: this.#pipelineId,
        pipelineVersion: this.#pipelineVersion,
        runId,
        mode: this.#mode,
      };
    }

    const gateResults: GateResult[] = [];
    const auditTrail: AuditEvent[] = [];

    for (const [index, gate] of this.#gates.entries()) {
      const gateOrder = index + 1;
      const started = this.#now();
      const context: GateContext = {
        pipelineId: this.#pipelineId,
        pipelineVersion: this.#pipelineVersion,
        runId,
        mode: this.#mode,
        gateOrder,
      };

      let result: GateResult;
      try {
        result = await gate.evaluate(candidate, context);
        if (
          result.gateId !== gate.gateId ||
          result.gateVersion !== gate.gateVersion
        ) {
          throw new Error("Gate result identity conflict");
        }
        assertJsonSafe(result);
        if (result.status !== "PASS" && result.status !== "KILL" && result.status !== "SUSPEND") {
          throw new Error("Unknown gate status");
        }
        if (result.status === "KILL" && result.findings.length === 0) {
          // A veto without proof is not a veto: fail closed (not rankable, but not a permanent rejection).
          result = {
            gateId: gate.gateId,
            gateVersion: gate.gateVersion,
            status: "SUSPEND",
            findings: [
              {
                ruleId: "KILL-WITHOUT-PROOF",
                message: "KILL requires at least one proof finding",
                required: "findings.length >= 1",
              },
            ],
          };
        }
      } catch (error) {
        result = {
          gateId: gate.gateId,
          gateVersion: gate.gateVersion,
          status: "SUSPEND",
          findings: [
            {
              ruleId: "GATE-EXCEPTION",
              message: "Gate failed closed",
              observed: {
                name: error instanceof Error ? error.name : "UnknownError",
                message: error instanceof Error ? error.message : String(error),
              },
              required: "Successful deterministic gate evaluation",
            },
          ],
        };
      }

      const completed = this.#now();
      const event: AuditEvent = {
        eventId: this.#makeId(),
        runId,
        pipelineId: this.#pipelineId,
        pipelineVersion: this.#pipelineVersion,
        mode: this.#mode,
        candidate: candidate.identity,
        gate: { gateId: gate.gateId, gateVersion: gate.gateVersion },
        gateOrder,
        gateConfigHash: gate.configHash,
        status: result.status,
        findings: result.findings,
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: completed.getTime() - started.getTime(),
      };

      assertJsonSafe(event);
      gateResults.push(result);
      auditTrail.push(event);
      await this.#auditSink?.append(event);

      if (
        this.#mode === "EXECUTION" &&
        (result.status === "KILL" || result.status === "SUSPEND")
      ) {
        break;
      }
    }

    const finalStatus = gateResults.reduce<VosaStatus>(
      (current, result) =>
        PRECEDENCE[result.status] > PRECEDENCE[current]
          ? result.status
          : current,
      "PASS",
    );

    return {
      candidate: candidate.identity,
      finalStatus,
      gateResults,
      auditTrail,
      pipelineId: this.#pipelineId,
      pipelineVersion: this.#pipelineVersion,
      runId,
      mode: this.#mode,
    };
  }

  async select(
    candidates: readonly CandidateEvidenceEnvelope[],
    ranker: SurvivorRanker,
  ): Promise<VosaSelection> {
    const evaluations = await Promise.all(
      candidates.map((candidate) => this.evaluate(candidate)),
    );

    const survivors = candidates.filter(
      (_, index) => evaluations[index]?.finalStatus === "PASS",
    );

    const scored = await Promise.all(
      survivors.map(async (candidate) => {
        const score = Number(await ranker(candidate));
        if (!Number.isFinite(score)) {
          throw new TypeError(
            `Ranker returned a non-finite score for ${candidate.identity.candidateId}`,
          );
        }
        return { candidate, score };
      }),
    );

    scored.sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.identity.candidateId.localeCompare(
          right.candidate.identity.candidateId,
        ) ||
        left.candidate.identity.version - right.candidate.identity.version,
    );

    return {
      evaluations,
      ranking: scored.map((item, index) => ({
        rank: index + 1,
        score: item.score,
        candidate: item.candidate,
      })),
    };
  }
}

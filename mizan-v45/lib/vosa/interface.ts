import type {
  CandidateEvidenceEnvelope,
  SurvivorRanker,
  VosaEvaluation,
  VosaSelection,
} from "./contracts";

export interface VosaOrchestrator {
  evaluate(candidate: CandidateEvidenceEnvelope): Promise<VosaEvaluation>;

  select(
    candidates: readonly CandidateEvidenceEnvelope[],
    ranker: SurvivorRanker,
  ): Promise<VosaSelection>;
}

export interface EvidenceProvider<TInput = unknown> {
  readonly providerId: string;
  readonly providerVersion: string;

  collect(input: TInput): Promise<CandidateEvidenceEnvelope>;
}

export interface VosaWorkerService {
  evaluateRequest(request: Request): Promise<Response>;
}

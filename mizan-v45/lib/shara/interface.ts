import type {
  CandidateEvidenceEnvelope,
  SurvivorRanker,
  SharaEvaluation,
  SharaSelection,
} from "./contracts";

export interface SharaOrchestrator {
  evaluate(candidate: CandidateEvidenceEnvelope): Promise<SharaEvaluation>;

  select(
    candidates: readonly CandidateEvidenceEnvelope[],
    ranker: SurvivorRanker,
  ): Promise<SharaSelection>;
}

export interface EvidenceProvider<TInput = unknown> {
  readonly providerId: string;
  readonly providerVersion: string;

  collect(input: TInput): Promise<CandidateEvidenceEnvelope>;
}

export interface SharaWorkerService {
  evaluateRequest(request: Request): Promise<Response>;
}

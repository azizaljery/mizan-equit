/**
 * Mizan Source Layer contracts.
 * Compatible with Mizan current source export 2026-09-11.
 */
export type Market = 'sa' | 'us' | 'global';

export type DataType =
  | 'price'
  | 'history'
  | 'financials'
  | 'shares'
  | 'dividends'
  | 'corporateActions'
  | 'news'
  | 'filings'
  | 'sector'
  | 'index'
  | 'ownership'
  | 'governance';

export type SourceTier =
  | 'company'
  | 'exchange'
  | 'regulator'
  | 'ir'
  | 'gov'
  | 'provider'
  | 'news'
  | 'search';

export type SourceCandidate = {
  id: string;
  name: string;
  tier: SourceTier;
  market: Market;
  dataTypes: DataType[];
  /** وصفي فقط؛ الجلب الحقيقي يمر عبر endpoints.ts. */
  urlTemplate: string;
  requiresKey: boolean;
  envKeyName?: string;
  official: boolean;
  derived: boolean;
  knownDelayMinutes: number | null;
};

export type SourceRef = SourceCandidate & {
  resolvedUrl: string;
};

export type Provenance = {
  source: string;
  url: string;
  sourceTime: string | null;
  retrievedAt: string;
  official: boolean;
  derived: boolean;
  delayMinutes: number | null;
};

export type SourceHealth = {
  state: 'healthy' | 'degraded' | 'failed' | 'unknown';
  successCount: number;
  failureCount: number;
  avgLatencyMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  reliability: number;
};

export type FetchAttempt = {
  source: string;
  url: string;
  status: 'ok' | 'failed' | 'skipped';
  latencyMs: number;
  error?: string;
  reason?: string;
};

export type FetchResult<T> =
  | { state: 'ok'; value: T; provenance: Provenance; attempts: FetchAttempt[] }
  | { state: 'unavailable'; reason: string; attempts: FetchAttempt[] }
  | { state: 'failed'; reason: string; attempts: FetchAttempt[] };

export type ConflictValue<T> = {
  value: T;
  provenance: Provenance;
};

export type ConflictResult<T> = {
  hasConflict: boolean;
  values: ConflictValue<T>[];
  resolved: ConflictValue<T> | null;
  reason: string | null;
};

export type QualityGrade = 'excellent' | 'good' | 'medium' | 'weak' | 'invalid';

export type DataQuality = {
  grade: QualityGrade;
  score: number;
  reasons: string[];
};

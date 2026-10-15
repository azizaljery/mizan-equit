/**
 * Client-side resilience for idempotent requests only. Retries transient failures
 * (HTTP 502/503/504 and network errors); never 4xx and never 429. Pure: fetch, sleep
 * and randomness are injectable so it is testable without a browser or timers.
 */
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([502, 503, 504]);
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 10000;
export const DEFAULT_JITTER_RATIO = 0.25;

export type RetryEvent = {
  /** 1-based number of the retry about to be made. */
  attempt: number;
  maxRetries: number;
  delayMs: number;
  /** HTTP status of the failed attempt, or 'network' when fetch itself threw. */
  reason: number | 'network';
};

export type FetchRetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Extra random delay, as a fraction of the exponential delay (0.25 = up to +25%). */
  jitterRatio?: number;
  signal?: AbortSignal;
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  onRetry?: (event: RetryEvent) => void;
};

function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** Delay before retry number `retryIndex` (0-based): base * 2^i plus bounded jitter, capped. */
export function backoffDelay(
  retryIndex: number,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  jitterRatio = DEFAULT_JITTER_RATIO,
  random: () => number = Math.random,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
): number {
  const exp = baseDelayMs * 2 ** retryIndex;
  const r = Math.min(1, Math.max(0, random()));
  return Math.min(maxDelayMs, Math.round(exp + exp * jitterRatio * r));
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => { clearTimeout(timer); reject(abortError(signal)); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Like fetch, but retries transient failures up to `maxRetries` times. Returns the last
 * response when retries run out on a retryable status (the caller decides how to report it);
 * rethrows the last error when retries run out on network errors; throws the abort reason
 * as soon as the signal aborts (before an attempt, during a backoff sleep, or during fetch).
 */
export async function fetchWithRetry(url: string, init: RequestInit = {}, options: FetchRetryOptions = {}): Promise<Response> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES, baseDelayMs = DEFAULT_BASE_DELAY_MS, maxDelayMs = DEFAULT_MAX_DELAY_MS,
    jitterRatio = DEFAULT_JITTER_RATIO, signal = init.signal ?? undefined, onRetry,
    fetchFn = (u: string, i?: RequestInit) => fetch(u, i), sleep = abortableSleep, random = Math.random,
  } = options;
  for (let retry = 0; ; retry++) {
    if (signal?.aborted) throw abortError(signal);
    let reason: number | 'network';
    try {
      const res = await fetchFn(url, signal ? { ...init, signal } : init);
      if (!RETRYABLE_STATUS.has(res.status) || retry >= maxRetries) return res;
      reason = res.status;
      void Promise.resolve(res.body?.cancel()).catch(() => {});
    } catch (e) {
      if (signal?.aborted) throw abortError(signal);
      if (retry >= maxRetries) throw e;
      reason = 'network';
    }
    const delayMs = backoffDelay(retry, baseDelayMs, jitterRatio, random, maxDelayMs);
    onRetry?.({ attempt: retry + 1, maxRetries, delayMs, reason });
    await sleep(delayMs, signal);
  }
}

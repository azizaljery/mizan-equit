// Research-only rolling, volatility-normalized conformal calibration.
// The caller must supply immutable, genuinely issued out-of-training forecasts.
// A timestamp check cannot establish that those forecasts existed at that time.
// Serial dependence means the exchangeable split-conformal coverage theorem does
// not apply automatically; measuredCoverage is an empirical frequency only.

const SCOPE_FIELDS = ['market', 'symbol', 'horizon', 'modelVersion'];
const GUARANTEE = 'empirical_time_series_only';

function timestamp(value, field) {
  const match = typeof value === 'string' && value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) throw new Error(`${field} must be an ISO timestamp with timezone`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const [year, month, day, hour, minute, second] =
    [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const invalidZone = zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59);
  const parsed = Date.parse(value);
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
      || hour > 23 || minute > 59 || second > 59 || invalidZone || !Number.isFinite(parsed)) {
    throw new Error(`invalid ${field}`);
  }
  return parsed;
}

function validateScope(scope) {
  for (const field of ['market', 'symbol', 'modelVersion']) {
    if (typeof scope[field] !== 'string' || !scope[field].trim()) throw new Error(`invalid ${field}`);
  }
  if (!Number.isInteger(scope.horizon) || scope.horizon <= 0) throw new Error('invalid horizon');
}

function sameScope(record, scope) {
  for (const field of SCOPE_FIELDS) {
    if (record[field] !== scope[field]) throw new Error(`calibration scope mismatch: ${field}`);
  }
}

/**
 * Calibrate only on outcomes available strictly before asOf. Valid future rows
 * are ignored, including their outcome payloads. Identity/chronology violations
 * reject the request rather than silently pooling different forecasting tasks.
 * Latest maxSamples is ordered by outcome availability, then target/issue time.
 * Coverage uses only original issued bounds in this same rolling window.
 */
export function calibrateMaturedScores(issuedRecords, {
  asOf, market, symbol, horizon, modelVersion, alpha = .1, minSamples = 30, maxSamples = 252,
} = {}) {
  const scope = {market, symbol, horizon, modelVersion};
  validateScope(scope);
  const cutoff = timestamp(asOf, 'asOf');
  if (!Array.isArray(issuedRecords)) throw new Error('issuedRecords must be an array');
  if (!Number.isFinite(alpha) || !(alpha > 0 && alpha < 1)
      || !Number.isInteger(minSamples) || minSamples < 1
      || !Number.isInteger(maxSamples) || maxSamples < minSamples) {
    throw new Error('invalid calibration policy');
  }

  const seen = new Set();
  const eligible = [];
  for (const record of issuedRecords) {
    if (!record || typeof record !== 'object') throw new Error('invalid issued record');
    sameScope(record, scope);
    if (typeof record.id !== 'string' || !record.id.trim()) throw new Error('invalid forecast id');
    if (seen.has(record.id)) throw new Error('duplicate calibration forecast id');
    seen.add(record.id);
    const issued = timestamp(record.asOf, 'record.asOf');
    const target = timestamp(record.targetAt, 'record.targetAt');
    const available = timestamp(record.availableAt, 'record.availableAt');
    if (issued >= target || target > available) throw new Error('invalid forecast/outcome chronology');
    if (available >= cutoff) continue;

    if (!Number.isFinite(record.actualLogReturn) || !Number.isFinite(record.meanLogReturn)
        || !Number.isFinite(record.scale) || record.scale <= 0) {
      throw new Error('invalid matured calibration score');
    }
    const score = Math.abs(record.actualLogReturn - record.meanLogReturn) / record.scale;
    if (!Number.isFinite(score)) throw new Error('non-finite calibration score');
    const hasLower = record.lowerLogReturn != null;
    const hasUpper = record.upperLogReturn != null;
    if (hasLower !== hasUpper) throw new Error('incomplete issued interval');
    if (hasLower && (!Number.isFinite(record.lowerLogReturn) || !Number.isFinite(record.upperLogReturn)
        || record.lowerLogReturn > record.upperLogReturn)) throw new Error('invalid issued interval');
    const covered = hasLower
      ? record.actualLogReturn >= record.lowerLogReturn && record.actualLogReturn <= record.upperLogReturn
      : null;
    eligible.push({id: record.id, issued, target, available, availableAt: record.availableAt, score, covered});
  }
  eligible.sort((a, b) => a.available - b.available || a.target - b.target
    || a.issued - b.issued || a.id.localeCompare(b.id));
  const selected = eligible.slice(-maxSamples);
  const count = selected.length;
  const measured = selected.filter(row => row.covered !== null);
  const coveredCount = measured.filter(row => row.covered).length;
  const rank = Math.ceil((count + 1) * (1 - alpha));
  const base = {
    q: null, status: 'insufficient', count, alpha, asOf, ...scope,
    finiteSampleRank: rank,
    eligibleCount: eligible.length,
    calibrationIds: selected.map(row => row.id),
    latestAvailableAt: selected.at(-1)?.availableAt ?? null,
    measuredCoverage: measured.length ? coveredCount / measured.length : null,
    measuredCoverageCount: measured.length, coveredCount,
    measuredCoverageScope: 'issued_intervals_in_calibration_window',
    method: 'rolling_normalized_conformal', guarantee: GUARANTEE,
  };
  if (count < minSamples) return {...base, reason: 'insufficient_calibration_samples'};
  // Do not cap this rank at n: the honest exchangeable finite-sample bound would
  // be infinite. This research path abstains instead of emitting a finite bound.
  if (rank > count) return {...base, reason: 'insufficient_finite_sample_rank'};
  const scores = selected.map(row => row.score).sort((a, b) => a - b);
  return {...base, q: scores[rank - 1], status: 'available', reason: null};
}

/** integratedVariance is a positive horizon variance proxy supplied by the caller.
 * It need not be an unbiased estimate of the conditional variance. */
export function applyMaturedCalibration(calibration, {
  currentPrice, meanLogReturn, integratedVariance, asOf, market, symbol, horizon, modelVersion,
} = {}) {
  const scope = {market, symbol, horizon, modelVersion};
  validateScope(scope);
  if (!calibration || typeof calibration !== 'object') throw new Error('invalid calibration');
  sameScope(calibration, scope);
  if (timestamp(calibration.asOf, 'calibration.asOf') > timestamp(asOf, 'asOf')) {
    throw new Error('future calibration');
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(meanLogReturn)
      || !Number.isFinite(integratedVariance) || integratedVariance <= 0) {
    throw new Error('invalid interval request');
  }
  const base = {asOf, ...scope, alpha: calibration.alpha, guarantee: GUARANTEE};
  if (calibration.status === 'insufficient') {
    return {...base, status: 'unavailable', reason: calibration.reason};
  }
  if (calibration.status !== 'available' || !Number.isFinite(calibration.q) || calibration.q < 0) {
    throw new Error('invalid calibrated quantile');
  }
  const scale = Math.sqrt(integratedVariance);
  const width = calibration.q * scale; // No additional sqrt(horizon).
  const lowerLogReturn = meanLogReturn - width;
  const upperLogReturn = meanLogReturn + width;
  const centralPrice = currentPrice * Math.exp(meanLogReturn);
  const lowerPrice = currentPrice * Math.exp(lowerLogReturn);
  const upperPrice = currentPrice * Math.exp(upperLogReturn);
  if (![lowerLogReturn, upperLogReturn, centralPrice, lowerPrice, upperPrice].every(Number.isFinite)
      || lowerPrice <= 0 || centralPrice <= 0 || upperPrice <= 0) {
    return {...base, status: 'unavailable', reason: 'non_finite_price_interval'};
  }
  return {
    ...base, status: 'available', reason: null, q: calibration.q, scale, integratedVariance,
    meanLogReturn, lowerLogReturn, upperLogReturn, centralPrice, lowerPrice, upperPrice,
    calibrationCount: calibration.count,
    measuredCoverage: calibration.measuredCoverage,
    measuredCoverageCount: calibration.measuredCoverageCount,
  };
}

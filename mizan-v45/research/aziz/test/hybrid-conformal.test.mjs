import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calibrateMaturedScores, applyMaturedCalibration} from '../src/hybrid-conformal.mjs';

const day = n => new Date(Date.UTC(2024, 0, 1 + n)).toISOString();
const scope = {market: 'US', symbol: 'AAPL', horizon: 5, modelVersion: 'hybrid-research-v1'};
const policy = {...scope, asOf: day(100)};
const records = (n = 30) => Array.from({length: n}, (_, i) => ({
  ...scope, id: `f-${i}`, asOf: day(i), targetAt: day(i + 5), availableAt: day(i + 6),
  meanLogReturn: 0, actualLogReturn: (i + 1) / 100, scale: .01,
}));

test('conformal calibration uses the finite-sample order statistic, without mutating input', () => {
  const rows = records();
  const original = structuredClone(rows);
  rows.forEach(Object.freeze);
  Object.freeze(rows);
  const calibration = calibrateMaturedScores(rows, policy);
  assert.equal(calibration.status, 'available');
  assert.equal(calibration.count, 30);
  assert.equal(calibration.finiteSampleRank, 28);
  assert.ok(Math.abs(calibration.q - 28) < 1e-12);
  assert.equal(calibration.guarantee, 'empirical_time_series_only');
  assert.equal(calibration.measuredCoverage, null);
  assert.deepEqual(rows, original);
});

test('future and same-cutoff outcomes cannot change calibration or observed coverage', () => {
  const past = records();
  const future = {...records(1)[0], id: 'future', availableAt: day(101), actualLogReturn: 1e100,
    lowerLogReturn: -1e101, upperLogReturn: 1e101};
  const atCutoff = {...future, id: 'at-cutoff', availableAt: policy.asOf};
  assert.deepEqual(calibrateMaturedScores([...past, future, atCutoff], policy), calibrateMaturedScores(past, policy));
  // Outcome payloads are not accessed until they are available to this forecast.
  const unavailablePayload = {...future, actualLogReturn: NaN, scale: null};
  assert.deepEqual(calibrateMaturedScores([...past, unavailablePayload], policy), calibrateMaturedScores(past, policy));
});

test('market, symbol, horizon and model version are separate calibration tasks', () => {
  for (const [field, value] of Object.entries({market: 'SA', symbol: 'MSFT', horizon: 21, modelVersion: 'v2'})) {
    const rows = records();
    rows[0] = {...rows[0], [field]: value};
    assert.throws(() => calibrateMaturedScores(rows, policy), /scope mismatch/);
  }
  assert.throws(() => calibrateMaturedScores([...records(), records()[0]], policy), /duplicate/);
});

test('inadequate count and unattainable finite-sample rank abstain honestly', () => {
  const tooSmall = calibrateMaturedScores(records(29), policy);
  assert.equal(tooSmall.status, 'insufficient');
  assert.equal(tooSmall.q, null);
  const unattainable = calibrateMaturedScores(records(9), {...policy, minSamples: 1, alpha: .05});
  assert.equal(unattainable.finiteSampleRank, 10);
  assert.equal(unattainable.status, 'insufficient');
  assert.equal(unattainable.reason, 'insufficient_finite_sample_rank');
  assert.equal(unattainable.q, null);
  const applied = applyMaturedCalibration(unattainable, {...policy, currentPrice: 100, meanLogReturn: 0, integratedVariance: .04});
  assert.equal(applied.status, 'unavailable');
  assert.equal(applied.lowerPrice, undefined);
});

test('coverage is measured from issued bounds, never from retrospectively widened intervals', () => {
  const rows = records();
  rows[0] = {...rows[0], lowerLogReturn: -.1, upperLogReturn: .01}; // Inclusive endpoint, covered.
  rows[1] = {...rows[1], lowerLogReturn: -.1, upperLogReturn: .019}; // Miss.
  rows[2] = {...rows[2], lowerLogReturn: .03, upperLogReturn: .1}; // Inclusive endpoint, covered.
  const calibration = calibrateMaturedScores(rows, policy);
  assert.equal(calibration.measuredCoverage, 2 / 3);
  assert.equal(calibration.measuredCoverageCount, 3);
  assert.equal(calibration.coveredCount, 2);
  assert.notEqual(calibration.measuredCoverage, 1 - calibration.alpha);
});

test('rolling window uses availability chronology, not caller ordering or residual magnitude', () => {
  const rows = records();
  rows[0] = {...rows[0], availableAt: day(99), actualLogReturn: 1};
  const calibration = calibrateMaturedScores([...rows].reverse(), {...policy, minSamples: 5, maxSamples: 5, alpha: .2});
  assert.deepEqual(calibration.calibrationIds, ['f-26', 'f-27', 'f-28', 'f-29', 'f-0']);
  assert.equal(calibration.q, 100);
  assert.equal(calibration.eligibleCount, 30);
  assert.equal(calibration.count, 5);
  assert.equal(calibration.latestAvailableAt, day(99));
});

test('timestamps require timezone, genuine calendar dates and chronological maturation', () => {
  for (const changed of [
    {asOf: '2024-01-01T00:00:00'},
    {availableAt: '2024-02-30T00:00:00Z'},
    {availableAt: day(4)},
    {asOf: day(5)},
  ]) {
    const rows = records();
    rows[0] = {...rows[0], ...changed};
    assert.throws(() => calibrateMaturedScores(rows, policy));
  }
  assert.throws(() => calibrateMaturedScores(records(), {...policy, asOf: '2024-05-01'}));
  const zoned = records();
  zoned[0] = {...zoned[0], asOf: '2024-01-01T03:00:00+03:00'};
  assert.equal(calibrateMaturedScores(zoned, policy).count, 30);
});

test('malformed scores, incomplete bounds and reversed bounds cannot enter coverage', () => {
  for (const changed of [
    {scale: 0}, {scale: Infinity}, {meanLogReturn: NaN}, {actualLogReturn: Infinity},
    {lowerLogReturn: 0}, {lowerLogReturn: 1, upperLogReturn: 0},
  ]) {
    const rows = records();
    rows[0] = {...rows[0], ...changed};
    assert.throws(() => calibrateMaturedScores(rows, policy));
  }
});

test('application uses square root of integrated variance once and converts log endpoints to prices', () => {
  const calibration = calibrateMaturedScores(records().map(row => ({...row, actualLogReturn: .02})), policy);
  const interval = applyMaturedCalibration(calibration, {...policy, currentPrice: 100, meanLogReturn: .01, integratedVariance: .04});
  assert.equal(interval.status, 'available');
  assert.equal(interval.scale, .2);
  assert.ok(Math.abs(interval.lowerLogReturn - (-.39)) < 1e-12);
  assert.ok(Math.abs(interval.upperLogReturn - .41) < 1e-12);
  assert.ok(Math.abs(interval.lowerPrice - 100 * Math.exp(-.39)) < 1e-12);
  assert.ok(Math.abs(interval.upperPrice - 100 * Math.exp(.41)) < 1e-12);
  assert.equal(interval.guarantee, 'empirical_time_series_only');
});

test('application rejects future calibrations, scope mismatch and nonpositive variance', () => {
  const calibration = calibrateMaturedScores(records(), policy);
  const request = {...policy, currentPrice: 100, meanLogReturn: 0, integratedVariance: .01};
  for (const changed of [{asOf: day(99)}, {symbol: 'MSFT'}, {integratedVariance: 0}, {currentPrice: Infinity}]) {
    assert.throws(() => applyMaturedCalibration(calibration, {...request, ...changed}));
  }
  const extreme = applyMaturedCalibration(calibration, {...request, meanLogReturn: 1000});
  assert.equal(extreme.status, 'unavailable');
  assert.equal(extreme.reason, 'non_finite_price_interval');
});

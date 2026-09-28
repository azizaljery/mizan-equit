import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIDGE_KALMAN_ENABLED,
  buildBridgeInputs,
  createKalmanState,
  predictCorrection,
  selectEffectiveForecast,
  updateKalman,
} from '../lib/forecast-bridge-kalman.ts';

test('feature is OFF by default and preserves original output', () => {
  const p = predictCorrection({
    symbol: 'AAPL', market: 'us', asOf: '2026-09-26T00:00:00Z',
    observedThrough: '2026-09-26T00:00:00Z', remainingSessions: 16,
    earlyErrorLog: 0.01, baselineRemainingLogReturn: 0.04,
    currentPriceAtUpdate: 100,
  }, createKalmanState(), null);
  assert.equal(BRIDGE_KALMAN_ENABLED, false);
  assert.equal(p.status, 'abstained');
  assert.deepEqual(selectEffectiveForecast(105, p), { price: 105, path: 'original' });
});

test('builds the 5-to-21 bridge from log returns', () => {
  const x = buildBridgeInputs({
    symbol: 'AAPL', market: 'us',
    asOf: '2026-09-26T00:00:00Z',
    observedThrough: '2026-09-26T00:00:00Z',
    currentPriceAtUpdate: 98, actualPriceAt5: 98,
    original: {
      horizon5Price: 101, horizon21Price: 105,
      issuedAt: '2026-09-19T00:00:00Z',
      target5At: '2026-09-25T00:00:00Z',
      target21At: '2026-10-20T00:00:00Z',
      modelVersion: 'base-v1',
    },
  });
  assert.equal(x.remainingSessions, 16);
  assert.ok(Math.abs(x.earlyErrorLog - Math.log(98 / 101)) < 1e-12);
  assert.ok(Math.abs(x.baselineRemainingLogReturn - Math.log(105 / 101)) < 1e-12);
});

test('rejects data available after the as-of boundary', () => {
  assert.throws(() => buildBridgeInputs({
    symbol: 'AAPL', market: 'us',
    asOf: '2026-09-26T00:00:00Z',
    observedThrough: '2026-09-27T00:00:00Z',
    currentPriceAtUpdate: 98, actualPriceAt5: 98,
    original: {
      horizon5Price: 101, horizon21Price: 105,
      issuedAt: '2026-09-19T00:00:00Z',
      target5At: '2026-09-28T00:00:00Z',
      target21At: '2026-10-20T00:00:00Z',
      modelVersion: 'base-v1',
    },
  }), /invalid-bridge-inputs/);
});

test('Kalman update is filtered and variance remains non-negative', () => {
  const s = updateKalman(createKalmanState(), 0.2, {
    transition: 1, processVariance: 0.01, observationVariance: 0.04,
  });
  assert.ok(s.mean > 0 && s.mean < 0.2);
  assert.ok(s.variance >= 0);
  assert.equal(s.observations, 1);
});

test('Kalman state keeps version and does not smooth backwards', () => {
  const a = updateKalman(createKalmanState(0, 1, 'v1'), 0.1, {
    transition: 1, processVariance: 0.01, observationVariance: 0.04,
  });
  const b = updateKalman(a, -0.1, {
    transition: 1, processVariance: 0.01, observationVariance: 0.04,
  });
  assert.equal(b.version, 'v1');
  assert.notEqual(b.mean, a.mean);
});

test('bridge uses frozen artifact without turning Kalman gain into confidence', () => {
  const inputs = {
    symbol: 'AAPL', market: 'us' as const, asOf: '2026-09-26T00:00:00Z',
    observedThrough: '2026-09-26T00:00:00Z', remainingSessions: 16,
    earlyErrorLog: -0.02, baselineRemainingLogReturn: 0.04,
    currentPriceAtUpdate: 98,
  };
  const p = predictCorrection(inputs, updateKalman(createKalmanState(), -0.02, {
    transition: 1, processVariance: 0.01, observationVariance: 0.04,
  }), {
    version: 'bridge-artifact-1', trainedThrough: '2026-09-01T00:00:00Z',
    coefficients: { intercept: 0, earlyError: 0.25, kalmanBias: 0.5, baselineRemaining: 0.1 },
  });
  assert.equal(p.status, 'candidate');
  assert.ok(p.correctedPrice && Number.isFinite(p.correctedPrice));
  assert.equal('confidence' in p, false);
});

test('invalid artifact abstains safely', () => {
  const p = predictCorrection({
    symbol: 'AAPL', market: 'us', asOf: '2026-09-26T00:00:00Z',
    observedThrough: '2026-09-26T00:00:00Z', remainingSessions: 16,
    earlyErrorLog: 0.01, baselineRemainingLogReturn: 0.04,
    currentPriceAtUpdate: 100,
  }, createKalmanState(), {
    version: '', trainedThrough: 'bad',
    coefficients: { intercept: NaN, earlyError: 0, kalmanBias: 0, baselineRemaining: 0 },
  });
  assert.equal(p.status, 'invalid');
  assert.deepEqual(selectEffectiveForecast(105, p, true), { price: 105, path: 'original' });
});

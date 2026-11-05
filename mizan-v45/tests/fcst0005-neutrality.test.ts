import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveNeutrality, HORIZONS} from '../research/fcst0005/e0/neutrality';
// E0-b: the neutral-zone derivation must reproduce from the production equation (closed form == bisection through production code is asserted inside deriveNeutrality).
const D = deriveNeutrality();
test('signals are bounded in [-1,1] over the ensemble (input bound used by the derivation)', () => { assert.equal(D.inputBounds.withinUnit, true); assert.ok(D.inputBounds.nSeries >= 200); });
test('adjusted weights sum to 100 for every horizon', () => { for (const p of D.perHorizon) assert.ok(Math.abs(p.weightsSum - 100) < 1e-9, 'h=' + p.h); });
test('production tilt multiplier is .6 with low volume and 1 otherwise', () => { assert.equal(D.tiltMultipliers.lowVolume, 0.6); assert.equal(D.tiltMultipliers.normalVolume, 1); assert.equal(D.tiltMultipliers.unavailableVolume, 1); });
test('horizon table covers every horizon with the production thresholds', () => {
  assert.deepEqual(D.perHorizon.map(p => p.h), HORIZONS);
  assert.deepEqual(D.perHorizon.map(p => p.neutralThresholdPct), [0.1, 0.25, 0.5, 0.5, 0.5, 0.5]);
});
test('h=5: upward exit is impossible with the multiplier and needs bias >= .839 without it; downward needs <= -.841', () => {
  const r = D.perHorizon.find(p => p.h === 5)!.rows[0];
  assert.ok(r.upBias_x06 > 1 && Math.abs(r.upBias_x1 - 0.839) < 5e-4 && Math.abs(r.downBias_abs - 0.841) < 5e-4);
  assert.equal(r.upFeasible_x06_all, false); assert.equal(r.upFeasible_all, true);
});
test('up and down differ only through the multiplier and the log asymmetry (down needs slightly larger |bias| than up at x1)', () => {
  for (const p of D.perHorizon) for (const r of p.rows) { assert.ok(r.downBias_abs > r.upBias_x1); assert.ok(r.upBias_x06 > r.upBias_x1); assert.ok(Math.abs(r.upBias_x06 * 0.6 - r.upBias_x1) < 1e-12); }
});
test('price-only inputs cannot reach the h=5 bound in either direction', () => {
  const p = D.perHorizon.find(x => x.h === 5)!, r = p.rows[0];
  assert.equal(r.upFeasible_priceOnly, false); assert.equal(r.downFeasible_priceOnly, false); assert.ok(p.maxAbsBias_priceOnly < r.upBias_x1);
});

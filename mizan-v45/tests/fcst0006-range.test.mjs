import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../research/fcst0006/range-core.mjs';
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test('FCST-0006 constants are the preregistered ones', () => {
  assert.deepEqual([R.ALPHA, R.DELTA_R, R.COVER_FLOOR, R.YEAR_FLOOR, R.HAR_MIN_TRAIN, R.CONF_TARGET, R.CONF_MIN, R.CONF_MAX, R.FAMILY, R.B, R.MIN_NONOVERLAP], [0.2, 0.02, 0.78, 0.70, 500, 0.8, 30, 250, 18, 2000, 60]);
});
test('interval score: width inside, width plus 2/alpha times the miss outside', () => {
  near(R.intervalScore(-1, 1, 0), 2); near(R.intervalScore(-1, 1, 1.5), 2 + 10 * 0.5); near(R.intervalScore(-1, 1, -2), 2 + 10 * 1);
});
test('parkinson variance and floor', () => {
  near(R.parkinson(Math.E, 1), 1 / (4 * Math.LN2)); assert.equal(R.parkinson(10, 10), R.PK_FLOOR);
});
test('conformal score, exact rank quantile and asymmetric adjustment', () => {
  near(R.confScore(-1, 0, 2, 2), 1); near(R.confScore(-1, 0, 2, -0.5), 0.5); near(R.confScore(-1, 0, 2, 3), 1.5);
  assert.equal(R.confQuantile([1, 2, 3, 4]), 4);                          // rank ceil(5*0.8)=4 -> 4th value
  assert.equal(R.confQuantile([1, 2, 3]), null);                          // rank 4 > 3 -> not available
  const s = Array.from({length: 40}, (_, i) => (i + 1) / 40);                // rank ceil(41*0.8)=33 -> 33/40
  near(R.confQuantile(s), 33 / 40);
  assert.equal(R.confAdjust(-1, 0, 2, s.slice(0, 29)), null);
  const adj = R.confAdjust(-1, 0, 2, s); near(adj[0], -33 / 40); near(adj[1], 2 * 33 / 40);
});
test('HAR: null before 500 training pairs, no look-ahead, recovers a constant variance', () => {
  const v = Array.from({length: 700}, () => 4e-4), f = R.harForecaster(v, 5);
  assert.equal(f(400), null);
  const out = f(650); assert.ok(out === null || Math.abs(out.sigma - Math.sqrt(5 * 4e-4)) < 1e-6);   // collinear constant series may be singular -> null
  // look-ahead: changing values after t must not change the forecast at t
  const rnd = (() => { let a = 7; return () => (a = (a * 16807) % 2147483647) / 2147483647; })();
  const v1 = Array.from({length: 800}, () => 1e-4 * (0.5 + rnd())), v2 = v1.slice(); for (let i = 701; i < 800; i++) v2[i] = v1[i] * 9;
  const a = R.harForecaster(v1, 5)(700), b = R.harForecaster(v2, 5)(700);
  assert.ok(a && b); near(a.sigma, b.sigma, 0); assert.ok(a.sigma > 0);
});

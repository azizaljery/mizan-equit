import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signatureLevel2, buildPathSignatureFeatures, PATH_SIGNATURE_FEATURE_NAMES}
  from '../src/path-signature.mjs';

const at = n => new Date(Date.UTC(2024, 0, n + 1, 18)).toISOString();
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12,
  `expected ${actual} to be close to ${expected}`);
const makeBars = () => [100, 105, 103, 110].map((close, i) => ({
  market: 'SA', symbol: '2222', priceBasis: 'split_adjusted',
  observedAt: at(i), availableAt: at(i), close, volume: [0, 200, 120, 240][i],
}));
const options = bars => ({bars, asOf: at(3), lookback: 3,
  market: 'SA', symbol: '2222', priceBasis: 'split_adjusted'});

test('signature has the exact ordered two-segment integral and signed area', () => {
  const result = signatureLevel2([[0, 0], [1, 0], [1, 1]]);
  assert.deepEqual(result.level1, [1, 1]);
  assert.deepEqual(result.level2, [[0.5, 1], [0, 0.5]]);
  assert.deepEqual(result.areas, [[0, 0.5], [-0.5, 0]]);
  const reversedOrder = signatureLevel2([[0, 0], [0, 1], [1, 1]]);
  assert.deepEqual(reversedOrder.level1, result.level1);
  assert.equal(reversedOrder.areas[0][1], -result.areas[0][1]);
});

test('a straight segment may be subdivided or translated without changing the signature', () => {
  const direct = signatureLevel2([[0, 0], [2, 4]]);
  const subdivided = signatureLevel2([[10, -1], [10.5, 0], [11, 1], [12, 3]]);
  assert.deepEqual(subdivided, direct);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    near(direct.level2[i][j] + direct.level2[j][i], direct.level1[i] * direct.level1[j]);
  }
});

test('features only use published completed bars and do not mutate input', () => {
  const bars = makeBars(), before = structuredClone(bars);
  const expected = buildPathSignatureFeatures(options(bars));
  const future = {...bars[0], availableAt: at(4), observedAt: at(4), close: NaN, volume: -1};
  const actual = buildPathSignatureFeatures(options([...bars, future]));
  assert.deepEqual(actual, expected);
  assert.deepEqual(bars, before);
  assert.equal(actual.status, 'available');
  assert.equal(actual.sampleCount, 4);
  assert.deepEqual(Object.keys(actual.features), PATH_SIGNATURE_FEATURE_NAMES);
  for (const record of Object.values(actual.featureRecords)) assert.equal(record.availableAt, at(3));
});

test('price currency units cancel, zero volume stays finite, and no target is required', () => {
  const bars = makeBars();
  const original = buildPathSignatureFeatures(options(bars));
  const cents = buildPathSignatureFeatures(options(bars.map(bar => ({...bar, close: bar.close * 100}))));
  for (const name of PATH_SIGNATURE_FEATURE_NAMES) {
    assert.ok(Number.isFinite(original.features[name]));
    near(original.features[name], cents.features[name]);
  }
  near(original.features.sigLogReturn, Math.log(1.1));
});

test('lack of known history abstains instead of inserting zero-valued features', () => {
  const bars = makeBars();
  bars[3].availableAt = at(4);
  const result = buildPathSignatureFeatures(options(bars));
  assert.equal(result.status, 'insufficient_history');
  assert.equal(result.requiredBars, 4);
  assert.equal(result.features, null);
});

test('scope, availability, duplicate vintages and invalid observed values are rejected', () => {
  for (const patch of [
    {market: 'US'}, {symbol: 'AAPL'}, {priceBasis: 'raw'},
    {availableAt: '2024-01-01'}, {observedAt: at(4)},
    {close: 0}, {volume: -1}, {volume: NaN},
  ]) {
    const bars = makeBars();
    bars[3] = {...bars[3], ...patch};
    assert.throws(() => buildPathSignatureFeatures(options(bars)));
  }
  const bars = makeBars();
  assert.throws(() => buildPathSignatureFeatures(options([...bars, {...bars[1]}])), /duplicate/);
  assert.throws(() => signatureLevel2([[0, 1], [1]]), /dimension/);
  assert.throws(() => signatureLevel2([[0, 1], [1, Infinity]]), /coordinate/);
});

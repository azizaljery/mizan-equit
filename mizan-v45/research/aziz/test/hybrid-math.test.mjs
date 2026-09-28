import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitRobustRidge, predictRobustRidge, harFeatures, squaredReturnSum} from '../src/hybrid-math.mjs';

const near = (actual, expected, tolerance = 1e-11) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const barsForReturns = returns => {
  let close = 100;
  return [{close}, ...returns.map(value => ({close: close *= Math.exp(value)}))];
};

test('ridge matches closed form with an unpenalized intercept', () => {
  const rows = [0, 1, 2].map(x => ({x: [x], y: 5 + 2 * x}));
  const model = fitRobustRidge(rows, {lambda: 1});
  assert.deepEqual(model.medians, [1]);
  assert.deepEqual(model.scales, [1]);
  near(model.coefficients[0], 4 / 3);
  near(model.intercept, 7);
  near(predictRobustRidge(model, [0]), 17 / 3);
  near(predictRobustRidge(model, [2]), 25 / 3);
  const constant = fitRobustRidge([{x: [12], y: 3}, {x: [12], y: 9}], {lambda: 1e8});
  assert.deepEqual(constant.scales, [1]);
  near(constant.coefficients[0], 0);
  near(predictRobustRidge(constant, [12]), 6);
});

test('training type-7 scaling and model remain unchanged by extreme test inputs', () => {
  const rows = [0, 2, 4, 100].map((value, i) => ({x: [value], y: i}));
  const original = structuredClone(rows);
  rows.forEach(row => { Object.freeze(row.x); Object.freeze(row); });
  Object.freeze(rows);
  const model = fitRobustRidge(rows);
  assert.deepEqual(model.medians, [3]);
  assert.deepEqual(model.scales, [26.5]);
  const saved = structuredClone(model);
  const before = predictRobustRidge(model, [5]);
  predictRobustRidge(model, [1e9]);
  assert.equal(predictRobustRidge(model, [5]), before);
  assert.deepEqual(model, saved);
  assert.deepEqual(rows, original);
});

test('feature unit changes preserve fitted predictions, including negative orientation', () => {
  const rows = Array.from({length: 12}, (_, i) => ({x: [i, Math.sin(i)], y: 3 + 0.2 * i - Math.sin(i)}));
  const changed = rows.map(row => ({x: [1000 * row.x[0] + 20, -100 * row.x[1]], y: row.y}));
  const first = fitRobustRidge(rows, {lambda: 0.3});
  const second = fitRobustRidge(changed, {lambda: 0.3});
  near(predictRobustRidge(first, [4.5, 0.6]), predictRobustRidge(second, [4520, -60]));
});

test('pivoted QR solves collinear features and preserves target translation', () => {
  const rows = Array.from({length: 20}, (_, i) => ({x: [2 * i, i, 7], y: 0.5 * i}));
  const model = fitRobustRidge(rows, {lambda: 0.1});
  const translated = fitRobustRidge(rows.map(row => ({x: [...row.x], y: row.y + 500})), {lambda: 0.1});
  near(model.coefficients[0], model.coefficients[1]);
  near(model.coefficients[2], 0);
  near(predictRobustRidge(translated, [16, 8, 7]) - predictRobustRidge(model, [16, 8, 7]), 500);
  // All three first-order conditions: X_c'(y_c - X_c beta) = lambda beta.
  const z = rows.map(row => row.x.map((value, j) => (value - model.medians[j]) / model.scales[j]));
  const means = model.coefficients.map((_, j) => z.reduce((sum, row) => sum + row[j] / z.length, 0));
  for (let j = 0; j < 3; j++) {
    const score = rows.reduce((sum, row, i) => sum + (z[i][j] - means[j]) * (row.y - predictRobustRidge(model, row.x)), 0);
    near(score, model.lambda * model.coefficients[j], 1e-10);
  }
});

test('ridge rejects nonfinite values, holes, shape mismatches and invalid regularization', () => {
  const valid = [{x: [1, 2], y: 3}, {x: [2, 3], y: 5}];
  for (const rows of [[], [{x: [], y: 1}], [{x: [1, 2], y: 3}, {x: [1], y: 2}], [{x: [NaN], y: 0}], [{x: [1], y: Infinity}], [{x: Array(2), y: 1}], Array(2)]) {
    assert.throws(() => fitRobustRidge(rows));
  }
  for (const lambda of [0, -1, NaN, Infinity, '1']) assert.throws(() => fitRobustRidge(valid, {lambda}));
  const model = fitRobustRidge(valid);
  for (const x of [[1], [1, Infinity], [1, '2'], Array(2)]) assert.throws(() => predictRobustRidge(model, x));
  assert.throws(() => predictRobustRidge({...model, scales: [1, 0]}, [1, 2]));
});

test('HAR uses daily, five-day and 22-day means and is price-unit invariant', () => {
  const returns = Array.from({length: 22}, (_, i) => (i + 1) * 0.001);
  const bars = barsForReturns(returns);
  const actual = harFeatures(bars);
  [1, 5, 22].forEach((window, i) => {
    const sample = returns.slice(-window);
    near(actual[i], Math.log(1e-12 + sample.reduce((sum, value) => sum + value * value / window, 0)));
  });
  const converted = harFeatures(bars.map(bar => ({close: bar.close * 1000})));
  actual.forEach((value, i) => near(value, converted[i]));
  assert.deepEqual(harFeatures(Array.from({length: 23}, () => ({close: 100}))), Array(3).fill(Math.log(1e-12)));
});

test('horizon scale target sums squared session returns, including round trips', () => {
  const closes = barsForReturns([0.1, -0.1]).map(bar => bar.close);
  near(squaredReturnSum(closes), 0.02);
  near((Math.log(closes[2]) - Math.log(closes[0])) ** 2, 0);
  assert.ok(squaredReturnSum(closes) > 0);
  near(squaredReturnSum(closes.map(close => close * 100)), 0.02);
});

test('volatility features reject missing, invalid and nonpositive prices', () => {
  assert.throws(() => harFeatures(Array.from({length: 22}, () => ({close: 100}))));
  for (const close of [0, -1, NaN, Infinity, '100']) {
    assert.throws(() => harFeatures([{close}, ...Array.from({length: 23}, () => ({close: 100}))]));
    assert.throws(() => squaredReturnSum([100, close]));
  }
  assert.throws(() => harFeatures(Array(23)));
  const holeBeforeWindow = Array.from({length: 24}, () => ({close: 100}));
  delete holeBeforeWindow[0];
  assert.throws(() => harFeatures(holeBeforeWindow));
  assert.throws(() => squaredReturnSum([100]));
  assert.throws(() => squaredReturnSum(Array(3)));
});

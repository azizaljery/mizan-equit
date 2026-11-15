import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), I = m.indicatorsExtra;
const bar = (date, high, low, close, volume = 100) => ({date, open: close, high, low, close, volume});
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

test('OBV: signed running volume, equal close adds nothing, bad bar breaks the chain', () => {
  const p = [10, 11, 10, 10, 12].map((c, i) => bar('d' + i, c, c, c, [100, 200, 150, 50, 300][i]));
  assert.deepEqual(I.obv(p), [0, 200, 50, 50, 350]);
  const q = [...p]; q[2] = {...q[2], volume: NaN};
  assert.deepEqual(I.obv(q).slice(0, 3), [0, 200, null]); assert.equal(I.obv(q)[3], null);
});

test('Stochastic: fastK/slowK/slowD by hand, flat range is null not 50', () => {
  const p = [bar('1', 12, 8, 10), bar('2', 13, 9, 12), bar('3', 14, 10, 11), bar('4', 15, 11, 15), bar('5', 16, 12, 12)];
  const s = I.stochastic(p, 3, 2, 2);
  assert.equal(s.fastK[1], null);
  near(s.fastK[2], 100 * (11 - 8) / (14 - 8));            // window 1..3: HH 14, LL 8
  near(s.fastK[3], 100 * (15 - 9) / (15 - 9));            // window 2..4: HH 15, LL 9 -> 100
  near(s.fastK[4], 100 * (12 - 10) / (16 - 10));
  near(s.slowK[3], (50 + 100) / 2); near(s.slowD[4], (s.slowK[3] + s.slowK[4]) / 2);
  const flat = I.stochastic([bar('a', 5, 5, 5), bar('b', 5, 5, 5), bar('c', 5, 5, 5)], 3, 1, 1);
  assert.equal(flat.fastK[2], null);
});

test('Ichimoku: midpoints, no look-ahead, cloud is the value drawn 26 bars later', () => {
  const p = Array.from({length: 12}, (_, i) => bar('d' + i, 20 + i, 10 + i, 15 + i));
  const k = I.ichimoku(p, 2, 3, 4, 2);
  near(k.tenkan[1], (21 + 10) / 2);                         // bars 0..1: HH 21, LL 10
  near(k.kijun[2], (22 + 10) / 2);
  assert.equal(k.kijun[1], null); near(k.senkouA[2], (k.tenkan[2] + k.kijun[2]) / 2);
  near(k.senkouB[3], (23 + 10) / 2);
  assert.equal(k.cloudA[1], null); near(k.cloudA[5], k.senkouA[3]); near(k.cloudB[5], k.senkouB[3]);
  assert.equal(k.position[1], null);
  // price far above an older, lower cloud
  const up = I.ichimoku([...p, bar('x', 200, 190, 195)], 2, 3, 4, 2);
  assert.equal(up.position[12], 'above');
  const down = I.ichimoku([...p, bar('y', 5, 1, 2)], 2, 3, 4, 2);
  assert.equal(down.position[12], 'below');
  // changing a LATER bar never changes an earlier value
  const p2 = p.map((b, i) => i === 11 ? bar('z', 999, 1, 500) : b), k2 = I.ichimoku(p2, 2, 3, 4, 2);
  assert.deepEqual(k.tenkan.slice(0, 11), k2.tenkan.slice(0, 11));
});

test('Fibonacci: up swing measured down from the high, down swing measured up from the low, flat/short windows are null', () => {
  const up = [bar('1', 110, 100, 105), bar('2', 150, 120, 140), bar('3', 200, 170, 190), bar('4', 195, 160, 170)];
  const f = I.fibonacci(up, 4);
  assert.equal(f.direction, 'up'); assert.equal(f.high, 200); assert.equal(f.low, 100);
  const by = Object.fromEntries(f.levels.map(l => [l.ratio, l.price]));
  near(by[0], 200); near(by[0.236], 176.4); near(by[0.382], 161.8); near(by[0.5], 150); near(by[0.618], 138.2); near(by[0.786], 121.4); near(by[1], 100);
  const down = [bar('1', 200, 170, 190), bar('2', 150, 120, 140), bar('3', 110, 100, 105)];
  const d = I.fibonacci(down, 3); assert.equal(d.direction, 'down'); near(d.levels.find(l => l.ratio === 0.5).price, 150); near(d.levels.find(l => l.ratio === 0).price, 100);
  assert.equal(I.fibonacci(up, 10), null);
  assert.equal(I.fibonacci([bar('1', 5, 5, 5), bar('2', 5, 5, 5)], 2), null);
});

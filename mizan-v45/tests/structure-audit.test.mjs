import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), S = m.structureAudit;
const bar = (date, high, low, close, volume = 100) => ({date, open: close, high, low, close, volume});
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

test('pivots: strict swing highs/lows, confirmed k bars later', () => {
  const highs = [1, 3, 2, 4, 2, 5, 1];
  const p = highs.map((h, i) => bar('d' + i, h, h - 0.5, h));
  const pv = S.pivots(p, 1);
  assert.deepEqual(pv.map(x => x.type), ['high', 'low', 'high', 'low', 'high']);
  assert.deepEqual(pv.map(x => x.price), [3, 1.5, 4, 1.5, 5]);
  assert.deepEqual(pv.map(x => x.confirmedAt), [2, 3, 4, 5, 6]);
});

test('Elliott impulse: valid up and down counts pass every hard rule', () => {
  const up = S.elliottImpulseAudit([10, 20, 15, 35, 28, 45], 'up');
  assert.equal(up.valid, true); assert.equal(up.rules.length, 4);
  const down = S.elliottImpulseAudit([100, 90, 95, 75, 82, 55], 'down');
  assert.equal(down.valid, true);
  assert.equal(S.elliottImpulseAudit([1, 2, 3], 'up'), null);
});

test('Elliott impulse: each hard rule fails on its own violation', () => {
  const r = (pts) => S.elliottImpulseAudit(pts, 'up');
  const a = r([10, 20, 9, 35, 28, 45]);
  assert.equal(a.valid, false); assert.equal(a.rules.find(x => x.id === 'W-031').passed, false);
  const b = r([10, 20, 15, 22, 21, 45]);
  assert.equal(b.rules.find(x => x.id === 'W-032').passed, false);
  assert.equal(b.rules.find(x => x.id === 'W-031').passed, true);
  const c = r([10, 20, 15, 35, 18, 45]);
  assert.equal(c.rules.find(x => x.id === 'W-033').passed, false);
  assert.match(c.note, /W-034/);
  const d = r([10, 20, 25, 35, 28, 45]);
  assert.equal(d.rules.find(x => x.id === 'W-030').passed, false);
});

const base = () => Array.from({length: 46}, (_, i) => bar('d' + i, 108, 102, i % 2 ? 106 : 104));
test('Wyckoff: insufficient data and non-range return no events', () => {
  assert.equal(S.wyckoffAudit(base().slice(0, 20)).status, 'insufficient_data');
  const wide = Array.from({length: 46}, (_, i) => bar('d' + i, 140, 100, 120));
  const w = S.wyckoffAudit(wide);
  assert.equal(w.range.isRange, false); assert.equal(w.events.length, 0);
});

test('Wyckoff: spring is a pierce below the range that closes back inside', () => {
  const p = base();
  for (let i = 0; i <= 40; i++) p[i] = bar('d' + i, 110, 100, i % 2 ? 106 : 104);
  p[43] = bar('d43', 108, 98, 103);
  const w = S.wyckoffAudit(p);
  assert.equal(w.range.high, 110); assert.equal(w.range.low, 100); near(w.range.widthPct, 100 * 10 / 105);
  assert.equal(w.events.length, 1);
  const e = w.events[0];
  assert.equal(e.name, 'Spring'); assert.equal(e.index, 43);
  near(e.evidence.penetrationPct, 2); near(e.evidence.volumeRatio, 1);
  assert.equal(e.evidence.closeBackInside, 'same_bar');
});

test('Wyckoff: SOS needs a close above the range on 1.5x volume held next bar', () => {
  const p = base();
  for (let i = 0; i <= 40; i++) p[i] = bar('d' + i, 110, 100, i % 2 ? 106 : 104);
  p[44] = bar('d44', 113, 105, 112, 200);
  p[45] = bar('d45', 114, 108, 113, 100);
  const w = S.wyckoffAudit(p);
  assert.deepEqual(w.events.map(x => x.name), ['SOS']);
  near(w.events[0].evidence.volumeRatio, 2);
  p[45] = bar('d45', 114, 105, 109, 100); // not held
  assert.deepEqual(S.wyckoffAudit(p).events.map(x => x.name), ['Upthrust']); // failed breakout is an upthrust, not an SOS
});

test('Wyckoff: effort-vs-result = high volume with a small move', () => {
  const p = base();
  for (let i = 0; i <= 40; i++) p[i] = bar('d' + i, 110, 100, i % 2 ? 106 : 104);
  p[45] = bar('d45', 108, 102, 104.5, 250);
  const w = S.wyckoffAudit(p);
  assert.equal(w.effortResult.id, 'W-025');
  near(w.effortResult.evidence.volumeRatio, 2.5); near(w.effortResult.evidence.moveRatio, 0.25);
  p[45] = bar('d45', 108, 102, 104.5, 150);
  assert.equal(S.wyckoffAudit(p).effortResult, null);
});

test('hypothesis: fixed fingerprint, validated inputs, resolved only on later bars', () => {
  const mk = (z) => S.registerHypothesis({symbol: 'X', kind: 'breakout_up', zone: z, confirmWithinBars: 5, invalidationPrice: 98, createdAt: '2026-01-01'});
  const h = mk({low: 100, high: 110});
  assert.equal(h.fingerprint, mk({low: 100, high: 110}).fingerprint);
  assert.notEqual(h.fingerprint, mk({low: 100, high: 111}).fingerprint);
  assert.equal(S.registerHypothesis({symbol: 'X', kind: 'breakout_up', zone: {low: 100, high: 110}, confirmWithinBars: 5, invalidationPrice: 115, createdAt: 'x'}), null);
  assert.equal(S.registerHypothesis({symbol: 'X', kind: 'breakout_up', zone: {low: 110, high: 100}, confirmWithinBars: 5, invalidationPrice: 98, createdAt: 'x'}), null);
  const c = (...v) => v.map((x, i) => bar('a' + i, x, x, x));
  assert.equal(S.resolveHypothesis(h, c(105, 111)), 'confirmed');
  assert.equal(S.resolveHypothesis(h, c(98, 111)), 'invalidated');
  assert.equal(S.resolveHypothesis(h, c(105)), 'open');
  assert.equal(S.resolveHypothesis(h, c(105, 106, 107, 105, 106)), 'expired');
});

import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), T = m.transmission;
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const series = (lastMove, gapMove = 0, lastVol = 100) => {
  const p = []; let c = 100;
  for (let i = 0; i < 70; i++) {
    if (i === 0) { p.push({date: 'd0', open: c, high: c, low: c, close: c, volume: 100}); continue; }
    const prev = c;
    if (i === 69) { c = prev * (1 + lastMove); p.push({date: 'd69', open: prev * (1 + gapMove), high: Math.max(c, prev), low: Math.min(c, prev), close: c, volume: lastVol}); }
    else { c = prev * (1 + (i % 2 ? 0.01 : -0.01)); p.push({date: 'd' + i, open: prev, high: Math.max(c, prev), low: Math.min(c, prev), close: c, volume: 100}); }
  }
  return p;
};
test('reaction: z-score, gap and volume against the stock\'s own baseline', () => {
  const r = T.reactionAudit(series(0.05, 0.06, 300));
  near(r.returnPct, 5); near(r.zScore, 5); near(r.gapPct, 6); near(r.volumeRatio, 3); assert.equal(r.abnormal, true);
  near(r.baselineSdPct, 1); near(r.band.highPct, 2);
  const n = T.reactionAudit(series(0.005));
  near(n.zScore, 0.5); near(n.gapPct, 0); assert.equal(n.abnormal, false);
  assert.equal(T.reactionAudit(series(0.005).slice(0, 30)), null);
});
test('reaction vs expectation', () => {
  assert.equal(T.reactionVsExpected(5, 1), 'as_expected');
  assert.equal(T.reactionVsExpected(5, -1), 'opposite');
  assert.equal(T.reactionVsExpected(0.5, 1), 'no_reaction');
  assert.equal(T.reactionVsExpected(null, 1), 'unknown');
});
test('causal map: declared graph has no zero-lag cycle; a zero-lag cycle is reported', () => {
  assert.deepEqual(T.validateGraph(), []);
  const e = (from, to, lag) => ({from, to, sign: 1, lagMin: lag, lagMax: lag, mechanism: '', data: ''});
  assert.ok(T.validateGraph([e('a', 'b', 0), e('b', 'a', 0)]).length > 0);
  assert.deepEqual(T.validateGraph([e('a', 'b', 1), e('b', 'a', 1)]), []);
});
test('propagation: single path gives a sign and lag range', () => {
  const r = T.propagate('fed_funds', 1), by = Object.fromEntries(r.map(x => [x.node, x]));
  assert.equal(r.length, 2);
  assert.equal(by.discount_rate.sign, 1); assert.equal(by.valuation.sign, -1);
  assert.deepEqual([by.valuation.lagMin, by.valuation.lagMax], [0, 30]);
});
test('propagation: opposing paths are ambiguous, never forced', () => {
  const by = Object.fromEntries(T.propagate('brent', 1).map(x => [x.node, x]));
  assert.equal(by.inputs.sign, 1); assert.equal(by.cost.sign, 1); assert.equal(by.pricing.sign, 1);
  assert.equal(by.margin.ambiguous, true); assert.equal(by.margin.sign, 0);
  assert.deepEqual([by.margin.lagMin, by.margin.lagMax], [0, 270]);
  assert.equal(by.valuation.ambiguous, true); assert.equal(by.valuation.lagMax, 360);
  assert.deepEqual([by.pricing.lagMin, by.pricing.lagMax], [30, 240]);
});
test('transmission check: match, mismatch, not observed, ambiguous', () => {
  const v = Object.fromEntries(T.transmissionCheck(T.propagate('fed_funds', 1), {valuation: -1, discount_rate: -1}).map(x => [x.node, x.verdict]));
  assert.equal(v.valuation, 'match'); assert.equal(v.discount_rate, 'mismatch');
  assert.equal(T.transmissionCheck(T.propagate('fed_funds', 1), {})[0].verdict, 'not_observed');
  assert.equal(T.transmissionCheck(T.propagate('brent', 1), {margin: 1}).find(x => x.node === 'margin').verdict, 'ambiguous');
});

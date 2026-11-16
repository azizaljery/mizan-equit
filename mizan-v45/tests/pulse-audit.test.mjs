import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), P = m.pulseAudit;
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

test('pulse components: z of the latest change, acceleration, persistence, age', () => {
  const r = P.pulseComponents([10, 11, 13, 14, 16, 22], {window: 4, minDiffs: 4});
  assert.equal(r.direction, 1); assert.equal(r.change, 6);
  near(r.standardizedChange, 9); near(r.acceleration, 4);
  assert.equal(r.surprise, true); assert.equal(r.persistence, 5); assert.equal(r.ageSameValueBars, 1); assert.equal(r.baselineDiffs, 4);
});
test('pulse components: flat baseline gives no z; missing data gives null, never a guess', () => {
  assert.equal(P.pulseComponents([10, 11, 12, 13, 14, 20], {window: 4, minDiffs: 4}).standardizedChange, null);
  assert.equal(P.pulseComponents([1, 2, 3], {window: 4, minDiffs: 4}), null);
  assert.equal(P.pulseComponents([10, 11, 13, null, 16, 22], {window: 4, minDiffs: 4}), null);
  assert.equal(P.pulseComponents([5, 5, 5, 5, 5, 5, 5], {window: 4, minDiffs: 4}).ageSameValueBars, 7);
});
const ev = (id, direction, weight) => ({id, direction, weight});
test('decision state: insufficient evidence abstains', () => {
  const s = P.decisionState([ev('a', 1, 0.5), ev('b', 1, 0.3)]);
  assert.equal(s.state, 'ABSTAIN'); assert.equal(s.reason, 'insufficient_evidence');
});
test('decision state: heavy evidence on both sides is a CONTRADICTION that shows both hypotheses', () => {
  const s = P.decisionState([ev('a', 1, 0.9), ev('b', -1, 0.85)]);
  assert.equal(s.state, 'CONTRADICTION'); near(s.hypotheses.up.weight, 0.9); assert.deepEqual(s.hypotheses.down.items, ['b']);
});
test('decision state: edge below sensitivity abstains; otherwise a direction with its margin', () => {
  const e = P.decisionState([ev('a', 1, 0.65), ev('b', -1, 0.55)]);
  assert.equal(e.state, 'ABSTAIN'); assert.equal(e.reason, 'edge_below_sensitivity'); near(e.margin, 0.1 / 1.2);
  const up = P.decisionState([ev('a', 1, 0.6), ev('b', 1, 0.5), ev('c', -1, 0.5)]);
  assert.equal(up.state, 'UP'); near(up.margin, 0.6 / 1.6);
  const dn = P.decisionState([ev('a', -1, 0.7), ev('b', -1, 0.6), ev('c', 1, 0.2), ev('z', 0, 5)]);
  assert.equal(dn.state, 'DOWN'); near(dn.margin, 1.1 / 1.5);
});
test('decision state: an active veto wins and is named; data conflicts reduce confidence', () => {
  const items = [ev('a', 1, 0.6), ev('b', 1, 0.5), ev('c', -1, 0.5)];
  const v = P.decisionState(items, {vetoes: [{id: 'liq', reason: 'x', active: false}, {id: 'halt', reason: 'y', active: true}], dataConflicts: 1});
  assert.equal(v.state, 'VETO'); assert.deepEqual(v.vetoes, ['halt']); assert.equal(v.confidenceReduced, true);
  assert.equal(P.decisionState(items, {vetoes: [{id: 'liq', reason: 'x', active: false}]}).state, 'UP');
});
test('data conflict: relative gap above 1% or a unit difference; period difference is named', () => {
  assert.equal(P.dataConflict({value: 1}, {value: 1.005}).conflict, false);
  const c = P.dataConflict({value: 100, period: 'FY2024'}, {value: 120, period: 'FY2023'});
  assert.equal(c.conflict, true); near(c.relativeGap, 20 / 120); assert.equal(c.periodDiffers, true); assert.equal(c.unitDiffers, false);
  assert.equal(P.dataConflict({value: 100, unit: 'SAR'}, {value: 100, unit: 'kSAR'}).conflict, true);
  assert.equal(P.dataConflict({value: NaN}, {value: 1}), null);
});
test('experimental label lists the missing fields', () => {
  assert.deepEqual(P.experimentalLabel({sample: 'n=120', period: '2020-2024', method: 'walk-forward', limits: 'one market'}), {complete: true, missing: []});
  assert.deepEqual(P.experimentalLabel({sample: 'n=120', period: ' '}).missing, ['period', 'method', 'limits']);
});

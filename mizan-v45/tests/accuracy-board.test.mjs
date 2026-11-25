import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), A = m.accuracyBoard;
const cell = (o) => ({ engine: 'E', market: 'sa', horizon: 5, date: '2026-11-01', signal: 'up', resolved: true, n: 1, ups: 0, ...o });
test('hits, resolved, matched base rate and lift are computed on the same dates', () => {
  const cells = [cell({ n: 10, ups: 6, date: 'd1' }), cell({ n: 10, ups: 4, date: 'd2' })];
  const uni = [{ market: 'sa', horizon: 5, date: 'd1', n: 100, ups: 50 }, { market: 'sa', horizon: 5, date: 'd2', n: 100, ups: 30 }];
  const [r] = A.buildBoard(cells, uni, () => 'universe');
  assert.equal(r.upResolved, 20); assert.equal(r.upHits, 10); assert.equal(r.upHitRate, 0.5);
  assert.equal(r.baseRate, 0.4);                                   // (10*0.5 + 10*0.3) / 20
  assert.ok(Math.abs(r.lift - 0.1) < 1e-12); assert.equal(r.dates, 2); assert.equal(r.small, true);
});
test('dates without a base rate are left out of both sides, never filled', () => {
  const cells = [cell({ n: 10, ups: 10, date: 'd1' }), cell({ n: 10, ups: 0, date: 'dX' })];
  const [r] = A.buildBoard(cells, [{ market: 'sa', horizon: 5, date: 'd1', n: 10, ups: 5 }], () => 'universe');
  assert.equal(r.upResolved, 20); assert.equal(r.baseCovered, 10); assert.equal(r.baseRate, 0.5); assert.equal(r.lift, 0.5);
});
test('signal share and pending count come from all records of the engine', () => {
  const cells = [cell({ n: 3, ups: 1 }), cell({ signal: 'down', n: 2, ups: 1 }), cell({ signal: 'none', n: 5, ups: 2 }), cell({ signal: 'unknown', resolved: false, n: 4, ups: 0 })];
  const [r] = A.buildBoard(cells, [], () => 'self');
  assert.equal(r.records, 14); assert.equal(r.resolved, 10); assert.equal(r.pending, 4);
  assert.equal(r.withSignal, 5); assert.equal(r.signalShare, 0.5);  // 5 of the 10 whose signal is known
  assert.equal(r.downResolved, 2); assert.equal(r.downHits, 1);
});
test('self base uses all resolved rows of the engine on the same date, any signal', () => {
  const cells = [cell({ n: 4, ups: 4, date: 'd' }), cell({ signal: 'none', n: 4, ups: 0, date: 'd' })];
  const [r] = A.buildBoard(cells, [], () => 'self');
  assert.equal(r.baseRate, 0.5); assert.equal(r.upHitRate, 1); assert.equal(r.lift, 0.5);
});
test('small samples are flagged and engines/markets/horizons stay separate rows', () => {
  const cells = [cell({}), cell({ market: 'us' }), cell({ horizon: 21 }), cell({ engine: 'F' })];
  const rows = A.buildBoard(cells, [], () => 'self');
  assert.equal(rows.length, 4); assert.ok(rows.every(r => r.small && r.note.includes('عينة صغيرة')));
  assert.equal(A.NO_SIGNAL_PCT, 0.15);
});

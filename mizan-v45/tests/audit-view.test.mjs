import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), A = m.auditView;
const day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const rising = (n = 300) => Array.from({length: n}, (_, i) => { const c = 100 + i * 0.5; return {date: day(i), open: c, high: c + 1, low: c - 1, close: c, volume: 100 + i}; });

test('steady uptrend: four declared evidence rules agree and the state is UP', () => {
  const p = rising(), r = A.buildAudit(p, day(299));
  const ids = r.evidence.map(e => e.id);
  for (const id of ['ichimoku', 'obv', 'trend', 'mom6']) assert.ok(ids.includes(id), id);
  assert.ok(r.evidence.every(e => e.direction === 1 && e.weight === 0.5));
  assert.equal(r.decision.state, 'UP'); assert.equal(r.asOf, day(299)); assert.equal(r.bars, 300);
  assert.equal(r.vetoes.every(v => v.active === false), true);
});
test('stale prices veto the decision and name the reason', () => {
  const r = A.buildAudit(rising(), day(299 + 10));
  assert.equal(r.decision.state, 'VETO'); assert.deepEqual(r.decision.vetoes, ['stale_prices']);
});
test('thin history vetoes; every evidence row carries its rule text', () => {
  const r = A.buildAudit(rising(100), day(99));
  assert.ok(r.decision.vetoes.includes('thin_history'));
  assert.ok(A.buildAudit(rising(), day(299)).evidence.every(e => e.rule.length > 0 && e.label.length > 0));
});

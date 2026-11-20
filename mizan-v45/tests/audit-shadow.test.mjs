import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), S = m.auditShadow;
function bars(n, f) { const out = []; let t = Date.parse('2025-01-01T00:00:00Z'), c = 100; while (out.length < n) { const d = new Date(t); t += 86400000; if (d.getUTCDay() % 6 === 0) continue; c = f(out.length, c); out.push({ date: d.toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 }); } return out; }
test('shadow row records the state with the price known on that session', () => {
  const p = bars(200, (i, c) => c * 1.002), r = S.shadowRow('AAA', p, p[199].date);
  assert.equal(r.asof, p[199].date); assert.equal(r.price, p[199].close); assert.equal(r.id, 'AAA|' + p[199].date);
  assert.ok(['UP', 'DOWN', 'ABSTAIN', 'CONTRADICTION', 'VETO'].includes(r.state));
});
test('too little history gives no row', () => { const p = bars(40, (i, c) => c); assert.equal(S.shadowRow('A', p, p[39].date), null); });
test('outcomes resolve only when the future bar exists, and never twice', () => {
  const p = bars(260, (i, c) => c * 1.001), row = S.shadowRow('A', p.slice(0, 200), p[199].date);
  const o = S.resolveOutcomes([row], p, new Set());
  assert.deepEqual(o.map(x => x.horizon).sort((a, b) => a - b), [5, 21]);
  assert.equal(o[0].up, 1);
  const early = S.resolveOutcomes([row], p.slice(0, 203), new Set());
  assert.equal(early.length, 0);
  assert.equal(S.resolveOutcomes([row], p, new Set([row.id + '|5', row.id + '|21'])).length, 0);
});
test('summary reports small samples as not enough and never invents a rate', () => {
  const rows = [{ id: 'A|1', state: 'UP' }, { id: 'B|1', state: 'DOWN' }, { id: 'C|1', state: 'ABSTAIN' }];
  const outs = [{ shadow_id: 'A|1', horizon: 5, up: 1 }, { shadow_id: 'B|1', horizon: 5, up: 0 }, { shadow_id: 'C|1', horizon: 5, up: 1 }];
  const s = S.summarize(rows, outs);
  const up5 = s.stats.find(x => x.horizon === 5 && x.group === 'UP');
  assert.equal(up5.resolved, 1); assert.equal(up5.enough, false);
  assert.equal(s.stats.find(x => x.horizon === 21 && x.group === 'UP').upRate, null);
  assert.equal(s.baseline[0].resolved, 3);
});

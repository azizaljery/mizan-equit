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
  p[45] = bar('d45', 109.5, 105, 109, 100); // not held
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

// ---- batch 2 ----
const sellSeries = () => {
  const p = Array.from({length: 60}, (_, i) => bar('d' + i, 52, 48, 50, 100));
  p[47] = bar('d47', 50, 48, 49, 180);
  p[50] = bar('d50', 49, 40, 41, 300);
  p[51] = bar('d51', 47, 41, 46, 150);
  p[52] = bar('d52', 50, 44, 49, 100);
  p[53] = bar('d53', 51, 47, 48, 100);
  p[54] = bar('d54', 48, 46, 47, 100);
  p[55] = bar('d55', 47, 45, 46, 100);
  p[56] = bar('d56', 45, 41, 43, 120);
  for (const i of [57, 58, 59]) p[i] = bar('d' + i, 46, 44, 45, 100);
  return p;
};
test('SC with PS, AR and ST as numeric stages', () => {
  const r = S.wyckoffClimaxes(sellSeries());
  assert.equal(r.length, 1);
  const x = r[0];
  assert.equal(x.side, 'sell'); assert.equal(x.climax.name, 'SC'); assert.equal(x.climax.index, 50); assert.equal(x.confirmedAt, 51);
  assert.equal(x.ps.index, 47); near(x.ps.evidence.volumeRatio, 1.8);
  assert.equal(x.ar.index, 53); near(x.ar.evidence.moveInClimaxRanges, 10 / 9);
  assert.equal(x.st.index, 56); near(x.st.evidence.volumeVsClimax, 0.4);
});
test('BC mirror: same indices on the reflected series', () => {
  const p = sellSeries().map(b => bar(b.date, 100 - b.low, 100 - b.high, 100 - b.close, b.volume));
  const r = S.wyckoffClimaxes(p);
  assert.equal(r.length, 1);
  assert.equal(r[0].side, 'buy'); assert.equal(r[0].climax.name, 'BC');
  assert.deepEqual([r[0].ps.index, r[0].ar.index, r[0].st.index], [47, 53, 56]);
  assert.equal(r[0].ps.name, 'PSY');
});
test('no climax without extreme volume, and none without a rebound', () => {
  const p = sellSeries(); p[50] = bar('d50', 49, 40, 41, 150);
  assert.equal(S.wyckoffClimaxes(p).length, 0);
  const q = sellSeries(); q[51] = bar('d51', 42, 40.5, 41.5, 150); q[52] = q[53] = q[54] = q[55] = bar('x', 42, 40.5, 41.5, 100);
  assert.equal(S.wyckoffClimaxes(q).length, 0);
});
test('LPS / LPSY / Test / UTAD follow-ups', () => {
  const b = (h, l, c, v) => bar('x', h, l, c, v);
  const lps = [b(115, 108, 114, 200), b(112, 105, 106, 100), b(116, 111, 115, 120)];
  const e = S.lpsAfterSos(lps, 0, 110, 100); assert.equal(e.index, 2); near(e.evidence.volumeVsSos, 0.6);
  assert.equal(S.lpsAfterSos([lps[0], b(118, 114, 117, 100)], 0, 110, 100), null);
  const lpsy = [b(95, 85, 86, 200), b(98, 92, 93, 150)];
  assert.equal(S.lpsyAfterSow(lpsy, 0, 110, 100).index, 1);
  assert.equal(S.lpsyAfterSow([lpsy[0], b(95, 90, 91, 150)], 0, 110, 100), null);
  const sp = [b(103, 98, 102, 200), b(104, 99, 103, 100)];
  assert.equal(S.testAfterSpring(sp, 0, 100, 110).index, 1);
  assert.equal(S.testAfterSpring([sp[0], b(104, 99, 103, 150)], 0, 100, 110), null);
  const ut = [b(112, 106, 108, 100), b(110, 106, 108, 100), b(107, 102, 104, 100)];
  assert.equal(S.utadConfirm(ut, 0, 100, 110).index, 2);
  assert.equal(S.utadConfirm(ut.slice(0, 2), 0, 100, 110), null);
});
test('correction audit: zigzag, flat, expanded flat, unclassified, invalid', () => {
  assert.equal(S.correctionAudit([100, 80, 92, 70], 'down').label, 'zigzag');
  assert.equal(S.correctionAudit([100, 80, 99, 81], 'down').label, 'flat');
  assert.equal(S.correctionAudit([100, 80, 105, 75], 'down').label, 'expanded_flat');
  assert.equal(S.correctionAudit([100, 80, 90, 85], 'down').label, 'unclassified');
  assert.equal(S.correctionAudit([100, 80, 70, 60], 'down').valid, false);
  assert.equal(S.correctionAudit([100, 120, 108, 130], 'up').label, 'zigzag');
  near(S.correctionAudit([100, 80, 92, 70], 'down').bRetracement, 0.6);
});
test('extension, alternation and diagonal audits', () => {
  const x = S.extensionAudit([10, 20, 15, 35, 28, 45]);
  assert.deepEqual(x.lengths, [10, 20, 17]); assert.equal(x.longestWave, 3); near(x.ratioToNext, 20 / 17); assert.equal(x.extended, false);
  assert.equal(S.extensionAudit([10, 20, 15, 55, 50, 60]).extended, true);
  const a = S.alternationAudit([10, 20, 15, 35, 28, 45], [0, 5, 8, 15, 20, 30]);
  near(a.depth2, 0.5); near(a.depth4, 0.35); assert.equal(a.depthDiffers, false); assert.equal(a.timeDiffers, true); assert.equal(a.alternates, true);
  assert.equal(S.diagonalCandidate([10, 20, 14, 22, 17, 23], 'up').candidate, true);
  assert.equal(S.diagonalCandidate([10, 20, 15, 35, 28, 45], 'up').candidate, false);
});
test('retest: first return to the level, held or failed', () => {
  const b = (h, l, c, v) => bar('x', h, l, c, v);
  const up = [b(104, 100, 103, 200), b(110, 105, 108, 100), b(104, 100.5, 103, 100)];
  const r = S.retestAudit(up, 0, 100, 'up'); assert.equal(r.index, 2); assert.equal(r.result, 'held'); near(r.volumeVsBreak, 0.5);
  assert.equal(S.retestAudit([up[0], up[1], b(104, 100.5, 99, 100)], 0, 100, 'up').result, 'failed');
  const down = [b(100, 96, 97, 200), b(98, 94, 95, 100), b(99.5, 95, 98, 100)];
  assert.equal(S.retestAudit(down, 0, 100, 'down').result, 'held');
  assert.equal(S.retestAudit([up[0], up[1]], 0, 100, 'up'), null);
});

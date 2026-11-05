import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTruncated, CUTOFF} from '../research/fcst0005/dev-input-guard.mjs';
const mk = (rows, trailer = '') => '{"symbol":"T.SR","currency":"SAR","rows":[' + rows.map(r => JSON.stringify(r)).join(',') + ']' + trailer + '}';
const R = (d, c = 10, v = 100) => [d, c, c, c, c, v];
test('rows after the cutoff are never returned, and never change the digest', () => {
  const a = mk([R('2024-09-02'), R('2024-09-03'), R('2024-09-04')]);
  const b = mk([R('2024-09-02'), R('2024-09-03'), R('2024-09-04'), R('2024-09-05', 999), R('2024-09-06', 1e9)]);
  const A = loadTruncated(a), B = loadTruncated(b);
  assert.equal(A.digest, B.digest); assert.equal(B.rows.length, 3); assert.equal(B.laterRowCount, 2); assert.equal(B.lastDate, '2024-09-04');
  assert.ok(!JSON.stringify(B.rows).includes('999'));
});
test('post-cutoff values are not parsed: garbage after the cutoff does not break the read', () => {
  const raw = '{"symbol":"T.SR","rows":[' + JSON.stringify(R('2024-09-04')) + ',["2024-09-05",NaN-garbage,]';
  const L = loadTruncated(raw); assert.equal(L.rows.length, 1); assert.equal(L.laterRowCount, 1);
});
test('fails closed: unsorted file, duplicate dates, missing rows array', () => {
  assert.throws(() => loadTruncated(mk([R('2024-09-05'), R('2024-09-01')])), /unsorted/);
  assert.throws(() => loadTruncated(mk([R('2024-09-02'), R('2024-09-02')])), /ascending/);
  assert.throws(() => loadTruncated('{"symbol":"x"}'), /no rows/);
});
test('a file that ends inside the window keeps everything; cutoff is inclusive', () => {
  const L = loadTruncated(mk([R('2020-01-01'), R('2024-09-04')], ',"extra":1')); assert.equal(L.rows.length, 2); assert.equal(L.cutoff, CUTOFF);
});

import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), D = m.dateDual;
test('dual date: Hijri (Umm al-Qura) first, Gregorian in parentheses, Riyadh day', () => {
  assert.match(D.dualDay('2026-11-17'), /^٧ جمادى الآخرة ١٤٤٨ هـ \(.*2026.*\)$/);
  const t = D.dualFormat('2026-11-17T22:30:00Z');   // 01:30 on the 18th in Riyadh
  assert.match(t, /^٨ جمادى الآخرة ١٤٤٨ هـ.*\(.*18.*\)$/);
});
test('dual date: invalid or empty input gives null, never a fake date', () => {
  assert.equal(D.dualFormat('bad'), null); assert.equal(D.dualFormat(null), null); assert.equal(D.dualFormat(''), null);
  assert.equal(D.dualDay('2026-11-17T01:00:00Z'), null);
});

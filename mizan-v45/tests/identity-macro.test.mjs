import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), I = m.marketIdentity;
const meta = (symbol, instrumentType, exchangeName = 'NYM', currency = 'USD') => ({symbol, instrumentType, exchangeName, currency});
test('macro proxy symbols: futures and currency types pass only for the two allowed symbols', () => {
  assert.equal(I.validateMarketIdentity(meta('BZ=F', 'FUTURE'), 'BZ=F', true).symbol, 'BZ=F');
  assert.equal(I.validateMarketIdentity(meta('DX-Y.NYB', 'CURRENCY', 'ICE'), 'DX-Y.NYB', true).symbol, 'DX-Y.NYB');
  assert.throws(() => I.validateMarketIdentity(meta('CL=F', 'FUTURE'), 'CL=F', true), /نوع الورقة/);
  assert.throws(() => I.validateMarketIdentity(meta('AAPL', 'FUTURE', 'NMS'), 'AAPL', true), /نوع الورقة/);
});

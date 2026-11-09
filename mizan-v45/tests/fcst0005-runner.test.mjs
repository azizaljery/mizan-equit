import test from 'node:test';
import assert from 'node:assert/strict';
import {runAll, RUN_HORIZONS, FAMILY_M} from '../research/fcst0005/runner.mjs';
import {mulberry32} from '../research/fcst0005/candidate.mjs';
// Synthetic market: random walks, optionally with a planted predictable drift driven by a momentum-like state.
function makeStocks(nStocks, n, planted, seed) {
  const rnd = mulberry32(seed), gauss = () => { let s = 0; for (let i = 0; i < 12; i++) s += rnd(); return s - 6; };
  const dates = []; const d0 = Date.UTC(2015, 0, 5); let k = 0;
  while (dates.length < n) { const dt = new Date(d0 + k * 864e5); k++; const w = dt.getUTCDay(); if (w !== 0 && w !== 6) dates.push(dt.toISOString().slice(0, 10)); }
  return {dates, stocks: Array.from({length: nStocks}, (_, si) => {
    const c = [100]; let state = 0;
    for (let i = 1; i < n; i++) { state = 0.98 * state + 0.002 * gauss(); c.push(c[i - 1] * Math.exp(0.01 * gauss() + (planted ? 0.6 * state : 0))); }
    return {symbol: 'S' + si, market: 'us', dates, close: c};
  })};
}
const engFor = () => (si, t, h) => ({bias: 0.0, centre: 0.0});
test('runAll: fixed family of 30 cells, deterministic, exposed data can never be PROVEN', () => {
  const {dates, stocks} = makeStocks(6, 900, true, 7);
  // second market: relabel a copy so both markets exist
  const sa = stocks.map(s => ({...s, market: 'sa', symbol: s.symbol + '.SR'}));
  const all = [...stocks, ...sa];
  const args = {stocks: all, calendars: {us: dates, sa: dates}, engFor, gridStep: 5, B: 200};
  const a = runAll(args), b = runAll(args);
  assert.equal(a.cells.length, FAMILY_M);
  assert.equal(JSON.stringify(a.decisions), JSON.stringify(b.decisions));
  for (const d of a.decisions) assert.notEqual(d.status, 'proven');
  assert.equal(a.decisions.length, 2 * RUN_HORIZONS.length);
  for (const d of a.decisions) assert.equal(d.display.showApprovedPrice, false);
});
test('a pure random walk shows no improvement of the learned candidates over zero (controls and cells stay quiet)', () => {
  const {dates, stocks} = makeStocks(6, 900, false, 11);
  const sa = stocks.map(s => ({...s, market: 'sa', symbol: s.symbol + '.SR'}));
  const r = runAll({stocks: [...stocks, ...sa], calendars: {us: dates, sa: dates}, engFor, gridStep: 5, B: 200});
  for (const c of r.cells.filter(c => c.ok && c.model !== 'QE')) assert.ok(c.relImprovement < 0.05, `${c.market} h${c.h} ${c.model} ${c.relImprovement}`);
});
test('holm family never shrinks: untestable cells keep p=1', () => {
  const {dates, stocks} = makeStocks(3, 600, false, 3);
  const sa = stocks.map(s => ({...s, market: 'sa', symbol: s.symbol + '.SR'}));
  const r = runAll({stocks: [...stocks, ...sa], calendars: {us: dates, sa: dates}, engFor, gridStep: 5, B: 100});
  assert.equal(r.cells.length, FAMILY_M);
  for (const c of r.cells.filter(c => !c.testable)) assert.equal(c.p, 1);
});

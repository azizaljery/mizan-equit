import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import(process.env.MIZAN_TEST_MODULE), R = m.simulationRun, S = m.simulationSpec;
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const dates = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10));
/** world: drift per stock (daily). noise std 1%. `engineNoise` gives the replayed engine a random, uninformative signal. */
function world({ n = 40, days = 900, drift = () => 0, seed = 7, market = 'us' } = {}) {
  const r = rng(seed), ds = dates(days), out = [], er = rng(seed + 99);
  for (let s = 0; s < n; s++) {
    const mu = drift(s, r); let p = 100; const prices = [];
    for (let i = 0; i < days; i++) { p *= 1 + mu + 0.01 * gauss(r); prices.push({ date: ds[i], open: p, high: p, low: p, close: p, volume: 1000 }); }
    const engine = {};
    for (let i = S.SIM_SPEC.minHistorySessions; i < days; i++) engine[ds[i]] = { '5': (er() - 0.5), '21': (er() - 0.5) };
    out.push({ symbol: 'S' + s, market, prices, engine });
  }
  return out;
}
test('features at a decision date ignore everything after it', () => {
  const a = world({ days: 400 }), b = JSON.parse(JSON.stringify(a));
  const cut = 300;
  for (const s of b) for (let i = cut + 1; i < s.prices.length; i++) s.prices[i].close *= 3;
  const ra = R.buildRecords(a), rb = R.buildRecords(b);
  const key = (r) => r.symbol + r.date;
  const mb = new Map(rb.map(r => [key(r), r]));
  let compared = 0;
  for (const r of ra) { if (r.date > a[0].prices[cut].date) continue; const o = mb.get(key(r)); assert.ok(o); assert.equal(o.mom, r.mom); assert.equal(o.vol, r.vol); assert.equal(o.ma, r.ma); assert.equal(o.audit, r.audit); compared++; }
  assert.ok(compared > 100);
});
test('null world: nothing is declared a winner and the label/spec are attached', () => {
  const res = R.runSimulation(world({ seed: 11 }), '2026-11-25T00:00:00Z');
  assert.equal(res.label, 'محاكاة تاريخية'); assert.equal(res.specVersion, 'mizan-sim-1');
  const ho = res.rows.filter(r => r.period === 'holdout');
  assert.ok(ho.length >= 8);
  assert.ok(ho.every(r => r.verdict !== 'تفوّق'), JSON.stringify(ho.map(r => [r.arm, r.horizon, r.verdict])));
});
test('planted momentum: mom126_5 beats baseline and the uninformative engine on the holdout', () => {
  const res = R.runSimulation(world({ seed: 5, drift: (s, r) => (s % 2 ? 0.002 : -0.002) }), 'x');
  const row = res.rows.find(r => r.period === 'holdout' && r.arm === 'mom126_5' && r.horizon === 5);
  assert.ok(row.lift.est > 0.05, JSON.stringify(row));
  assert.ok(row.lift.lo > 0 && row.vsEngine.lo > 0, JSON.stringify(row));
  assert.equal(row.verdict, 'تفوّق');
});
test('choices never read the holdout: perturbing holdout prices leaves chosen fractions unchanged', () => {
  const a = world({ seed: 3, drift: (s) => (s % 2 ? 0.0006 : -0.0006) }), b = JSON.parse(JSON.stringify(a));
  for (const s of b) for (let i = Math.floor(s.prices.length * 0.8); i < s.prices.length; i++) s.prices[i].close *= 1 + 0.3 * Math.sin(i);
  const ca = R.runSimulation(a, 'x').choices, cb = R.runSimulation(b, 'x').choices;
  assert.deepEqual(ca.map(c => c.topFraction), cb.map(c => c.topFraction));
});
test('short samples give «غير كافٍ», never a pass', () => {
  const res = R.runSimulation(world({ days: 330, n: 12 }), 'x');
  const ho = res.rows.filter(r => r.period === 'holdout');
  assert.ok(ho.length > 0 && ho.every(r => r.verdict === 'غير كافٍ' || r.verdict === '—'));
});
test('split leaves a purge gap and keeps order', () => {
  const ds = Array.from({ length: 100 }, (_, i) => 'd' + String(i).padStart(3, '0'));
  const s = R.splitDates(ds, 21);
  assert.ok(s.development.at(-1) < s.validation[0] && s.validation.at(-1) < s.holdout[0]);
  assert.ok(ds.indexOf(s.holdout[0]) - ds.indexOf(s.validation.at(-1)) > 1);
});

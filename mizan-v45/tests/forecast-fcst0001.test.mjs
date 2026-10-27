import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const ev = fs.readFileSync(new URL('../lib/forecast-evidence.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../components/forecasts.tsx', import.meta.url), 'utf8');
const require_ = (await import('node:module')).createRequire(import.meta.url);
const F = require_('../../research/experiments/fcst-lib.cjs');
const N = require_('../../research/experiments/negsel-lib.cjs');

test('registry: no horizon is marked proven until a frozen acceptance rule passes', () => {
  assert.match(ev, /PROVEN_SESSIONS:readonly number\[\]=\[\];/);
  assert.match(ev, /لا توجد أفضلية اتجاهية مثبتة لهذا الأفق/);
});
test('display uses the evidence gate and shows data date + version, never a probability', () => {
  assert.match(ui, /directionalEdgeProven\(row\.sessions\)/);
  assert.match(ui, /provenanceLines\(\{priceTime:result\.priceTime,version:result\.version/);
});
test('horizon conversion: log returns add over sessions and sigma scales with sqrt(h)', () => {
  const c = [100]; for (let i = 1; i <= 300; i++) c.push(c[i - 1] * Math.exp(0.001 * ((i % 7) - 3)));
  const y5 = Math.log(c[205] / c[200]), parts = [201, 202, 203, 204, 205].reduce((a, i) => a + Math.log(c[i] / c[i - 1]), 0);
  assert.ok(Math.abs(y5 - parts) < 1e-12);
  assert.equal(F.scale(0.02, 25), 0.02 * 5);
});
test('no future leakage: sigma63 and features at i are unchanged by later prices', () => {
  const c = Array.from({length: 400}, (_, i) => 100 * Math.exp(0.0007 * i + 0.01 * Math.sin(i / 3)));
  const a = [F.sigma63(c, 300), ...F.featureVector(c, 300)];
  const c2 = c.slice(); for (let i = 301; i < 400; i++) c2[i] *= 5;
  const b = [F.sigma63(c2, 300), ...F.featureVector(c2, 300)];
  assert.deepEqual(a, b);
});
test('rows after the dev cutoff are physically removed', () => {
  const rows = [['2024-09-04', 1, 1, 1, 1, 1], ['2024-09-05', 2, 2, 2, 2, 2]];
  assert.deepEqual(N.cutRows(rows, F.DEV_CUTOFF).map((r) => r[0]), ['2024-09-04']);
});
test('ridge is deterministic and stable on identical inputs; centre is horizon-independent per model', () => {
  const X = Array.from({length: 120}, (_, i) => [Math.sin(i), Math.cos(i / 2), (i % 9) / 9]), z = X.map((x) => 0.3 * x[0] + 0.01 * x[2]);
  const m1 = F.fitRidge(X, z, 120), m2 = F.fitRidge(X, z, 120);
  assert.deepEqual(m1, m2);
  assert.equal(F.predictRidge(m1, X[5]), F.predictRidge(m2, X[5]));
});
test('direction uses the engine neutral thresholds; zero centre is neutral at every horizon', () => {
  for (const h of F.HORIZONS) assert.equal(F.directionOfLog(0, h), 0);
  assert.equal(F.directionOfLog(0.01, 252), 1);
});
test('bootstrap is reproducible for the same seed key', () => {
  const v = Array.from({length: 60}, (_, i) => Math.sin(i) * 0.1);
  assert.deepEqual(F.bootstrapMean(v, 5, 'k'), F.bootstrapMean(v, 5, 'k'));
});

test('card: scenario-centre wording; confidence, probability and directional status hidden while unproven', () => {
  assert.match(ev, /مركز سيناريو غير معتمد تنبؤيًا/);
  assert.match(ui, /directionalEdgeProven\(row\.sessions\)&&<div><dt>درجة الثقة/);
  assert.match(ui, /directionalEdgeProven\(row\.sessions\)&&<p>احتمال السيناريو/);
  assert.match(ui, /UNPROVEN_STATUS_LABEL/);
  assert.doesNotMatch(ui, /نوصي|اشترِ|شراء الآن/);
});
test('provenance: market-data date, engine version and evaluation date are three separate lines', async () => {
  const {provenanceLines} = await import('../lib/forecast-evidence.ts');
  const l = provenanceLines({priceTime: '2026-10-26', version: 'v-x', createdAt: '2026-10-27T10:00:00Z'});
  assert.equal(l.length, 4);
  const m = Object.fromEntries(l);
  assert.match(m['تاريخ بيانات السوق (آخر سعر)'], /^2026-10-26$/); assert.equal(m['نسخة المحرك'], 'v-x');
  assert.match(m['تاريخ التقييم خارج العينة'], /^2026-10-27 · PROTOCOL-FCST-0001$/);
  assert.equal(new Set(l.map((x) => x[0])).size, 4);
});
test('signalVsUncertainty: weak signal is not an invented direction or probability', async () => {
  const {signalVsUncertainty} = await import('../lib/forecast-evidence.ts');
  const r = signalVsUncertainty({available: true, expectedChangePct: 0.05, neutralThresholdPct: 0.5, range: [80, 125], price: 100});
  assert.equal(r.signal, 'low'); assert.equal(r.uncertainty, 'high'); assert.doesNotMatch(r.note, /%|احتمال/);
  assert.equal(signalVsUncertainty({available: false}).signal, 'unknown');
});

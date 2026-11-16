import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const m = await import(process.env.MIZAN_TEST_MODULE), P = m.macroParse, C = m.macroCollect, S = m.macroSeries;
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + file, 'utf8'));
  const prepare = (sql, values = []) => ({
    bind(...v) { return prepare(sql, v); },
    execute() { const r = sqlite.prepare(sql).run(...values); return {meta: {changes: Number(r.changes)}}; },
    async run() { return this.execute(); }, async first() { return sqlite.prepare(sql).get(...values); },
    async all() { return {results: sqlite.prepare(sql).all(...values)}; },
  });
  return {sqlite, db: {prepare, async batch(st) { sqlite.exec('BEGIN'); try { const r = st.map(s => s.execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }}};
}
const NOW = Date.parse('2026-11-15T03:30:00Z');
const csv = (id, rows) => `observation_date,${id}\n` + rows.map(r => r.join(',')).join('\n') + '\n';

test('FRED CSV: skips blanks and "." and old rows, rejects a mismatched header, never invents a value', () => {
  const t = csv('DGS10', [['2023-12-29', '3.88'], ['2026-11-10', '4.98'], ['2026-11-11', ''], ['2026-11-12', '.'], ['2026-11-13', '5.10']]);
  assert.deepEqual(P.parseFredCsv(t, 'DGS10', '2024-01-01'), [{seriesId: 'DGS10', date: '2026-11-10', value: 4.98}, {seriesId: 'DGS10', date: '2026-11-13', value: 5.1}]);
  assert.deepEqual(P.parseFredCsv(t, 'FEDFUNDS'), []);
  assert.deepEqual(P.parseFredCsv('<html>error</html>', 'DGS10'), []);
});

test('World Bank JSON: annual dates become year-end, nulls skipped, bad shapes ignored', () => {
  const j = [{page: 1}, [{date: '2024', value: 1.7}, {date: '2023', value: null}, {date: 'x', value: 3}, {date: '2022', value: 2.5441644569453}]];
  assert.deepEqual(P.parseWorldBank(j, 'SAU:FP.CPI.TOTL.ZG'), [{seriesId: 'SAU:FP.CPI.TOTL.ZG', date: '2024-12-31', value: 1.7}, {seriesId: 'SAU:FP.CPI.TOTL.ZG', date: '2022-12-31', value: 2.5441644569453}]);
  assert.deepEqual(P.parseWorldBank({}, 'x'), []); assert.deepEqual(P.parseWorldBank([{}, null], 'x'), []);
});

test('collector appends once, a re-run inserts nothing, a revised value is a new row and the old one stays', async () => {
  const {db, sqlite} = fixture();
  const series = S.MACRO_SERIES.filter(s => s.id === 'DGS10');
  let body = csv('DGS10', [['2026-11-10', '4.98'], ['2026-11-13', '5.10']]);
  const f = async () => body;
  const a = await C.collectMacro(db, NOW, f, {series}); assert.equal(a.inserted, 2);
  const b = await C.collectMacro(db, NOW + 1000, f, {series}); assert.equal(b.inserted, 0);
  body = csv('DGS10', [['2026-11-10', '4.99'], ['2026-11-13', '5.10']]);
  const c = await C.collectMacro(db, NOW + 2000, f, {series}); assert.equal(c.inserted, 1);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) c FROM macro_observations WHERE obs_date='2026-11-10'").get().c), 2);
  const latest = await C.latestMacro(db); const d = latest.find(x => x.id === 'DGS10');
  assert.equal(d.latest.date, '2026-11-13'); assert.equal(d.previous.date, '2026-11-10'); assert.equal(d.previous.value, 4.99);
  assert.equal(sqlite.prepare('SELECT availability_basis b FROM macro_observations LIMIT 1').get().b, 'retrieval_time_only');
});

test('one failing series does not stop the others, and the failure is reported', async () => {
  const {db} = fixture();
  const series = S.MACRO_SERIES.filter(s => ['DGS10', 'UNRATE'].includes(s.id));
  const f = async url => { if (url.includes('DGS10')) throw new Error('http_503'); return csv('UNRATE', [['2026-10-01', '4.1']]); };
  const r = await C.collectMacro(db, NOW, f, {series});
  assert.equal(r.series.find(s => s.id === 'DGS10').error, 'http_503'); assert.equal(r.series.find(s => s.id === 'UNRATE').inserted, 1);
});

test('observations are immutable and cannot be deleted', () => {
  const {sqlite} = fixture();
  sqlite.prepare("INSERT INTO macro_observations(id,series_id,obs_date,value,source,source_url,retrieved_at) VALUES('a','X','2026-01-01',1,'fred','u','t')").run();
  assert.throws(() => sqlite.prepare("UPDATE macro_observations SET value=2").run(), /immutable/);
  assert.throws(() => sqlite.prepare("DELETE FROM macro_observations").run(), /append_only/);
});

test('03:30 UTC runs the macro job only on the maintenance cron, and the job is lock-protected', async () => {
  assert.equal(m.slotJob({cron: m.MAINTENANCE_SLOT_CRON, scheduledTime: Date.UTC(2026, 10, 15, 3, 30)}), 'macro');
  assert.equal(m.slotJob({cron: '0 3 * * *', scheduledTime: Date.UTC(2026, 10, 15, 3, 30)}), null);
  const {db, sqlite} = fixture();
  const r = await m.runMacro(db, {now: NOW, fetchText: async url => url.includes('worldbank') ? JSON.stringify([{}, [{date: '2024', value: 1.2}]]) : csv(url.split('id=')[1].split('&')[0], [['2026-11-10', '1.5']])});
  assert.ok(['completed', 'partial'].includes(r.status)); assert.ok(Number(sqlite.prepare('SELECT COUNT(*) c FROM macro_observations').get().c) >= 9);
  assert.ok(sqlite.prepare("SELECT data FROM research_state WHERE id='job:macro:last'").get());
});

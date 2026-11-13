import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const m = await import(process.env.MIZAN_TEST_MODULE), M = m.botManual, E = m.botEngine, R = m.botRunner;
const NOW = Date.parse('2026-11-12T15:00:00Z'), START = '2026-11-12T00:00:00.000Z';
function fixture(version = 'bot-strategy-2', cfg = E.STRATEGY_V2) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + file, 'utf8'));
  const prepare = (sql, values = []) => ({
    bind(...v) { return prepare(sql, v); },
    execute() { const r = sqlite.prepare(sql).run(...values); return {meta: {changes: Number(r.changes)}}; },
    async run() { return this.execute(); }, async first() { return sqlite.prepare(sql).get(...values); },
    async all() { return {results: sqlite.prepare(sql).all(...values)}; },
  });
  const db = {prepare, async batch(st) { sqlite.exec('BEGIN'); try { const r = st.map(s => s.execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }};
  sqlite.prepare('INSERT INTO bot_strategies VALUES(?,?,?,?,?,?)').run('s1', version, START, JSON.stringify(cfg), 'fp', '');
  sqlite.prepare('INSERT INTO bot_experiments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('e1', 'n', 'us', 'USD', 1_000_000, 's1', 'paper', 'running', START, START, null, '{}');
  sqlite.prepare('INSERT INTO bot_experiments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('e2', 'n2', 'sa', 'SAR', 3_750_000, 's1', 'paper', 'paused', START, START, null, '{}');
  return {db, sqlite};
}
const bars = () => { const out = []; let t = Date.parse('2026-09-25T00:00:00Z'), i = 0; while (new Date(t).toISOString().slice(0, 10) < '2026-11-12') { out.push({date: new Date(t).toISOString().slice(0, 10), close: 100 + (i % 2), volume: 1_000_000}); t += 864e5; i++; } return out; };
const deps = (o = {}) => ({
  fetchQuote: async () => o.noQuote ? null : ({price: o.price ?? 100, previousClose: 99, quoteTime: new Date(NOW - 30000).toISOString(), isOpen: o.open ?? true, ageSeconds: o.age ?? 30, delayAccepted: true, source: 'fixture'}),
  fetchBars: async () => bars(),
});
const rid = n => 'req-' + String(n).padStart(8, '0');
const count = (s, t) => Number(s.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);

test('manual buy fills with costs, is labelled manual, and rebuilds in the ledger', async () => {
  const {db, sqlite} = fixture();
  const r = await M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'aapl', side: 'buy', horizon: 5, requestId: rid(1)}, deps());
  assert.equal(r.status, 'filled'); assert.equal(r.fills.length, 1);
  assert.ok(r.fills[0].fillPrice >= 100 && r.fills[0].quantity === 200);          // 2% of 1,000,000 / 100
  const d = sqlite.prepare('SELECT * FROM bot_decisions').get(); assert.equal(d.model_version, 'manual'); assert.equal(d.action, 'buy');
  assert.equal(JSON.parse(d.data_json).primarySource, 'manual');
  assert.equal(count(sqlite, 'bot_orders'), 1); assert.equal(count(sqlite, 'bot_fills'), 1);
  assert.equal(sqlite.prepare('SELECT status FROM bot_orders').get().status, 'filled');
});

test('repeating the same requestId changes nothing', async () => {
  const {db, sqlite} = fixture();
  const i = {experimentId: 'e1', symbol: 'AAPL', side: 'buy', requestId: rid(2)};
  await M.manualOrder(db, NOW, i, deps());
  const again = await M.manualOrder(db, NOW + 1000, i, deps());
  assert.equal(again.status, 'duplicate'); assert.equal(count(sqlite, 'bot_fills'), 1);
});

test('closed market and stale quote refuse, and the refusal is recorded with its reason', async () => {
  const {db, sqlite} = fixture();
  const a = await M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'AAPL', side: 'buy', requestId: rid(3)}, deps({open: false}));
  assert.equal(a.status, 'refused'); assert.equal(a.reason, 'market_closed');
  const b = await M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'AAPL', side: 'buy', requestId: rid(4)}, deps({age: 5000}));
  assert.equal(b.reason, 'quote_stale'); assert.equal(count(sqlite, 'bot_fills'), 0);
  assert.equal(count(sqlite, 'bot_decisions'), 2); assert.match(sqlite.prepare('SELECT reason FROM bot_decisions ORDER BY id LIMIT 1').get().reason, /^manual_buy_refused:/);
  const c = await M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'AAPL', side: 'buy', requestId: rid(5)}, deps({noQuote: true}));
  assert.equal(c.reason, 'no_quote');
});

test('amount is respected, capped by cash, and too-small amounts are refused', async () => {
  const {db} = fixture();
  const a = await M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'MSFT', side: 'buy', amount: 5000, requestId: rid(6)}, deps());
  assert.equal(a.fills[0].quantity, 50);
  const b = await M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'NVDA', side: 'buy', amount: 50, requestId: rid(7)}, deps());
  assert.equal(b.reason, 'amount_below_one_share');
  const c = await M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'TSLA', side: 'buy', amount: 5e9, requestId: rid(8)}, deps());
  assert.equal(c.status, 'filled'); assert.ok(c.fills[0].quantity <= 10000);       // liquidity cap 1% of ~100M ADV
});

test('sell closes the open position; selling without one is refused', async () => {
  const {db, sqlite} = fixture();
  const none = await M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'AAPL', side: 'sell', requestId: rid(9)}, deps());
  assert.equal(none.reason, 'no_position');
  await M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'AAPL', side: 'buy', requestId: rid(10)}, deps());
  const s = await M.manualOrder(db, NOW + 60000, {experimentId: 'e1', symbol: 'AAPL', side: 'sell', requestId: rid(11)}, deps());
  assert.equal(s.status, 'filled'); assert.equal(s.fills[0].quantity, 200);
  const fills = sqlite.prepare('SELECT symbol,horizon,side,quantity,fill_price,commission,created_at,forecast_id FROM bot_fills ORDER BY created_at').all()
    .map(r => ({symbol: r.symbol, horizon: r.horizon, side: r.side, quantity: r.quantity, fillPrice: r.fill_price, commission: r.commission, createdAt: r.created_at, forecastId: r.forecast_id}));
  assert.equal(E.ledger(1_000_000, fills).positions.length, 0);
});

test('validation: symbol, market match, paused experiment, horizon', async () => {
  const {db} = fixture();
  await assert.rejects(M.manualOrder(db, NOW, {experimentId: 'e1', symbol: '2222.SR', side: 'buy', requestId: rid(12)}, deps()), /أمريكية|سعودية/);
  await assert.rejects(M.manualOrder(db, NOW, {experimentId: 'e2', symbol: '2222.SR', side: 'buy', requestId: rid(13)}, deps()), /غير مشغّلة/);
  await assert.rejects(M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'A B', side: 'buy', requestId: rid(14)}, deps()), /غير صالح/);
  await assert.rejects(M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'AAPL', side: 'buy', horizon: 7, requestId: rid(15)}, deps()), /الأفق/);
  await assert.rejects(M.manualOrder(db, NOW, {experimentId: 'zz', symbol: 'AAPL', side: 'buy', requestId: rid(16)}, deps()), /غير موجودة/);
  await assert.rejects(M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'AAPL', side: 'buy', amount: -5, requestId: rid(17)}, deps()), /المبلغ/);
});

test('the scheduled step treats a manual position normally (no entry_record_missing)', async () => {
  const {db, sqlite} = fixture();
  await M.manualOrder(db, NOW, {experimentId: 'e1', symbol: 'AAPL', side: 'buy', requestId: rid(18)}, deps());
  const d = deps();
  await R.runBotStep(db, NOW + 3600000, {collectSignals: async () => [], fetchQuote: d.fetchQuote, fetchBars: d.fetchBars, maxFetches: 50});
  assert.equal(count(sqlite, 'bot_decisions WHERE reason=\'entry_record_missing\''), 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const m = await import(process.env.MIZAN_TEST_MODULE), R = m.botRunner, E = m.botEngine, BM = m.botBenchmark;
const NOW = Date.parse('2026-11-12T15:00:00Z'), START = '2026-11-12T00:00:00.000Z';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + file, 'utf8'));
  const prepare = (sql, values = []) => ({
    bind(...v) { return prepare(sql, v); },
    execute() { const r = sqlite.prepare(sql).run(...values); return {meta: {changes: Number(r.changes)}}; },
    async run() { return this.execute(); },
    async first() { return sqlite.prepare(sql).get(...values); },
    async all() { return {results: sqlite.prepare(sql).all(...values)}; },
  });
  const db = {prepare, async batch(st) { sqlite.exec('BEGIN'); try { const r = st.map(s => s.execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }};
  sqlite.prepare('INSERT INTO bot_strategies VALUES(?,?,?,?,?,?)').run('s1', 'bot-strategy-1', START, JSON.stringify(E.STRATEGY_V1), 'fp', '');
  return {db, sqlite};
}
function experiment(sqlite, id = 'e1', market = 'us', status = 'running') {
  sqlite.prepare('INSERT INTO bot_experiments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, id + '-name', market, market === 'us' ? 'USD' : 'SAR', market === 'us' ? 1_000_000 : 3_750_000, 's1', 'dry_run', status, START, START, null, '{}');
}
const sig = (symbol, o = {}) => ({source: 'mizan-direction', source_version: 'mizan-direction-v1', market: 'us', symbol, horizon: 5, direction: 'up', confidence: null, strength: 3,
  issued_at: '2026-11-12T10:00:00.000Z', forecast_id: 'f-' + symbol, basis_json: JSON.stringify({price: 100, range: [95, 106], targetPrice: 103}), ...o});
const bars = (today = '2026-11-12') => {
  const out = []; let t = Date.parse('2026-09-25T00:00:00Z'), i = 0;
  while (new Date(t).toISOString().slice(0, 10) < today) { out.push({date: new Date(t).toISOString().slice(0, 10), close: 100 + (i % 2), volume: 1_000_000}); t += 864e5; i++; }
  return out;
};
const deps = (signals, o = {}) => {
  const calls = {quote: 0, bars: 0};
  return {calls, collectSignals: async () => signals, maxFetches: 100,
    fetchQuote: async s => { calls.quote++; if (o.quoteDown) throw Error('provider down'); return {price: o.price ?? 100, previousClose: 99, quoteTime: new Date(NOW - 30000).toISOString(), isOpen: o.open ?? true, ageSeconds: 30, delayAccepted: true, source: 'fixture://' + s}; },
    fetchBars: async () => { calls.bars++; return o.noBars ? [] : bars(); }, ...o.extra};
};
const count = (sqlite, t) => Number(sqlite.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);

test('liquidity: ADV value from the last 20 completed sessions only; missing history gives no liquidity', () => {
  const l = R.liquidityFromBars(bars(), '2026-11-12');
  assert.equal(l.advValue, 100.5 * 1_000_000); assert.ok(l.dailyVol > 0 && l.dailyVol < .02);
  const partial = [...bars(), {date: '2026-11-12', close: 500, volume: 9e9}];                  // today's partial bar must not count
  assert.equal(R.liquidityFromBars(partial, '2026-11-12').advValue, l.advValue);
  assert.deepEqual(R.liquidityFromBars(bars().slice(0, 10), '2026-11-12'), {advValue: null, dailyVol: null});
});

test('benchmark: Saudi basket needs enough quotes and chains from 100; nothing is guessed', () => {
  const q = n => Array.from({length: n}, () => ({price: 101, previousClose: 100}));
  assert.equal(BM.basketReturn(q(4)), null); assert.ok(Math.abs(BM.basketReturn(q(5)) - .01) < 1e-12);
  assert.equal(BM.chainBasket(null, true, .01), 100); assert.ok(Math.abs(BM.chainBasket(100, false, .01) - 101) < 1e-9); assert.equal(BM.chainBasket(100, false, null), null);
});

test('one step: up call becomes a traced decision, order and fill; snapshot has the SPY reference', async () => {
  const {db, sqlite} = fixture(); experiment(sqlite);
  const s = await R.runBotStep(db, NOW, deps([sig('AAA')]));
  assert.equal(s.experiments[0].error, undefined);
  const d = sqlite.prepare("SELECT * FROM bot_decisions WHERE action='buy'").get(), o = sqlite.prepare('SELECT * FROM bot_orders').get(), f = sqlite.prepare('SELECT * FROM bot_fills').get();
  assert.equal(d.reason, 'entry_up_call'); assert.equal(d.forecast_id, 'f-AAA'); assert.equal(d.strategy_version, 'bot-strategy-1'); assert.equal(d.model_version, 'mizan-direction@mizan-direction-v1');
  const data = JSON.parse(d.data_json); assert.equal(data.agreement, 'single'); assert.equal(data.sources[0].source, 'mizan-direction'); assert.equal(data.sources[0].confidence, 'غير متاحة');
  assert.equal(o.decision_id, d.id); assert.equal(o.status, 'filled'); assert.equal(o.quantity, 200); assert.equal(f.order_id, o.id); assert.equal(f.forecast_id, 'f-AAA');
  assert.ok(f.fill_price > 100 && f.commission >= 0 && f.price_source.startsWith('fixture://'));
  const snap = sqlite.prepare('SELECT * FROM bot_equity_snapshots').get(); assert.equal(snap.benchmark_value, 100); assert.match(snap.benchmark_name, /SPY/); assert.ok(snap.equity < 1_000_000 && snap.equity > 999_000);
  const book = E.ledger(1_000_000, sqlite.prepare('SELECT symbol,horizon,side,quantity,fill_price AS fillPrice,commission,created_at AS createdAt FROM bot_fills').all());
  assert.equal(book.positions.length, 1); assert.ok(Math.abs(book.cash - (1_000_000 - 200 * f.fill_price - f.commission)) < 1e-6);
});

test('repeating a step, or restarting with no memory, writes nothing twice and loses nothing', async () => {
  const {db, sqlite} = fixture(); experiment(sqlite);
  const sigs = [sig('AAA'), sig('BBB')];
  await R.runBotStep(db, NOW, deps(sigs));
  const snap1 = ['bot_decisions', 'bot_orders', 'bot_fills'].map(t => count(sqlite, t));
  await R.runBotStep(db, NOW + 1000, deps(sigs));                                     // second step: only the position hold checks are new
  const snap2 = ['bot_decisions', 'bot_orders', 'bot_fills'].map(t => count(sqlite, t));
  assert.equal(snap2[1], snap1[1]); assert.equal(snap2[2], snap1[2]); assert.equal(snap2[2], 2);
  await R.runBotStep(db, NOW + 2000, deps(sigs));                                     // third: position checks already recorded today
  assert.deepEqual(['bot_decisions', 'bot_orders', 'bot_fills'].map(t => count(sqlite, t)), snap2);
  assert.equal(count(sqlite, 'bot_equity_snapshots'), 1);                             // one snapshot per day
  assert.equal(count(sqlite, 'bot_orders') - Number(sqlite.prepare("SELECT COUNT(*) c FROM bot_orders WHERE status='filled'").get().c), 0);
});

test('a provider failure leaves the order pending with the reason; the next step fills it exactly once', async () => {
  const {db, sqlite} = fixture(); experiment(sqlite);
  // First step: entry decision needs a price, so it is suspended (no order, nothing invented).
  await R.runBotStep(db, NOW, deps([sig('AAA')], {quoteDown: true}));
  assert.equal(count(sqlite, 'bot_orders'), 0); assert.equal(sqlite.prepare("SELECT reason FROM bot_decisions WHERE action='suspend'").get().reason, 'price_unavailable');
  // Market closed: order is created, then waits with the closed-market reason.
  await R.runBotStep(db, NOW + 60000, deps([sig('AAA')], {open: false}));
  let o = sqlite.prepare('SELECT * FROM bot_orders').get();
  assert.equal(o.status, 'pending'); assert.equal(o.attempts, 1); assert.equal(JSON.parse(o.last_attempt_json).reason, 'market_closed'); assert.equal(count(sqlite, 'bot_fills'), 0);
  await R.runBotStep(db, NOW + 120000, deps([sig('AAA')]));
  o = sqlite.prepare('SELECT * FROM bot_orders').get(); assert.equal(o.status, 'filled'); assert.equal(count(sqlite, 'bot_fills'), 1); assert.equal(count(sqlite, 'bot_orders'), 1);
  await R.runBotStep(db, NOW + 180000, deps([sig('AAA')])); assert.equal(count(sqlite, 'bot_fills'), 1);
});

test('conflicting sources are kept apart, marked as disagreeing and left pending: no order', async () => {
  const {db, sqlite} = fixture(); experiment(sqlite);
  const sigs = [sig('AAA'), sig('AAA', {source: 'other-engine', source_version: 'o1', direction: 'down', forecast_id: 'g1'})];
  await R.runBotStep(db, NOW, deps(sigs));
  const d = sqlite.prepare('SELECT * FROM bot_decisions').get(); assert.equal(d.action, 'suspend'); assert.equal(d.reason, 'pending_sources_conflict');
  const data = JSON.parse(d.data_json); assert.equal(data.agreement, 'disagree'); assert.deepEqual(data.sources.map(s => s.source).sort(), ['mizan-direction', 'other-engine']);
  assert.equal(count(sqlite, 'bot_orders'), 0);
  // Two agreeing sources are recorded as agreeing and may trade.
  const {db: db2, sqlite: sq2} = fixture(); experiment(sq2);
  await R.runBotStep(db2, NOW, deps([sig('AAA'), sig('AAA', {source: 'other-engine', source_version: 'o1', forecast_id: 'g1', strength: 2})]));
  assert.equal(JSON.parse(sq2.prepare("SELECT data_json FROM bot_decisions WHERE action='buy'").get().data_json).agreement, 'agree'); assert.equal(count(sq2, 'bot_fills'), 1);
});

test('missing liquidity, stale or pre-experiment forecasts, weak calls: recorded with the reason, never traded', async () => {
  const {db, sqlite} = fixture(); experiment(sqlite);
  await R.runBotStep(db, NOW, deps([sig('AAA')], {noBars: true}));
  assert.equal(sqlite.prepare('SELECT reason FROM bot_decisions').get().reason, 'liquidity_unavailable'); assert.equal(count(sqlite, 'bot_orders'), 0);
  const {db: d2, sqlite: s2} = fixture(); experiment(s2);
  await R.runBotStep(d2, NOW, deps([sig('OLD', {issued_at: '2026-11-11T10:00:00.000Z'}), sig('PRE', {issued_at: '2026-11-11T23:30:00.000Z'}), sig('WEAK', {strength: 1}), sig('DOWN', {direction: 'down'})]));
  const reasons = Object.fromEntries(s2.prepare('SELECT symbol,reason FROM bot_decisions').all().map(r => [r.symbol, r.reason]));
  assert.equal(reasons.OLD, 'forecast_predates_experiment'); assert.equal(reasons.PRE, 'forecast_predates_experiment'); assert.equal(reasons.WEAK, 'signal_too_weak'); assert.equal(reasons.DOWN, undefined);
  assert.equal(count(s2, 'bot_orders'), 0); assert.equal(count(s2, 'bot_fills'), 0);
});

test('paused and stopped experiments do nothing', async () => {
  const {db, sqlite} = fixture(); experiment(sqlite, 'p1', 'us', 'paused'); experiment(sqlite, 's9', 'us', 'stopped');
  const s = await R.runBotStep(db, NOW, deps([sig('AAA')])); assert.equal(s.experiments.length, 0); assert.equal(count(sqlite, 'bot_decisions'), 0);
});

test('exit: horizon end sells at the simulated price and the round trip is traceable to the entry forecast', async () => {
  const {db, sqlite} = fixture(); experiment(sqlite);
  await R.runBotStep(db, NOW, deps([sig('AAA')]));
  const later = NOW + 8 * 86400000;
  const d = deps([]); d.fetchQuote = async s => ({price: 103, previousClose: 102, quoteTime: new Date(later - 30000).toISOString(), isOpen: true, ageSeconds: 30, delayAccepted: true, source: 'fixture://' + s});
  d.fetchBars = async () => bars('2026-11-20');
  await R.runBotStep(db, later, d);
  const sell = sqlite.prepare("SELECT * FROM bot_decisions WHERE action='sell'").get(); assert.equal(sell.reason, 'horizon_ended'); assert.equal(sell.forecast_id, 'f-AAA');
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM bot_fills WHERE side='sell'").get().c, 1);
  const book = E.ledger(1_000_000, sqlite.prepare('SELECT symbol,horizon,side,quantity,fill_price AS fillPrice,commission,created_at AS createdAt,forecast_id AS forecastId FROM bot_fills').all());
  assert.equal(book.positions.length, 0); assert.equal(book.closed.length, 1); assert.equal(book.closed[0].forecastId, 'f-AAA');
});

test('call budget: candidates cut off by the budget are retried next step; nothing is duplicated', async () => {
  const {db, sqlite} = fixture(); experiment(sqlite);
  const sigs = [sig('AAA', {strength: 4}), sig('BBB', {strength: 3}), sig('CCC', {strength: 2})];
  const s1 = await R.runBotStep(db, NOW, deps(sigs, {extra: {maxFetches: 2}}));
  assert.equal(s1.experiments[0].budgetExhausted, true); assert.equal(count(sqlite, 'bot_orders'), 1);
  await R.runBotStep(db, NOW + 60000, deps(sigs)); await R.runBotStep(db, NOW + 120000, deps(sigs));
  assert.equal(count(sqlite, 'bot_orders'), 3); assert.equal(count(sqlite, 'bot_fills'), 3);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) c FROM bot_decisions WHERE action='buy'").get().c), 3);
});

test('the scheduled worker: lock, summary state, and no run unless enabled and in its slot', async () => {
  const {db, sqlite} = fixture(); experiment(sqlite);
  const r = await m.runPaperBot(db, {triggeredBy: 'manual', now: NOW, read: async () => { throw Error('offline'); }, collectSignals: async () => [sig('AAA')]});
  assert.equal(r.status, 'completed'); assert.equal(r.step.experiments.length, 1); assert.equal(count(sqlite, 'bot_orders'), 0);   // no prices: only suspended decisions
  assert.equal(JSON.parse(sqlite.prepare('SELECT data FROM research_state WHERE id=?').get(m.PAPER_BOT_STATE_ID).data).status, 'completed');
  assert.equal(count(sqlite, 'research_locks'), 0);
  let used = false; const DB = {prepare() { used = true; throw Error('x'); }, batch() { used = true; throw Error('x'); }};
  await m.scheduledPaperBot({cron: m.PAPER_BOT_CRON, scheduledTime: Date.parse('2026-10-17T09:30:00Z')}, {DB}); assert.equal(used, false);          // not enabled
  await m.scheduledPaperBot({cron: m.PAPER_BOT_CRON, scheduledTime: Date.parse('2026-10-17T10:30:00Z')}, {DB, MIZAN_BACKGROUND_CRON_ENABLED: 'true'}); assert.equal(used, false); // not its hour
});

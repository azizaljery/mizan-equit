import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
const m = await import(process.env.MIZAN_TEST_MODULE);

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + file, 'utf8'));
  const prepare = (sql, values = []) => ({
    bind(...v) { return prepare(sql, v); },
    execute() { const result = sqlite.prepare(sql).run(...values); return {meta: {changes: Number(result.changes)}}; },
    async run() { return this.execute(); },
    async first() { return sqlite.prepare(sql).get(...values); },
    async all() { return {results: sqlite.prepare(sql).all(...values)}; },
  });
  const db = {prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  }};
  return {db, sqlite};
}

function seed(sqlite, symbols, extra = {}) {
  for (const symbol of symbols) {
    const id = crypto.randomUUID(), snapshot = crypto.randomUUID();
    const f = {anchorDate: '2026-07-10', price: 100, predictedPrice: 110, range: [108, 112], direction: 'صاعد', currency: 'USD', evaluationPolicy: m.EVALUATION_POLICY, ...extra};
    sqlite.prepare('INSERT INTO analysis_snapshots VALUES(?,?,?,?)').run(snapshot, symbol, '2026-07-11T00:00:00Z', JSON.stringify({fixture: true, company: {symbol}}));
    sqlite.prepare('INSERT INTO forecast_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, snapshot, symbol, '2026-07-11T00:00:00Z', 5, 'synthetic-background-test', 'us', 'fixture', 'منخفض', 1, JSON.stringify(f));
  }
}
function chart(symbol) {
  const time = [];
  for (let ms = Date.parse('2026-06-01T12:00:00Z'); ms < Date.parse('2026-09-01T00:00:00Z'); ms += 864e5) {
    if (![0, 6].includes(new Date(ms).getUTCDay())) time.push(ms / 1000);
  }
  const close = time.map((_, i) => 100 + i * .2);
  return {chart: {result: [{meta: {symbol, instrumentType: symbol.startsWith('^') ? 'INDEX' : 'EQUITY', currency: 'USD', exchangeName: 'NMS', fullExchangeName: 'NASDAQ', longName: 'Synthetic QA ' + symbol, regularMarketTime: time.at(-1), regularMarketPrice: close.at(-1), dataGranularity: '1d'}, timestamp: time, indicators: {quote: [{open: close, high: close.map(n => n + 1), low: close.map(n => n - 1), close, volume: close.map(() => 100000)}]}, events: {}}], error: null}};
}
function networkFixture() {
  const calls = [];
  return {calls, async fetch(url) {
    const u = new URL(String(url)); calls.push(String(url));
    if (u.hostname.endsWith('yahoo.com') && u.pathname.startsWith('/v8/finance/chart/')) return Response.json(chart(decodeURIComponent(u.pathname.split('/').at(-1))));
    if (u.hostname.endsWith('yahoo.com') && u.pathname.endsWith('/search')) return Response.json({quotes: [], news: []});
    if (u.hostname.endsWith('yahoo.com')) return Response.json({timeseries: {result: []}, finance: {result: []}, quoteSummary: {result: []}});
    if (u.hostname.endsWith('sec.gov')) return Response.json({});
    throw Error('Synthetic transport refuses unexpected host');
  }};
}
const counts = sqlite => ({forecast_outcomes: sqlite.prepare('SELECT COUNT(*) n FROM forecast_outcomes').get().n, evaluation_revisions: sqlite.prepare('SELECT COUNT(*) n FROM evaluation_revisions').get().n});
async function ownerFixture(db) {
  const token = await m.adminLogin(db, await m.hashPin('123456'), 'azoz', '123456');
  m.testRuntime.DB = db; m.testRuntime.RECOMMENDATION_OWNER_EMAIL = 'background-owner@example.test';
  return (raw = '{}', overrides = {}, method = 'POST') => new Request('https://mizan.test/api/admin/run-background', {method, headers: {origin: 'https://mizan.test', 'content-type': 'application/json', 'oai-authenticated-user-email': 'background-owner@example.test', cookie: 'mizan_admin=' + token, ...overrides}, ...(method === 'POST' ? {body: raw} : {})});
}

test('Background manual limit=5: real route/reader/evaluator/SQL, repeat is a no-op, immutable originals', async () => {
  const {db, sqlite} = fixture(), network = networkFixture(), oldFetch = globalThis.fetch;
  seed(sqlite, ['MZQA1', 'MZQA2', 'MZQA3', 'MZQA4', 'MZQA5']);
  const originals = sqlite.prepare('SELECT * FROM forecast_records ORDER BY id').all(), snapshots = sqlite.prepare('SELECT * FROM analysis_snapshots ORDER BY id').all();
  const req = await ownerFixture(db); globalThis.fetch = network.fetch;
  try {
    const before = counts(sqlite), firstResponse = await m.backgroundPOST(req('{"limit":5}'));
    assert.equal(firstResponse.status, 200);
    const first = (await firstResponse.json()).summary, afterFirst = counts(sqlite);
    assert.equal(first.symbolsScanned, 5); assert.equal(first.symbolsResolved, 5); assert.equal(first.symbolsFailed, 0); assert.equal(first.symbolsSkipped, 0); assert.equal(first.evaluationsSaved, 5);
    assert.deepEqual(first.integrity, {outcomesDuplicates: 0, revisionsDuplicates: 0, consecutiveRevisionDuplicates: 0, revisionNumberDuplicates: 0});
    assert.deepEqual(afterFirst, {forecast_outcomes: 5, evaluation_revisions: 5});
    const callsBefore = network.calls.length;
    const secondResponse = await m.backgroundPOST(req('{"limit":5}')); assert.equal(secondResponse.status, 200);
    const second = (await secondResponse.json()).summary, afterSecond = counts(sqlite);
    assert.equal(second.evaluationsSaved, 0); assert.equal(second.symbolsScanned, 0); assert.deepEqual(afterFirst, afterSecond); assert.equal(network.calls.length, callsBefore);
    assert.deepEqual(sqlite.prepare('SELECT * FROM forecast_records ORDER BY id').all(), originals);
    assert.deepEqual(sqlite.prepare('SELECT * FROM analysis_snapshots ORDER BY id').all(), snapshots);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM research_locks WHERE id LIKE 'resolve:%' OR id LIKE 'evaluation:%' OR id='cron:resolution:v1'").get().n, 0);
    const last = await m.readLastRun(db); assert.deepEqual(last, second);
    const readResponse = await m.backgroundGET(req(undefined, {}, 'GET')); assert.equal(readResponse.status, 200); assert.deepEqual((await readResponse.json()).lastRun, second);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM paper_trades').get().n, 0); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM research_runs').get().n, 0);
    assert.ok(network.calls.every(u => !u.includes('tavily')));
    const report = {environment: 'Synthetic network + actual app handlers/evaluator + SQLite transaction adapter; NOT production prices or owner session', testedAt: new Date().toISOString(), cronEnabled: false, before, first, afterFirst, second, afterSecond, research_state: {id: 'job:evaluate-due:last', data: last}, networkRequests: network.calls.length};
    console.log('BACKGROUND_LIMIT5_REPORT ' + JSON.stringify(report));
    if (process.env.MIZAN_BACKGROUND_QA_REPORT) writeFileSync(process.env.MIZAN_BACKGROUND_QA_REPORT, JSON.stringify(report, null, 2) + '\n');
  } finally { globalThis.fetch = oldFetch; sqlite.close(); }
});

test('Background input validation and existing owner/admin boundaries; GET never executes', async () => {
  const {db, sqlite} = fixture(), req = await ownerFixture(db), before = counts(sqlite);
  try {
    for (const raw of ['{"limit":500}', '{"limit":0}', '{"limit":"abc"}', '{"limit":-1}', '{"limit":1.5}', '{"limit":null}', 'null', '[]', '5', '{', '{"replace":true}']) assert.equal((await m.backgroundPOST(req(raw))).status, 400, raw);
    assert.equal((await m.backgroundPOST(req(' '.repeat(501)))).status, 413);
    assert.equal((await m.backgroundPOST(req('ع'.repeat(251)))).status, 413, 'UTF-8 bytes not JS characters');
    assert.equal((await m.backgroundPOST(req('{}', {'content-type': 'text/plain'}))).status, 415);
    assert.equal((await m.backgroundPOST(req('{}', {origin: 'https://evil.test'}))).status, 403);
    assert.equal((await m.backgroundPOST(req('{}', {'sec-fetch-site': 'cross-site'}))).status, 403);
    assert.equal((await m.backgroundPOST(req('{}', {'oai-authenticated-user-email': 'other@example.test'}))).status, 403);
    assert.equal((await m.backgroundPOST(req('{}', {cookie: ''}))).status, 401);
    assert.equal((await m.backgroundGET(req(undefined, {cookie: ''}, 'GET'))).status, 401);
    const noOrigin = req('{}'); noOrigin.headers.delete('origin');
    const ok = await m.backgroundPOST(noOrigin); assert.equal(ok.status, 200); assert.equal((await ok.json()).summary.limit, 5);
    const state = sqlite.prepare("SELECT data FROM research_state WHERE id='job:evaluate-due:last'").get().data;
    assert.equal((await m.backgroundGET(req(undefined, {}, 'GET'))).status, 200);
    assert.equal(sqlite.prepare("SELECT data FROM research_state WHERE id='job:evaluate-due:last'").get().data, state);
    assert.deepEqual(counts(sqlite), before);
  } finally { sqlite.close(); }
});

test('Background fatal SQL/state failures are explicit, sanitized and never reported as success', async () => {
  const {db, sqlite} = fixture();
  try {
    const broken = {...db, prepare(sql) { if (sql.includes('GROUP BY f.symbol')) throw Error('secret-token https://bad.test?api_key=secret'); return db.prepare(sql); }};
    const result = await m.runResolutionCycle(broken, {limit: 5, triggeredBy: 'manual'});
    assert.equal(result.status, 'failed'); assert.ok(result.fatalError); assert.equal(result.stateSaved, true); assert.ok(!JSON.stringify(result).includes('secret'));
    assert.equal((await m.readLastRun(db)).runId, result.runId);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM research_locks WHERE id='cron:resolution:v1'").get().n, 0);
    const unavailable = {prepare() { throw Error('secret'); }};
    assert.deepEqual(await m.checkResolutionIntegrity(unavailable), {outcomesDuplicates: -1, revisionsDuplicates: -1, consecutiveRevisionDuplicates: -1, revisionNumberDuplicates: -1});
    const bad = await m.runResolutionCycle(unavailable, {limit: 5, triggeredBy: 'manual'});
    assert.equal(bad.stateSaved, false); assert.equal(bad.status, 'failed'); assert.ok(!bad.lockSkipped);
    m.testRuntime.DB = unavailable;
    assert.equal((await m.backgroundGET(new Request('https://mizan.test', {headers: {'oai-authenticated-user-email': 'background-owner@example.test', cookie: 'mizan_admin=' + 'a'.repeat(64)}}))).status, 503);
  } finally { sqlite.close(); }
});

test('Background global contention does not clobber status or fetch; expired lease is recoverable', async () => {
  const {db, sqlite} = fixture(), oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('Unexpected fetch'); };
  try {
    sqlite.prepare('INSERT INTO research_state VALUES(?,?,?)').run('job:evaluate-due:last', '{"previous":true}', '2026-01-01');
    sqlite.prepare('INSERT INTO research_locks VALUES(?,?,?)').run('cron:resolution:v1', 'active', Date.now() + 90000);
    const result = await m.runResolutionCycle(db, {limit: 5, triggeredBy: 'manual'});
    assert.equal(result.status, 'locked'); assert.equal(result.lockAcquired, false); assert.equal(calls, 0); assert.deepEqual(await m.readLastRun(db), {previous: true});
    sqlite.prepare("UPDATE research_locks SET until_ms=0 WHERE id='cron:resolution:v1'").run();
    const recovered = await m.runResolutionCycle(db, {limit: 5, triggeredBy: 'manual'}); assert.equal(recovered.lockAcquired, true); assert.equal(recovered.status, 'completed');
  } finally { globalThis.fetch = oldFetch; sqlite.close(); }
});

test('SQL fingerprint guard stays idempotent even when performance leases are bypassed; legitimate A-B-A retained', async () => {
  const {db, sqlite} = fixture();
  try {
    seed(sqlite, ['MZSQL']); const id = sqlite.prepare('SELECT id FROM forecast_records').get().id;
    const unlocked = {...db, prepare(sql) { if (sql.startsWith('INSERT INTO research_locks')) return {bind() { return this; }, async first() { return {token: 'bypass-for-race-test'}; }}; return db.prepare(sql); }};
    const a = {state: 'complete', actualPrice: 106, actualDate: '2026-07-17', source: 'synthetic'}, b = {...a, actualPrice: 107};
    const results = await Promise.all(Array.from({length: 10}, () => m.saveEvaluationRevision(unlocked, id, a)));
    assert.equal(results.filter(Boolean).length, 1); assert.deepEqual(counts(sqlite), {forecast_outcomes: 1, evaluation_revisions: 1});
    await m.saveEvaluationRevision(db, id, b); await m.saveEvaluationRevision(db, id, a);
    const integrity = await m.checkResolutionIntegrity(db);
    assert.equal(integrity.revisionsDuplicates, 1, 'reverting a correction repeats history, not a duplicate write');
    assert.equal(integrity.consecutiveRevisionDuplicates, 0); assert.equal(integrity.revisionNumberDuplicates, 0);
    assert.deepEqual(counts(sqlite), {forecast_outcomes: 1, evaluation_revisions: 3});
    // Atomic rollback: no revision without its materialized outcome.
    sqlite.exec("CREATE TRIGGER qa_fail_outcome BEFORE UPDATE ON forecast_outcomes BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END");
    await assert.rejects(m.saveEvaluationRevision(db, id, {...a, actualPrice: 108}));
    assert.deepEqual(counts(sqlite), {forecast_outcomes: 1, evaluation_revisions: 3});
  } finally { sqlite.close(); }
});

test('Background maturity remains per forecast: newer due forecast resolves beside truncated old or long horizon', async () => {
  const {db, sqlite} = fixture(), oldFetch = globalThis.fetch; globalThis.fetch = networkFixture().fetch;
  try {
    seed(sqlite, ['MZPER'], {anchorDate: '2020-01-01'}); seed(sqlite, ['MZPER']); seed(sqlite, ['MZPER']);
    const newest = sqlite.prepare('SELECT id FROM forecast_records ORDER BY rowid DESC LIMIT 1').get().id;
    sqlite.prepare('UPDATE forecast_records SET horizon=252 WHERE id=?').run(newest);
    const result = await m.runResolutionCycle(db, {limit: 5, triggeredBy: 'manual'});
    assert.equal(result.evaluationsSaved, 1); assert.deepEqual(counts(sqlite), {forecast_outcomes: 1, evaluation_revisions: 1});
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM forecast_records').get().n, 3);
  } finally { globalThis.fetch = oldFetch; sqlite.close(); }
});

test('Background skips disabled markets, rotates attempts and never generates new forecasts', async () => {
  const {db, sqlite} = fixture(), oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('Unexpected network'); };
  try {
    seed(sqlite, ['MZROT1', 'MZROT2']);
    sqlite.prepare('INSERT INTO site_settings VALUES(1,?)').run(JSON.stringify({...m.DEFAULT_SETTINGS, enabledMarkets: ['sa']}));
    const a = await m.runResolutionCycle(db, {limit: 1, triggeredBy: 'manual'}), b = await m.runResolutionCycle(db, {limit: 1, triggeredBy: 'manual'});
    assert.equal(a.symbolsSkipped, 1); assert.equal(b.symbolsSkipped, 1); assert.notEqual(a.errors[0].symbol, b.errors[0].symbol); assert.equal(calls, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM forecast_records').get().n, 2); assert.equal(counts(sqlite).forecast_outcomes, 0);
  } finally { globalThis.fetch = oldFetch; sqlite.close(); }
});

test('Background reports committed evaluations before a later write failure and recovers without duplication', async () => {
  const {db, sqlite} = fixture(), oldFetch = globalThis.fetch; globalThis.fetch = networkFixture().fetch;
  try {
    seed(sqlite, ['MZPART', 'MZPART']);
    const secondId = sqlite.prepare('SELECT id FROM forecast_records ORDER BY rowid DESC LIMIT 1').get().id;
    sqlite.exec(`CREATE TRIGGER qa_partial BEFORE INSERT ON forecast_outcomes WHEN NEW.id='${secondId}' BEGIN SELECT RAISE(ABORT,'synthetic partial failure'); END`);
    const first = await m.runResolutionCycle(db, {limit: 5, triggeredBy: 'manual'});
    assert.equal(first.symbolsFailed, 1); assert.equal(first.evaluationsSaved, 1); assert.equal(first.status, 'partial');
    assert.deepEqual(counts(sqlite), {forecast_outcomes: 1, evaluation_revisions: 1});
    sqlite.exec('DROP TRIGGER qa_partial');
    const second = await m.runResolutionCycle(db, {limit: 5, triggeredBy: 'manual'});
    assert.equal(second.evaluationsSaved, 1); assert.deepEqual(counts(sqlite), {forecast_outcomes: 2, evaluation_revisions: 2});
    // Corrupt/normalized calendar dates do not turn into numeric evaluations.
    seed(sqlite, ['MZPART'], {anchorDate: '2026-02-30'}); seed(sqlite, ['MZPART']);
    sqlite.prepare('UPDATE forecast_records SET data=? WHERE rowid=(SELECT MAX(rowid) FROM forecast_records)').run('{broken');
    const invalid = await m.runResolutionCycle(db, {limit: 5, triggeredBy: 'manual'});
    assert.equal(invalid.evaluationsSaved, 0); assert.equal(invalid.fatalError, undefined);
  } finally { globalThis.fetch = oldFetch; sqlite.close(); }
});

test('Cron stays disabled by default, exact schedule required, timeout does not process late result', async () => {
  let calls = 0; const noDb = {prepare() { calls++; throw Error('Should not run'); }};
  await m.scheduledResolution({cron: m.RESOLUTION_CRON}, {DB: noDb});
  await m.scheduledResolution({cron: m.RESOLUTION_CRON}, {DB: noDb, MIZAN_BACKGROUND_CRON_ENABLED: 'false'});
  await m.scheduledResolution({cron: '* * * * *'}, {DB: noDb, MIZAN_BACKGROUND_CRON_ENABLED: 'true'});
  assert.equal(calls, 0); assert.equal(m.RESOLUTION_CRON, '0 */6 * * *');
  assert.match(readFileSync('vite.config.ts', 'utf8'), /triggers:\s*\{\s*crons:\s*\[EVALUATE_DUE_CRON, ACCURACY_SAMPLE_CRON, SCREENER_FOLLOWUP_CRON\]/);
  assert.match(readFileSync('worker/index.ts', 'utf8'), /ctx\.waitUntil\(scheduledResolution/);
  let release; const pending = new Promise(resolve => { release = resolve; }); let consumed = false;
  await assert.rejects(m.withResolutionTimeout(pending, 5).then(() => { consumed = true; }), /fetch-timeout/);
  release(1); await Promise.resolve(); assert.equal(consumed, false);
});


test('Scheduled runs persist the required state and manual work never proves Cron',async()=>{
  const {db,sqlite}=fixture(),network=networkFixture(),oldFetch=globalThis.fetch;
  globalThis.fetch=network.fetch;
  try{
    assert.equal((await m.forecastSchedulerStatus(db)).configured,false);
    const manual=await m.runResolutionCycle(db,{limit:5,triggeredBy:'manual'});
    assert.equal(manual.stateSaved,true);assert.equal((await m.forecastSchedulerStatus(db)).configured,false);
    seed(sqlite,['MZCRON1','MZCRON2']);
    const event={cron:m.RESOLUTION_CRON,scheduledTime:Date.now()};
    const first=await m.scheduledResolution(event,{DB:db,MIZAN_BACKGROUND_CRON_ENABLED:'true'});
    assert.equal(first.evaluationsSaved,2);assert.equal(first.symbolsScanned,2);
    const second=await m.scheduledResolution(event,{DB:db,MIZAN_BACKGROUND_CRON_ENABLED:'true'});
    assert.equal(second.evaluationsSaved,0);assert.equal(second.symbolsScanned,0);
    assert.equal((await m.forecastSchedulerStatus(db)).configured,true);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM forecast_outcomes').get().n,2);
    assert.deepEqual(JSON.parse(sqlite.prepare("SELECT data FROM research_state WHERE id='job:evaluate-due:last'").get().data),second);
    await m.runResolutionCycle(db,{limit:5,triggeredBy:'manual'});
    assert.equal((await m.forecastSchedulerStatus(db)).configured,true);
    sqlite.prepare("UPDATE research_state SET data='{}' WHERE id='job:evaluate-due:last-cron'").run();
    assert.equal((await m.forecastSchedulerStatus(db)).configured,false);
  }finally{globalThis.fetch=oldFetch;sqlite.close();}
});

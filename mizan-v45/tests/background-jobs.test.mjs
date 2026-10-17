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
  assert.match(readFileSync('vite.config.ts', 'utf8'), /triggers:\s*\{\s*crons:\s*\[EVALUATE_DUE_CRON, ACCURACY_SAMPLE_CRON, DAILY_ARCHIVE_CRON, SCREENER_FOLLOWUP_CRON, MAINTENANCE_SLOT_CRON\]/);
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

test('Each cron invocation starts exactly one heavy job; at most 5 distinct triggers', async () => {
  const crons = [m.EVALUATE_DUE_CRON, m.ACCURACY_SAMPLE_CRON, m.DAILY_ARCHIVE_CRON, m.SCREENER_FOLLOWUP_CRON, m.MAINTENANCE_SLOT_CRON];
  assert.equal(new Set(crons).size, crons.length); assert.ok(crons.length <= 5);
  assert.equal(m.DAILY_ARCHIVE_CRON, '*/5 * * * *'); // scripts/verify-daily-archive.mjs observes this exact string
  assert.notEqual(m.SCREENER_FOLLOWUP_CRON, m.DAILY_ARCHIVE_CRON);
  assert.equal(m.RESOLUTION_CRON, m.EVALUATE_DUE_CRON); assert.equal(m.FORECAST_SEED_CRON, m.DAILY_ARCHIVE_CRON);
  for (const c of [m.MARKET_COLLECTION_CRON, m.MARKET_WATCH_CRON, m.COUNCIL_CRON]) assert.equal(c, m.MAINTENANCE_SLOT_CRON);
  const handlers = {resolution: m.scheduledResolution, accuracy: m.scheduledAccuracySample, watch: m.scheduledMarketWatch, collection: m.scheduledMarketCollection,
    seed: m.scheduledForecastSeed, council: m.scheduledCouncil, screener: m.scheduledScreenerFollowup};
  // A DB that throws on first use: proves a handler started, without network or real work.
  async function started(controller) {
    const names = [];
    for (const [name, handler] of Object.entries(handlers)) {
      let used = false; const DB = {prepare() { used = true; throw Error('fixture-stop'); }, batch() { used = true; throw Error('fixture-stop'); }};
      const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
      try { await handler(controller, {DB, MIZAN_BACKGROUND_CRON_ENABLED: 'true'}); } catch {} finally { console.log = log; console.error = err; }
      if (used) names.push(name);
    }
    return names;
  }
  const at = (iso) => Date.parse(iso);
  assert.deepEqual(await started({cron: m.EVALUATE_DUE_CRON, scheduledTime: at('2026-10-17T06:00:00Z')}), ['resolution']);
  assert.deepEqual(await started({cron: m.ACCURACY_SAMPLE_CRON, scheduledTime: at('2026-10-17T03:00:00Z')}), ['accuracy']);
  assert.deepEqual(await started({cron: m.DAILY_ARCHIVE_CRON, scheduledTime: at('2026-10-17T06:05:00Z')}), ['seed']);
  assert.deepEqual(await started({cron: m.SCREENER_FOLLOWUP_CRON, scheduledTime: at('2026-10-17T06:07:00Z')}), ['screener']);
  for (const h of ['00', '06', '12', '18']) assert.deepEqual(await started({cron: m.MAINTENANCE_SLOT_CRON, scheduledTime: at(`2026-10-17T${h}:30:00Z`)}), ['collection'], h);
  for (const h of ['01', '07', '13', '19']) assert.deepEqual(await started({cron: m.MAINTENANCE_SLOT_CRON, scheduledTime: at(`2026-10-17T${h}:30:00Z`)}), ['watch'], h);
  assert.deepEqual(await started({cron: m.MAINTENANCE_SLOT_CRON, scheduledTime: at('2026-10-17T04:30:00Z')}), ['council']);
  assert.deepEqual(await started({cron: m.MAINTENANCE_SLOT_CRON, scheduledTime: at('2026-10-17T05:30:00Z')}), []);
  assert.deepEqual(await started({cron: m.MAINTENANCE_SLOT_CRON}), []);
  // Every hour listed in the slot expression maps to a job, and every job hour is listed.
  const hours = m.MAINTENANCE_SLOT_CRON.split(' ')[1].split(',').map(Number);
  for (let h = 0; h < 24; h++) assert.equal(m.slotJob({cron: m.MAINTENANCE_SLOT_CRON, scheduledTime: Date.UTC(2026, 9, 17, h, 30)}) !== null, hours.includes(h), String(h));
});

test('Manual background run is capped at 5 symbols per HTTP request', async () => {
  const {db, sqlite} = fixture();
  try {
    const req = await ownerFixture(db);
    for (const raw of ['{"limit":6}', '{"limit":20}', '{"limit":100}']) {
      const r = await m.backgroundPOST(req(raw)); assert.equal(r.status, 400, raw); assert.match((await r.json()).error, /بين 1 و5/);
    }
  } finally { sqlite.close(); }
});

test('Screener route: same-origin, one-batch cap, and non-retryable errors are not 503', async () => {
  const {db, sqlite} = fixture(); m.testRuntime.DB = db;
  const post = (body, headers = {}) => m.screenerPOST(new Request('https://mizan.test/api/screener', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://mizan.test', ...headers}, body: JSON.stringify(body)}));
  const oldFetch = globalThis.fetch; let network = 0; globalThis.fetch = async () => { network++; throw Error('no network in this test'); };
  try {
    let r = await post({}, {origin: 'https://evil.test'}); assert.equal(r.status, 403);
    r = await post({}); assert.equal(r.status, 400); assert.equal((await r.json()).error, 'السوق غير مدعوم.'); // verify-deployment contract
    r = await post({market: 'sa', horizonSessions: 5, resultCount: 5, scanLimit: 200}); assert.equal(r.status, 400); assert.match((await r.json()).error, /دفعة واحدة/);
    r = await post({market: 'sa', horizonSessions: 5, resultCount: 5, scanLimit: 20, symbols: ['2222.SR', '1120.SR', '2010.SR']}); assert.equal(r.status, 400);
    assert.equal(network, 0, 'capped requests never reach providers');
    // Archive errors: build a real archive row, then exercise lease / order / expiry / token paths.
    const token = 'a'.repeat(64), id = crypto.randomUUID(), plan = {market: 'sa', horizonSessions: 5, resultCount: 5, scanLimit: 5, symbols: ['2222.SR', '1120.SR'], batchSize: 1, modelVersion: 'v'};
    sqlite.prepare('INSERT INTO screener_runs(id,token_hash,created_at,status,plan_json) VALUES(?,?,?,?,?)').run(id, await m.archiveFingerprint(token), new Date().toISOString(), 'scanning', JSON.stringify(plan));
    r = await post({action: 'archive-batch', runId: id, runToken: 'b'.repeat(64), batchIndex: 0}); assert.equal(r.status, 404);
    r = await post({action: 'archive-batch', runId: id, runToken: 'short', batchIndex: 0}); assert.equal(r.status, 400);
    r = await post({action: 'archive-batch', runId: id, runToken: token, batchIndex: 1}); assert.equal(r.status, 400); assert.match((await r.json()).error, /بالترتيب/);
    r = await post({action: 'archive-batch', runId: id, runToken: token, batchIndex: 9}); assert.equal(r.status, 400);
    r = await post({action: 'complete', runId: id, runToken: token}); assert.equal(r.status, 400);
    sqlite.prepare('INSERT INTO research_locks(id,token,until_ms) VALUES(?,?,?)').run('screener:' + id, 'other', Date.now() + 60000);
    r = await post({action: 'archive-batch', runId: id, runToken: token, batchIndex: 0}); assert.equal(r.status, 409); assert.ok(Number(r.headers.get('retry-after')) > 0);
    sqlite.prepare('DELETE FROM research_locks').run();
    sqlite.prepare('UPDATE screener_runs SET created_at=? WHERE id=?').run(new Date(Date.now() - 3 * 3600000).toISOString(), id);
    r = await post({action: 'archive-batch', runId: id, runToken: token, batchIndex: 0}); assert.equal(r.status, 410);
    assert.equal(network, 0);
  } finally { globalThis.fetch = oldFetch; sqlite.close(); }
});

test('Temporal route: invalid input is 400, storage failure stays 503', async () => {
  const {db, sqlite} = fixture(); m.testRuntime.DB = db;
  try {
    let r = await m.temporalGET(new Request('https://mizan.test/api/temporal?symbol=&date=2099-01-01')); assert.equal(r.status, 400);
    r = await m.temporalPOST(new Request('https://mizan.test/api/temporal', {method: 'POST', headers: {origin: 'https://mizan.test'}, body: '{"action":"other"}'})); assert.equal(r.status, 400);
    r = await m.temporalPOST(new Request('https://mizan.test/api/temporal', {method: 'POST', headers: {origin: 'https://mizan.test'}, body: '{'})); assert.equal(r.status, 400);
    r = await m.temporalPOST(new Request('https://mizan.test/api/temporal', {method: 'POST', headers: {origin: 'https://mizan.test'}, body: JSON.stringify({action: 'reveal', symbol: 'AAPL', date: '2099-01-01'})})); assert.equal(r.status, 400);
    m.testRuntime.DB = {prepare() { throw Error('D1_ERROR: storage down'); }};
    r = await m.temporalGET(new Request('https://mizan.test/api/temporal?symbol=AAPL&date=2026-01-02')); assert.equal(r.status, 503);
    assert.doesNotMatch((await r.json()).error, /D1_ERROR/);
  } finally { m.testRuntime.DB = db; sqlite.close(); }
});

test('Market watch picks the latest public forecast per horizon in SQL (long horizons are not crowded out)', async () => {
  const {db, sqlite} = fixture();
  try {
    const add = (id, horizon, at, recordClass) => sqlite.prepare('INSERT INTO forecast_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, 's-' + id, 'AAPL', at, horizon, 'm', 'us', 'x', 'منخفض', 1, JSON.stringify({id, horizon, recordClass, predictedPrice: horizon, createdAt: at}));
    for (let i = 0; i < 60; i++) add('h1-' + i, 1, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), 'prospective-public');
    add('h252-old', 252, '2026-01-01T00:00:00.000Z', 'prospective-public');
    add('h252-new', 252, '2026-02-01T00:00:00.000Z', 'prospective-public');
    add('h252-private', 252, '2026-03-01T00:00:00.000Z', 'research-private');
    add('h21-private', 21, '2026-03-01T00:00:00.000Z', 'research-private');
    const rows = await m.latestPublicForecasts(db, 'AAPL');
    assert.deepEqual(rows.map(r => [r.horizon, r.id]), [[1, 'h1-59'], [252, 'h252-new']]);
    assert.ok(rows.every(r => r.recordClass === 'prospective-public'));
  } finally { sqlite.close(); }
});

test('Council: a run left running past the lease reads as failed and is closed at the next run start', async () => {
  const {db, sqlite} = fixture();
  try {
    const old = new Date(Date.now() - m.COUNCIL_STALE_MS - 60000).toISOString(), fresh = new Date().toISOString();
    assert.equal(m.effectiveCouncilStatus('running', old), 'failed');
    assert.equal(m.effectiveCouncilStatus('running', fresh), 'running');
    assert.equal(m.effectiveCouncilStatus('partial', old), 'partial');
    sqlite.prepare('INSERT INTO council_runs(id,created_at,updated_at,trigger,status,task,data) VALUES(?,?,?,?,?,?,?)').run('stale-run', old, old, 'cron', 'running', 't', JSON.stringify({status: 'running', executionStatus: 'running'}));
    const status = await m.councilStatus(db, {DB: db});
    assert.equal(status.latest.status, 'failed'); assert.equal(status.latest.executionStatus, 'failed');
    assert.equal(sqlite.prepare("SELECT status FROM council_runs WHERE id='stale-run'").get().status, 'running', 'read side does not write');
    // Next run start (reused requestKey path: no providers are called) closes the stale row.
    const task = m.normalizeCouncilTask('fixture task'), key = 'stale-check';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${m.COUNCIL_VERSION}|manual|${key}|${task}`));
    const id = 'council-' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    sqlite.prepare('INSERT INTO council_runs(id,created_at,updated_at,trigger,status,task,data) VALUES(?,?,?,?,?,?,?)').run(id, fresh, fresh, 'manual', 'partial', task, JSON.stringify({status: 'partial', id}));
    const reused = await m.runCouncil(db, {DB: db}, {task: 'fixture task', trigger: 'manual', requestKey: key});
    assert.equal(reused.reused, true);
    const row = sqlite.prepare("SELECT status,data FROM council_runs WHERE id='stale-run'").get();
    assert.equal(row.status, 'failed'); assert.equal(JSON.parse(row.data).executionStatus, 'failed');
    assert.equal(sqlite.prepare('SELECT status FROM council_runs WHERE id=?').get(id).status, 'partial', 'fresh rows untouched');
  } finally { sqlite.close(); }
});

test('Admin dashboard performance is unchanged after moving totals to SQL', async () => {
  const {db, sqlite} = fixture();
  try {
    m.testRuntime.DB = db; m.testRuntime.RECOMMENDATION_OWNER_EMAIL = 'owner@example.test'; m.testRuntime.ADMIN_PASSWORD_HASH = await m.hashPin('246810');
    const outcome = (state, ok, day) => JSON.stringify(state === 'complete' ? {state, actualDate: day, directionCorrect: ok, rangeHit: !ok, priceErrorPct: ok ? 1.5 : 4, metrics: {baselineErrorPct: 3, movementErrorPp: 2}} : {state});
    let n = 0;
    for (const symbol of ['AAPL', 'MSFT', '2222.SR']) for (const horizon of [1, 5, 21]) for (let d = 1; d <= 12; d++) {
      const id = 'f' + (++n), at = `2026-0${1 + (d % 6)}-${String(d + 10).padStart(2, '0')}T00:00:00Z`, cls = n % 7 === 0 ? 'research-private' : n % 11 === 0 ? null : 'prospective-public';
      sqlite.prepare('INSERT INTO forecast_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, 's' + id, symbol, at, horizon, 'model-a', symbol.endsWith('.SR') ? 'sa' : 'us', 'tech', 'منخفض', n % 5 ? 1 : 0, JSON.stringify(cls ? {recordClass: cls} : {}));
      if (n % 4 !== 0) sqlite.prepare('INSERT INTO forecast_outcomes VALUES(?,?,?)').run(id, at, outcome(n % 9 === 0 ? 'excluded' : 'complete', n % 3 !== 0, at.slice(0, 10)));
    }
    const legacy = sqlite.prepare("SELECT f.id,f.symbol,f.created_at,f.horizon,f.model,f.market,f.sector,f.confidence,f.available,COALESCE(json_extract(f.data,'$.recordClass'),'legacy-unverified') AS recordClass,o.data AS outcome_data FROM forecast_records f LEFT JOIN forecast_outcomes o ON o.id=f.id").all();
    const expected = m.performanceStats(legacy.map(r => ({...r, outcome: r.outcome_data ? JSON.parse(r.outcome_data) : null})));
    const req = (body, cookie = '') => new Request('https://example.test/api/admin', {method: 'POST', headers: {origin: 'https://example.test', 'content-type': 'application/json', 'oai-authenticated-user-email': 'owner@example.test', cookie}, body: JSON.stringify(body)});
    const login = await m.adminPOST(req({action: 'login', username: 'azoz', password: '246810'})); assert.equal(login.status, 200);
    const {performance} = await login.json();
    const {sampleCap, sampleCapReached, ...rest} = performance;
    assert.equal(sampleCapReached, false); assert.ok(sampleCap > 0);
    assert.deepEqual(rest, JSON.parse(JSON.stringify(expected)));
    assert.ok(expected.total > 0 && expected.completed > 0 && expected.excluded > 0 && expected.excludedFromPublic > 0 && expected.abstained > 0);
  } finally { sqlite.close(); }
});

test('Aziz import closes stale running rows and bounds provider fetches', async () => {
  const {db, sqlite} = fixture();
  try {
    m.testRuntime.DB = db; m.testRuntime.RECOMMENDATION_OWNER_EMAIL = 'owner@example.test'; m.testRuntime.TWELVE_DATA_API_KEY = 'fixture-key';
    const token = await m.adminLogin(db, await m.hashPin('123456'), 'azoz', '123456');
    const old = new Date(Date.now() - 3600000).toISOString(), recent = new Date(Date.now() - 60000).toISOString();
    for (const [id, at] of [['stale', old], ['recent', recent]]) sqlite.prepare('INSERT INTO aziz_import_runs(id,started_at,requested_batch,status,provider,requested_symbols_json,created_at) VALUES(?,?,?,?,?,?,?)').run(id, at, 1, 'running', 'twelve_data', '[]', at);
    const signals = []; const oldFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { signals.push(init?.signal); return Response.json({status: 'error', message: 'fixture provider refusal'}, {status: 429}); };
    try {
      const r = await m.azizImportPOST(new Request('https://mizan.test/api/admin/aziz/import', {method: 'POST', headers: {origin: 'https://mizan.test', 'oai-authenticated-user-email': 'owner@example.test', cookie: 'mizan_admin=' + token}, body: '{"batch":1}'}));
      assert.equal(r.status, 207, await r.clone().text());
    } finally { globalThis.fetch = oldFetch; delete m.testRuntime.TWELVE_DATA_API_KEY; }
    assert.ok(signals.length === 4 && signals.every(s => s instanceof AbortSignal));
    assert.equal(sqlite.prepare("SELECT status FROM aziz_import_runs WHERE id='stale'").get().status, 'failed');
    assert.equal(sqlite.prepare("SELECT status FROM aziz_import_runs WHERE id='recent'").get().status, 'running');
  } finally { sqlite.close(); }
});

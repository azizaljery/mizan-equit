// Isolated integration of the BUILT site Worker + local Cloudflare D1.
// All prices, identities and sessions below are synthetic. Never targets production.
import assert from 'node:assert/strict';
import {Miniflare, createFetchMock} from 'miniflare';
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash, randomBytes, randomUUID} from 'node:crypto';

const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
assert.deepEqual(config.triggers?.crons, ['0 */6 * * *'], 'The generated config must contain the one accepted schedule.');
const fetchMock = createFetchMock(); fetchMock.disableNetConnect();
let networkRequests = 0;
fetchMock.get(/.*/).intercept({path: /.*/, method: 'GET'}).reply(200, options => {
  networkRequests++;
  const url = new URL(options.path, options.origin);
  if (url.hostname.endsWith('yahoo.com') && url.pathname.startsWith('/v8/finance/chart/')) {
    const symbol = decodeURIComponent(url.pathname.split('/').at(-1));
    const timestamp = [];
    for (let ms = Date.parse('2026-06-01T12:00:00Z'); ms < Date.parse('2026-09-01'); ms += 864e5) if (![0, 6].includes(new Date(ms).getUTCDay())) timestamp.push(ms / 1000);
    const close = timestamp.map((_, i) => 100 + i * .2);
    return JSON.stringify({chart: {result: [{meta: {symbol, instrumentType: symbol.startsWith('^') ? 'INDEX' : 'EQUITY', currency: 'USD', exchangeName: 'NMS', fullExchangeName: 'NASDAQ', longName: 'SYNTHETIC ' + symbol, regularMarketTime: timestamp.at(-1), regularMarketPrice: close.at(-1), dataGranularity: '1d'}, timestamp, indicators: {quote: [{open: close, close, high: close.map(x => x + 1), low: close.map(x => x - 1), volume: close.map(() => 100000)}]}, events: {}}], error: null}});
  }
  return JSON.stringify({quotes: [], news: [], timeseries: {result: []}, finance: {result: []}, quoteSummary: {result: []}});
}, {headers: {'content-type': 'application/json'}}).persist();

const mf = new Miniflare({modules: true, scriptPath: resolve('dist/server/index.js'), modulesRules: [{type: 'ESModule', include: ['**/*.js']}], compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags, assets: {directory: resolve('dist/client'), binding: 'ASSETS', routerConfig: {has_user_worker: true, invoke_user_worker_ahead_of_assets: true}}, d1Databases: {DB: 'mizan-background-isolated-test'}, bindings: {RECOMMENDATION_OWNER_EMAIL: 'background-owner@example.test', MIZAN_BACKGROUND_CRON_ENABLED: 'true'}, fetchMock});
try {
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) {
    for (const sql of readFileSync('drizzle/' + file, 'utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
  }
  // Session is created only in this throwaway database; not a production credential.
  const token = randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO admin_access(id,session_hash,expires_at) VALUES(1,?,?)').bind(createHash('sha256').update(token).digest('hex'), Date.now() + 600000).run();
  for (let i = 1; i <= 5; i++) {
    const symbol = 'MZQA' + i, snapshot = randomUUID();
    await db.prepare('INSERT INTO analysis_snapshots VALUES(?,?,?,?)').bind(snapshot, symbol, '2026-07-11T00:00:00Z', '{"synthetic":true}').run();
    await db.prepare('INSERT INTO forecast_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(randomUUID(), snapshot, symbol, '2026-07-11T00:00:00Z', 5, 'synthetic-background-test', 'us', 'fixture', 'منخفض', 1, JSON.stringify({anchorDate: '2026-07-10', price: 100, predictedPrice: 110, range: [108, 112], direction: 'صاعد', currency: 'USD', evaluationPolicy: 'mizan-end-close-v2'})).run();
  }
  const recentId=randomUUID(),recentSnapshot=randomUUID(),recentAt=new Date().toISOString();
  await db.prepare('INSERT INTO analysis_snapshots VALUES(?,?,?,?)').bind(recentSnapshot,'MZNOTDUE',recentAt,'{"synthetic":true}').run();
  await db.prepare('INSERT INTO forecast_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(recentId,recentSnapshot,'MZNOTDUE',recentAt,252,'synthetic-background-test','us','fixture','منخفض',1,JSON.stringify({anchorDate:recentAt.slice(0,10),price:100,predictedPrice:110,range:[108,112],direction:'صاعد',currency:'USD',evaluationPolicy:'mizan-end-close-v2'})).run();
  const origin = 'https://mizan-local.test';
  const headers = {origin, 'content-type': 'application/json', 'oai-authenticated-user-email': 'background-owner@example.test', cookie: 'mizan_admin=' + token};
  const request = (body, overrides = {}) => mf.dispatchFetch(origin + '/api/admin/run-background', {method: 'POST', headers: {...headers, ...overrides}, body: JSON.stringify(body)});
  const counts = async () => ({forecast_outcomes: (await db.prepare('SELECT COUNT(*) n FROM forecast_outcomes').first()).n, evaluation_revisions: (await db.prepare('SELECT COUNT(*) n FROM evaluation_revisions').first()).n});
  const originals = await db.prepare('SELECT * FROM forecast_records ORDER BY id').all();
  const before = await counts(), validation = {};
  for (const limit of [500, 0, 'abc']) { const response = await request({limit}); validation[String(limit)] = response.status; assert.equal(response.status, 400); await response.text(); }
  const forbidden = await request({}, {cookie: ''}); assert.equal(forbidden.status, 401); await forbidden.text();
  const worker=await mf.getWorker();
  const firstEvent=await worker.scheduled({cron:config.triggers.crons[0],scheduledTime:Date.now()});
  assert.equal(firstEvent.outcome,'ok');
  const first=JSON.parse((await db.prepare("SELECT data FROM research_state WHERE id='job:evaluate-due:last'").first()).data);
  assert.equal(first.evaluationsSaved, 5); assert.equal(first.symbolsScanned, 5); assert.equal(first.symbolsFailed, 0); assert.equal(first.stateSaved, true);
  const afterFirst = await counts(), firstRequests = networkRequests;
  const secondEvent=await worker.scheduled({cron:config.triggers.crons[0],scheduledTime:Date.now()});
  assert.equal(secondEvent.outcome,'ok');
  const second=JSON.parse((await db.prepare("SELECT data FROM research_state WHERE id='job:evaluate-due:last'").first()).data);
  assert.equal(second.limit, 20); assert.equal(second.evaluationsSaved, 0); assert.equal(second.symbolsScanned, 0); assert.equal(networkRequests, firstRequests);
  assert.equal(await db.prepare('SELECT id FROM forecast_outcomes WHERE id=?').bind(recentId).first(),null);
  const afterSecond = await counts(); assert.deepEqual(afterFirst, {forecast_outcomes: 5, evaluation_revisions: 5}); assert.deepEqual(afterSecond, afterFirst);
  assert.deepEqual((await db.prepare('SELECT * FROM forecast_records ORDER BY id').all()).results, originals.results);
  const integrity = {
    outcomesDuplicates: (await db.prepare('SELECT id FROM forecast_outcomes GROUP BY id HAVING COUNT(*)>1').all()).results.length,
    revisionsDuplicates: (await db.prepare('SELECT forecast_id,fingerprint FROM evaluation_revisions GROUP BY forecast_id,fingerprint HAVING COUNT(*)>1').all()).results.length,
  }; assert.deepEqual(integrity, {outcomesDuplicates: 0, revisionsDuplicates: 0});
  const last = JSON.parse((await db.prepare("SELECT data FROM research_state WHERE id='job:evaluate-due:last'").first()).data); assert.deepEqual(last, second);
  const get = await mf.dispatchFetch(origin + '/api/admin/run-background', {headers}); assert.equal(get.status, 200); assert.deepEqual((await get.json()).lastRun, last);
  const stateRoutes = {};
  for (const query of ['mode=list&limit=2','mode=keys&limit=2','mode=exists&id=job:evaluate-due:last-cron','mode=fields&id=job:evaluate-due:last-cron&fields=evaluationsSaved,symbolsScanned,symbolsFailed,lockAcquired,stateSaved','mode=slices&id=job:evaluate-due:last-cron&length=100']) {
    const response = await mf.dispatchFetch(origin + '/api/admin/state?' + query, {headers});
    assert.equal(response.status, 200, query); stateRoutes[query] = await response.json();
  }
  assert.equal(stateRoutes['mode=exists&id=job:evaluate-due:last-cron'].exists, true);
  const projected = stateRoutes['mode=fields&id=job:evaluate-due:last-cron&fields=evaluationsSaved,symbolsScanned,symbolsFailed,lockAcquired,stateSaved'].fields;
  assert.equal(projected.evaluationsSaved, 0); assert.equal(projected.lockAcquired, true); assert.equal(projected.stateSaved, true);
  const deniedState = await mf.dispatchFetch(origin + '/api/admin/state?mode=keys', {headers: {origin}});
  assert.equal(deniedState.status, 403); await deniedState.text();
  const regression = {};
  for (const path of ['/api/site-settings']) {
    const response = await mf.dispatchFetch(origin + path, {headers}); regression[path] = response.status; assert.equal(response.status, 200, path); await response.text();
  }
  const report = {testedAt: new Date().toISOString(), environment: 'Built production Worker under local workerd/Miniflare + real local D1 binding; synthetic prices and isolated owner session, NOT production', cronEnabled: true, firstEvent, secondEvent, validation, before, first, afterFirst, second, afterSecond, integrity, research_state: {id: 'job:evaluate-due:last', data: last}, regression, networkRequests};
  report.stateRoutes = stateRoutes;
  writeFileSync(process.env.MIZAN_WORKER_QA_REPORT || 'docs/qa/sources-cron-workerd-2026-09-12.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await mf.dispose(); }

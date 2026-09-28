import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectChecks,backtestOk,privateChecks} from '../scripts/verification-checks.mjs';
import {renderHtml,renderMarkdown,summarizeReport} from '../scripts/verification-report.mjs';
const m=await import(process.env.MIZAN_TEST_MODULE);
const cronFixture=()=>({runId:'scheduled-fixture',triggeredBy:'cron',cron:'0 */6 * * *',scheduledTime:Date.parse('2026-09-13T06:00:00Z'),startedAt:'2026-09-13T06:00:00.000Z',finishedAt:'2026-09-13T06:00:01.000Z',durationMs:1000,lockAcquired:true,stateSaved:true,status:'completed',symbolsScanned:0,symbolsResolved:0,symbolsSkipped:0,symbolsFailed:0,evaluationsSaved:0});
test('Verification rejects absent, malformed, stale, future, failed, partial or inconsistent Cron evidence',async()=>{
 const {db,sqlite,sqls}=fixture(),now=Date.parse('2026-09-13T07:00:00Z'),key='job:evaluate-due:last-cron';
 try{
  assert.equal((await m.verifyCronState(db,now)).status,'missing');
  for(const [changes,status] of [[{},'completed'],[{triggeredBy:'manual'},'invalid'],[{scheduledTime:1},'invalid'],[{durationMs:5},'invalid'],[{symbolsScanned:1},'invalid'],[{symbolsScanned:null},'invalid'],[{status:'failed'},'failed'],[{status:'partial'},'partial'],[{symbolsScanned:1,symbolsSkipped:1},'partial'],[{finishedAt:'2099-01-01T00:00:00Z'},'invalid'],[{lockAcquired:false},'invalid'],[{stateSaved:false},'invalid'],[{runId:['x']},'invalid']]){
   const data={...cronFixture(),...changes};sqlite.prepare('DELETE FROM research_state WHERE id=?').run(key);put(sqlite,key,data,data.finishedAt);const r=await m.verifyCronState(db,now);assert.equal(r.status,status,JSON.stringify(changes));assert.equal(r.ok,status==='completed');
  }
  sqlite.prepare('DELETE FROM research_state WHERE id=?').run(key);put(sqlite,key,cronFixture(),cronFixture().finishedAt);assert.equal((await m.verifyCronState(db,now+8*3600000)).status,'stale');
  put(sqlite,'job:evaluate-due:last',cronFixture(),cronFixture().finishedAt);assert.equal((await m.verifyManualState(db,now)).status,'not_manual');
  sqlite.prepare('UPDATE research_state SET data=? WHERE id=?').run('{bad',key);assert.equal((await m.verifyCronState(db,now)).status,'invalid');
  assert.ok(sqls.every(sql=>!/^\s*(INSERT|UPDATE|DELETE|DROP)/i.test(sql)));
 }finally{sqlite.close();}
});
test('Forecast snapshot is exclusive and counts the actual journal; integrity is not idempotency proof',async()=>{
 const {db,sqlite}=fixture();try{
  const states=['complete','excluded',null,'broken','complete'];
  for(const [i,state] of states.entries()){const id=seed(sqlite,'MZ'+i);if(state)sqlite.prepare('INSERT INTO forecast_outcomes VALUES(?,?,?)').run(id,'2026-09-13T07:00:00Z',state==='broken'?'{bad':JSON.stringify({state}));if(i===4)sqlite.prepare('UPDATE forecast_records SET available=0 WHERE id=?').run(id);}
  const result=await m.verifyForecastSnapshot(db);assert.equal(result.total,5);assert.deepEqual(result.byStatus,{evaluated:1,pending:1,unavailable:1,excluded:1,invalid:1});assert.equal(Object.values(result.byStatus).reduce((a,b)=>a+b,0),result.total);
  const integrity=await m.verifyIdempotency(db);assert.equal(integrity.integrityOk,true);assert.equal(integrity.outcomeCount,4);assert.equal(integrity.ok,false);assert.equal(integrity.proven,false);
  const broken={prepare(sql){if(sql.includes('LAG('))throw Error('unavailable');return db.prepare(sql);}};
  assert.equal((await m.verifyIdempotency(broken)).integrityOk,null);
 }finally{sqlite.close();}
});
test('Verify and dashboard preserve owner/admin gates, support direct GET, sanitize partial failures, never write journals',async()=>{
 const {db,sqlite,sqls}=fixture();try{
  const headers=await owner(db),make=(extra={})=>new Request('https://mizan.test/api/admin/verify',{headers:{...headers,...extra}});
  for(const route of [m.adminVerifyGET,m.adminDashboardGET]){
   assert.equal((await route(make({'oai-authenticated-user-email':'other@example.test'}))).status,403);assert.equal((await route(make({cookie:''}))).status,401);assert.equal((await route(make({origin:'https://evil.test'}))).status,403);assert.equal((await route(make({'sec-fetch-site':'cross-site'}))).status,403);
   const direct=make();direct.headers.delete('origin');sqls.length=0;const response=await route(direct);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/charset=utf-8/);assert.match(response.headers.get('cache-control'),/no-store/);const body=await response.json();assert.equal(body.overall,'partial');assert.equal(body.checks.cron.ok,false);assert.equal(body.checks.idempotency.ok,false);assert.equal(body.readOnly,true);assert.ok(sqls.every(sql=>!/^\s*(INSERT|UPDATE|DELETE|DROP)/i.test(sql)));
  }
  const broken={prepare(sql){if(sql.includes('WITH classified'))throw Error('secret internal details');return db.prepare(sql);}};
  const result=await m.verifyProductionState(broken);assert.equal(result.overall,'fail');assert.equal(result.checks.cron.status,'missing');assert.equal(result.checks.forecasts.status,'unavailable');assert.ok(!JSON.stringify(result).includes('secret internal'));
  // The dashboard joins symbol/horizon instead of requesting non-existent outcome columns.
  const id=seed(sqlite);sqlite.prepare('INSERT INTO forecast_outcomes VALUES(?,?,?)').run(id,'2026-09-13T07:00:00Z',JSON.stringify({state:'excluded'}));const dash=await (await m.adminDashboardGET(make())).json();assert.equal(dash.recentOutcomes.ok,true);assert.equal(dash.recentOutcomes.rows[0].symbol,'MZAUDIT');assert.equal(dash.recentOutcomes.rows[0].state,'excluded');
 }finally{sqlite.close();}
});
test('Full verification defaults to reads, treats semantic failures as failures, explicit mutations run only once',async()=>{
 const calls=[],value={readOnly:true,checks:{cron:{ok:false},forecasts:{ok:true,total:7},idempotency:{ok:false,integrityOk:true}}};
 const request=async(path,options={})=>{calls.push({path,...options});if(path.includes('/verify'))return value;if(path.includes('mode=keys'))return {keys:[],hasMore:false};if(path.includes('mode=exists'))return {exists:false};if(path.includes('mode=fields'))return {fields:{runId:'r'}};if(path.includes('mode=list'))return {rows:[],total:100};if(path.includes('run-background'))return {summary:{status:'completed',triggeredBy:'manual',stateSaved:true,lockAcquired:true,symbolsFailed:0,evaluationsSaved:0}};if(path.includes('backtest'))return {kind:'mizan-issued-forecast-audit-v1',persisted:true,symbolsSucceeded:3,symbolsFailed:[],byHorizon:[{completed:0}]};if(path.includes('private'))return {unavailable:true};throw Error('Unexpected route');};
 const read=await collectChecks({request});assert.ok(calls.every(c=>!c.method||c.method==='GET'));assert.equal(read.cronExists.ok,false);assert.equal(read.verifyBefore.ok,false);assert.equal(read.forecasts.value.total,7);assert.equal(read.private.status,'not_run');assert.equal(read.idempotency.status,'not_run');
 calls.length=0;const run=await collectChecks({request,run:true,symbols:['AAPL','MSFT'],pin:'123456',startDate:'2026-01-01',endDate:'2026-09-01',runId:'one'});
 assert.equal(calls.filter(c=>c.path==='/api/admin/run-background').length,1);assert.equal(calls.filter(c=>c.path==='/api/admin/backtest').length,1);assert.equal(calls.filter(c=>c.path==='/api/private-recommendation').length,1);assert.equal(run.private_MSFT.status,'not_run');assert.equal(run.backtestSingle.ok,false);assert.ok(!JSON.stringify(run).includes('123456'));
 assert.equal(backtestOk({persisted:false,byHorizon:[{completed:10}]}),false);assert.equal(privateChecks({decision:{},forecast:{rows:Array(6).fill({sessions:5}),recorded:true}},'AAPL').forecasts,false);
});
test('HTML/Markdown reports escape injected fields, distinguish NOT RUN, use actual forecast counts, never infer ready',()=>{
 const injection='<script>alert(1)</script>|`bad`\n<img src=x>',report={host:injection,generatedAt:'2026-09-13',sections:{[injection]:{ok:false,status:'failed',durationMs:injection,error:injection},skip:{ok:null,status:'not_run',reason:'not run'},verifyBefore:{ok:true,status:'passed',value:{checks:{forecasts:{total:7},cron:{details:'cron pending'}}}},stateRows:{ok:true,status:'passed',value:{total:100,rows:[]}},backtestSingle:{ok:true,status:'passed',value:{byHorizon:[{horizon:5,completed:1,excluded:0,pending:2,directionAccuracy:1,rangeHitRate:null,sharpe:undefined,alpha:0}]}}}};
 const html=renderHtml(report),md=renderMarkdown(report);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(md.includes('&#124;'));assert.ok(md.includes('&#96;'));assert.ok(!md.includes('<script>'));assert.match(md,/100.0%/);assert.match(md,/&quot;total&quot;:7/);assert.equal(summarizeReport(report).notRun,1);assert.equal(summarizeReport({sections:{}}).overall,'partial');assert.equal(summarizeReport({sections:{one:{ok:true}}}).ok,false);
});
function fixture(){
 const sqlite=new DatabaseSync(':memory:'),sqls=[];
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
 const prepare=(sql,values=[])=>({bind(...v){return prepare(sql,v)},async first(){sqls.push(sql);return sqlite.prepare(sql).get(...values)},async all(){sqls.push(sql);return {results:sqlite.prepare(sql).all(...values)}},execute(){sqls.push(sql);return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}},async run(){return this.execute()}});
 const db={prepare,async batch(rows){sqlite.exec('BEGIN');try{const result=rows.map(s=>s.execute());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return {db,sqlite,sqls};
}
const put=(sqlite,id,data,at='2026-08-01T00:00:00.000Z')=>sqlite.prepare('INSERT INTO research_state VALUES(?,?,?)').run(id,typeof data==='string'?data:JSON.stringify(data),at);
async function owner(db){
 const token=await m.adminLogin(db,await m.hashPin('123456'),'azoz','123456');
 m.testRuntime.DB=db;m.testRuntime.RECOMMENDATION_OWNER_EMAIL='state-owner@example.test';
 return {origin:'https://mizan.test','content-type':'application/json','oai-authenticated-user-email':'state-owner@example.test',cookie:'mizan_admin='+token};
}
test('State projections: multi-megabyte Unicode row, scalar bounds, malformed JSON, no writes',async()=>{
 const {db,sqlite,sqls}=fixture();
 try{
  const data=JSON.stringify({text:'ميزان😀'.repeat(100000),array:['x'.repeat(100000)],evaluationsSaved:3,lockAcquired:true,stateSaved:false});put(sqlite,'huge',data);put(sqlite,'invalid','{bad');
  const before=sqlite.prepare('SELECT * FROM research_state ORDER BY id').all();
  const list=await m.listStateRows(db,{limit:1});assert.equal(list.rows[0].id,'huge');assert.equal(list.rows[0].size,Buffer.byteLength(data));assert.equal(list.rows[0].data,undefined);assert.equal(list.hasMore,true);
  const fields=await m.readStateFields(db,'huge',['text','array','evaluationsSaved','lockAcquired','stateSaved','absent']);
  assert.equal(fields.evaluationsSaved,3);assert.equal(fields.lockAcquired,true);assert.equal(fields.stateSaved,false);assert.equal(fields.absent,null);assert.deepEqual(fields._omittedFields,['text','array']);assert.ok(JSON.stringify(fields).length<500);
  assert.equal((await m.readStateFields(db,'invalid',['value']))._invalidJson,true);
  assert.equal(await m.readStateField(db,'missing',['x']),null);
  assert.deepEqual(await m.stateExists(db,'missing'),{exists:false,size:null,updated_at:null,sizeUnit:'utf8-bytes'});
  assert.equal((await m.stateExists(db,'huge')).size,Buffer.byteLength(data));
  const keys=await m.listStateKeys(db,{limit:1});assert.deepEqual(keys.keys,['huge']);assert.equal(keys.hasMore,true);assert.deepEqual((await m.listStateKeys(db,{offset:1,limit:1})).keys,['invalid']);
  assert.deepEqual(sqlite.prepare('SELECT * FROM research_state ORDER BY id').all(),before);assert.ok(sqls.every(sql=>!/^\s*(INSERT|UPDATE|DELETE|DROP)/i.test(sql)));
 }finally{sqlite.close();}
});
test('State slices: Unicode reconstruction and revision change detection',async()=>{
 const {db,sqlite}=fixture();try{
  const data=JSON.stringify({text:'عربي😀𐐀'.repeat(80)});put(sqlite,'unicode',data);
  let offset=0,text='',at;
  for(;;){const r=await m.readStateSlices(db,'unicode',{offset,length:13,updatedAt:at});at=r.updatedAt;text+=r.slice;offset=r.nextOffset;assert.ok(Array.from(r.slice).length<=13);if(!r.hasMore)break;}
  assert.equal(text,data);assert.equal(offset,Array.from(data).length);
  sqlite.prepare('UPDATE research_state SET updated_at=? WHERE id=?').run('2026-08-02T00:00:00.000Z','unicode');
  await assert.rejects(m.readStateSlices(db,'unicode',{updatedAt:at}),/تغير السجل/);
  assert.equal((await m.readStateSlices(db,'unicode',{offset:10000})).hasMore,false);
 }finally{sqlite.close();}
});
test('State input limits and injection reject before SQL',async()=>{
 const {db,sqlite,sqls}=fixture();try{
  for(const limit of [NaN,Infinity,-1,0,101,1.5,'20'])await assert.rejects(m.listStateRows(db,{limit}));
  for(const fields of [[],['x','x'],['x\") FROM research_state; --'],['__proto__'],['a.b'],Array.from({length:21},(_,i)=>'f'+i)])await assert.rejects(m.readStateFields(db,'id',fields));
  await assert.rejects(m.readStateSlices(db,'id',{length:8001}));await assert.rejects(m.stateExists(db,'a\n'));assert.equal(sqls.length,0);
  put(sqlite,"x' OR 1=1 --",{ok:1});assert.equal((await m.readStateFields(db,"x' OR 1=1 --",['ok'])).ok,1);
 }finally{sqlite.close();}
});
test('State route: real owner/admin auth, every read mode, unknown/duplicate input, no destructive method',async()=>{
 const {db,sqlite}=fixture();try{
  const headers=await owner(db);put(sqlite,'k',{n:4});
  const req=(query,overrides={})=>new Request('https://mizan.test/api/admin/state?'+query,{headers:{...headers,...overrides}});
  assert.equal((await m.adminStateGET(req('mode=list',{'oai-authenticated-user-email':'wrong@example.test'}))).status,403);
  assert.equal((await m.adminStateGET(req('mode=list',{cookie:''}))).status,401);
  assert.equal((await m.adminStateGET(req('mode=list',{origin:'https://evil.test'}))).status,403);
  for(const query of ['mode=list','mode=keys','mode=exists&id=k','mode=fields&id=k&fields=n','mode=slices&id=k&length=3']){const r=await m.adminStateGET(req(query));assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);}
  for(const query of ['mode=delete&id=k','mode=list&limit=NaN','mode=list&limit=20&limit=21','mode=fields&id=k&fields=a.b','mode=fields&id=k&fields=','mode=keys&limit=101'])assert.equal((await m.adminStateGET(req(query))).status,400);
  assert.equal((await m.adminStateGET(req('mode=fields&id=missing&fields=n'))).status,404);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM research_state').get().n,1);
 }finally{sqlite.close();}
});
function chart(symbol){
 const timestamp=[];for(let ms=Date.parse('2025-01-01T12:00:00Z');ms<Date.parse('2026-09-01T00:00:00Z');ms+=864e5)if(![0,6].includes(new Date(ms).getUTCDay()))timestamp.push(ms/1000);
 const close=timestamp.map((_,i)=>100+i*.1);
 return {chart:{result:[{meta:{symbol,instrumentType:symbol.startsWith('^')?'INDEX':symbol==='SPY'?'ETF':'EQUITY',currency:symbol.endsWith('.SR')?'SAR':'USD',exchangeName:symbol.endsWith('.SR')?'SAU':'NMS',fullExchangeName:symbol.endsWith('.SR')?'SAUDI':'NASDAQ',longName:'Synthetic QA '+symbol,regularMarketTime:timestamp.at(-1),regularMarketPrice:close.at(-1),dataGranularity:'1d'},timestamp,indicators:{quote:[{open:close,high:close.map(v=>v+1),low:close.map(v=>v-1),close,volume:close.map(()=>100000)}]},events:{}}],error:null}};
}
const network=async url=>{const u=new URL(String(url));if(u.hostname.endsWith('yahoo.com')&&u.pathname.startsWith('/v8/finance/chart/'))return Response.json(chart(decodeURIComponent(u.pathname.split('/').at(-1))));if(u.hostname.endsWith('yahoo.com'))return Response.json({quotes:[],news:[],timeseries:{result:[]},finance:{result:[]},quoteSummary:{result:[]}});if(u.hostname.endsWith('sec.gov'))return Response.json({});throw Error('Unexpected synthetic host');};
function seed(sqlite,symbol='MZAUDIT',extra={},anchorDate='2026-07-10'){
 const id=crypto.randomUUID(),snapshot=crypto.randomUUID(),createdAt=anchorDate+'T18:00:00.000Z',model='synthetic-audit-test';
 const f={createdAt,model,anchorDate,price:140,predictedPrice:141,range:[135,150],direction:'محايد',currency:symbol.endsWith('.SR')?'SAR':'USD',evaluationPolicy:m.EVALUATION_POLICY,recordClass:'prospective-public',...extra};
 sqlite.prepare('INSERT INTO analysis_snapshots VALUES(?,?,?,?)').run(snapshot,symbol,createdAt,'{}');
 sqlite.prepare('INSERT INTO forecast_records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,snapshot,symbol,createdAt,5,model,'us','fixture','منخفض',1,JSON.stringify(f));return id;
}
const config=(runId='audit-test',symbols=['MZAUDIT'])=>({runId,symbols,startDate:'2026-07-01',endDate:'2026-08-31',horizons:[5],minSessions:200,costs:{commissionBps:5,slippageBps:10,doubleSided:true}});
test('Batch uses full reader/evaluator, preserves journals, neutral/MAE, pending/excluded, repeat and storage failure',async()=>{
 const {db,sqlite}=fixture(),old=globalThis.fetch;globalThis.fetch=network;
 try{
  seed(sqlite);seed(sqlite,undefined,{},'2026-07-13');seed(sqlite,undefined,{recordClass:'historical'},'2026-07-20');seed(sqlite,undefined,{},'2026-08-28');
  const original=sqlite.prepare('SELECT * FROM forecast_records ORDER BY id').all();
  const result=await m.auditBacktest(db,config());assert.equal(result.symbolsFailed.length,0);assert.equal(result.byHorizon[0].completed,1);assert.equal(result.byHorizon[0].excluded,2);assert.equal(result.byHorizon[0].pending,1);assert.equal(result.byHorizon[0].pointCount,1);assert.ok(result.byHorizon[0].maeByCurrency.USD.mae>=0);
  const same=await m.auditBacktest(db,config());assert.equal(same.reused,true);assert.deepEqual(same.observations,result.observations);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM backtest_runs').get().n,1);
  await assert.rejects(m.auditBacktest(db,{...config(),endDate:'2026-08-30'}),/runId/);
  assert.deepEqual(sqlite.prepare('SELECT * FROM forecast_records ORDER BY id').all(),original);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM forecast_outcomes').get().n,0);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM research_state').get().n,0);
  sqlite.exec("CREATE TRIGGER audit_fail BEFORE INSERT ON backtest_runs BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END");
  await assert.rejects(m.auditBacktest(db,config('write-failure')),/synthetic write failure/);
 }finally{globalThis.fetch=old;sqlite.close();}
});
test('Audit input, mixed-currency errors, sample Sharpe and weighted paired aggregation',()=>{
 for(const input of [{...config(),symbols:[]},{...config(),symbols:['AAPL','AAPL']},{...config(),startDate:'2026-02-30'},{...config(),costs:{commissionBps:-1,slippageBps:0,doubleSided:true}},{...config(),horizons:[2]},{...config(),minSessions:Infinity},{...config(),currencyOf:'USD'}])assert.throws(()=>m.parseBacktestConfig(input));
 const row={horizon:5,state:'complete',directionCorrect:true,rangeHit:null,absoluteError:2,relativeErrorPct:1,netAssetReturn:.1,netBenchmarkReturn:.05,currency:'USD'};
 const h=m.summarizeBacktest([row,{...row,currency:'SAR',absoluteError:10,directionCorrect:null,rangeHit:false,netAssetReturn:.3,netBenchmarkReturn:.1}],[5])[0];
 assert.equal(h.directionCount,1);assert.equal(h.directionAccuracy,1);assert.equal(h.rangeCount,1);assert.equal(h.rangeHitRate,0);assert.equal(h.maeByCurrency.USD.mae,2);assert.equal(h.maeByCurrency.SAR.mae,10);assert.ok(Math.abs(h.alpha-.125)<1e-10);assert.ok(Math.abs(h.sharpe-Math.sqrt(2))<1e-10);
});
test('Walk-forward windows enforce boundaries, reuse original runs and aggregate observations',async()=>{
 const {db,sqlite}=fixture(),old=globalThis.fetch;globalThis.fetch=network;
 try{
  seed(sqlite);seed(sqlite,undefined,{},'2026-08-03');const {startDate,endDate,...base}=config('windows');
  const windows=[{trainStart:'2026-01-01',trainEnd:'2026-06-30',testStart:'2026-07-01',testEnd:'2026-07-31'},{trainStart:'2026-01-01',trainEnd:'2026-07-31',testStart:'2026-08-01',testEnd:'2026-08-31'}];
  assert.throws(()=>m.parseWalkForwardConfig({...base,windows:[{...windows[0],trainEnd:'2026-07-01'}]}));assert.throws(()=>m.parseWalkForwardConfig({...base,windows:[windows[0],{...windows[1],testStart:'2026-07-31'}]}));
  const result=await m.runWalkForward(db,{...base,windows});assert.equal(result.windows.length,2);assert.equal(result.windows[1].training.records,1);assert.equal(result.windows[1].training.retrained,false);assert.equal(result.aggregate.byHorizon[0].completed,2);
  assert.equal((await m.runWalkForward(db,{...base,windows})).reused,true);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM backtest_runs').get().n,3);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM forecast_outcomes').get().n,0);
 }finally{globalThis.fetch=old;sqlite.close();}
});
test('Admin batch endpoint authenticates and bounds request before any market fetch',async()=>{
 const {db,sqlite}=fixture();try{
  const headers=await owner(db),req=(body,override={})=>new Request('https://mizan.test/api/admin/backtest',{method:'POST',headers:{...headers,...override},body});
  assert.equal((await m.adminBacktestPOST(req('{}',{cookie:''}))).status,401);assert.equal((await m.adminBacktestPOST(req('{}',{'oai-authenticated-user-email':'other@example.test'}))).status,403);assert.equal((await m.adminBacktestPOST(req('{}',{origin:'https://evil.test'}))).status,403);
  assert.equal((await m.adminBacktestPOST(req(' '.repeat(12001)))).status,400);assert.equal((await m.adminBacktestPOST(req('{bad'))).status,400);assert.equal((await m.adminBacktestPOST(req('{}',{'content-type':'text/plain'}))).status,415);
 }finally{sqlite.close();}
});
test('Championship API connects the new engine, validates identity, and keeps metrics distinct',async()=>{
 const {db,sqlite,sqls}=fixture();const oldFetch=globalThis.fetch;
 try{
  const headers=await owner(db);globalThis.fetch=async()=>{throw Error('No network allowed');};
  const candles=Array.from({length:400},(_,i)=>({date:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),open:100,high:101,low:99,close:100,volume:10000}));
  const dataset={symbol:'AAPL',currency:'USD',adjustment:'split-adjusted',candles};
  const report={company:{symbol:'AAPL'},currency:'USD',priceSource:'fixture',facts:[]};
  const request=(value)=>new Request('https://mizan.test/api/admin/backtest',{method:'POST',headers,body:JSON.stringify(value)});
  sqls.length=0;
  const response=await m.adminBacktestPOST(request({dataset,report}));assert.equal(response.status,200);
  const r=await response.json();assert.equal(r.success,true);assert.ok(r.data.windowsEvaluated>0);assert.equal(r.data.summary.calmarRatio,r.data.championshipMetrics.calmarRatio);assert.equal(r.data.summary.profitFactor,null);assert.equal(r.data.championshipMetrics.isAccepted,false);assert.equal(r.data.persisted,false);
  assert.ok(!sqls.some(s=>/INSERT INTO (?:backtest|forecast)/.test(s)));
  assert.equal((await m.adminBacktestPOST(request({dataset:{...dataset,candles:candles.slice(0,50)},report}))).status,400);
  assert.equal((await m.adminBacktestPOST(request({dataset,report:{...report,currency:'SAR'}}))).status,400);
 }finally{globalThis.fetch=oldFetch;sqlite.close();}
});
test('CLI sends real Cookie and matching Origin, rejects HTTP errors without exposing secrets',async()=>{
 let received;const secret='mizan_admin=secret;$(`not-shell`)';
 const server=createServer((req,res)=>{received=req.headers;res.setHeader('Content-Type','application/json');if(req.url.includes('mode=exists')){res.statusCode=403;res.end(JSON.stringify({secret}));}else res.end('{"keys":["k"],"hasMore":false}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const host='http://127.0.0.1:'+server.address().port;
 const run=args=>new Promise(resolve=>{const p=spawn(process.execPath,['scripts/read-prod-state.mjs',...args],{env:{...process.env,MIZAN_HOST:host,MIZAN_COOKIE:secret}});let output='';p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>output+=d);p.on('close',code=>resolve({code,output}));});
 try{const ok=await run(['keys']);assert.equal(ok.code,0);assert.equal(received.origin,host);assert.equal(received.cookie,secret);assert.equal(received['oai-authenticated-user-email'],undefined);const fail=await run(['exists','k']);assert.equal(fail.code,1);assert.match(fail.output,/HTTP 403/);assert.ok(!fail.output.includes(secret));}finally{await new Promise(resolve=>server.close(resolve));}
});

test('verify:full saves JSON/HTML/Markdown despite failed checks; isolated HTTP receives no default writes or secrets in reports',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'mizan-report-test-')),cookie='mizan_admin=confidential-fixture',pin='987654321',calls=[];
 const server=createServer((req,res)=>{calls.push({method:req.method,url:req.url,origin:req.headers.origin,cookie:req.headers.cookie});res.setHeader('Content-Type','application/json');if(req.url.includes('/verify'))res.end(JSON.stringify({readOnly:true,overall:'partial',checks:{cron:{ok:false,details:'not observed'},forecasts:{ok:true,total:7},idempotency:{ok:false,integrityOk:true}}}));else if(req.url.includes('mode=keys'))res.end('{"keys":[],"hasMore":false}');else if(req.url.includes('mode=list'))res.end('{"rows":[],"total":20}');else if(req.url.includes('mode=exists'))res.end('{"exists":false}');else{res.statusCode=404;res.end('{}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const host='http://127.0.0.1:'+server.address().port;
 const run=()=>new Promise(resolve=>{const p=spawn('bash',['scripts/verify-all.sh'],{env:{...process.env,MIZAN_HOST:host,MIZAN_COOKIE:cookie,MIZAN_RECOMMENDATION_PIN:pin,MIZAN_OUT_DIR:directory}});let output='';p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>output+=d);p.on('close',code=>resolve({code,output}));});
 try{
  for(let i=0;i<2;i++){const r=await run();assert.equal(r.code,3,r.output);assert.ok(!r.output.includes(cookie));assert.ok(!r.output.includes(pin));}
  assert.ok(calls.every(c=>c.method==='GET'&&c.origin===host&&c.cookie===cookie));assert.equal(calls.filter(c=>c.url==='/api/admin/verify').length,2);
  const dirs=readdirSync(directory);assert.equal(dirs.length,2);
  for(const dir of dirs){const files=readdirSync(join(directory,dir));for(const name of ['plan.json','run-all-checks.json','run-all-checks-summary.json','run-all-checks.html','run-all-checks.md']){assert.ok(files.includes(name));const path=join(directory,dir,name),text=readFileSync(path,'utf8');assert.ok(!text.includes(cookie));assert.ok(!text.includes(pin));assert.equal((await stat(path)).mode&0o777,0o600);}const report=JSON.parse(readFileSync(join(directory,dir,'run-all-checks.json'),'utf8'));assert.equal(report.sections.manualTrigger.status,'not_run');assert.equal(report.sections.cronFields.ok,false);assert.equal(report.sections.forecasts.value.total,7);}
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});

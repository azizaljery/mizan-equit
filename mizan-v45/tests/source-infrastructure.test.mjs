import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const m=await import(process.env.MIZAN_TEST_MODULE);
const source={id:'tadawul',official:true},ctx={expectedSymbol:'2222.SR',asOf:'2025-01-01'};
const quote={symbol:'2222',currency:'SAR',lastPrice:30,volume:0,asOfDate:'2024-12-31T10:00:00Z'};
test('admin identity and Origin gate permits authenticated terminal requests and rejects forged or cross-site context',async()=>{
 m.testRuntime.RECOMMENDATION_OWNER_EMAIL='owner@test.invalid';
 const req=h=>new Request('https://mizan.test/api/admin/backtest',{headers:h});
 assert.equal(m.authorizeAdminRequest(req({'oai-authenticated-user-email':'owner@test.invalid'})),null);
 for(const h of [{cookie:'owner=test'},{'oai-authenticated-user-email':'wrong@test.invalid'},{'oai-authenticated-user-email':'owner@test.invalid',origin:''},{'oai-authenticated-user-email':'owner@test.invalid',origin:'null'},{'oai-authenticated-user-email':'owner@test.invalid',origin:'https://evil.test'},{'oai-authenticated-user-email':'owner@test.invalid','sec-fetch-site':'cross-site'}])assert.equal(m.authorizeAdminRequest(req(h)).status,403);
 assert.equal((await m.heartbeatGET(req({}))).status,403);
 assert.equal((await m.retentionGET(req({}))).status,403);
});
test('Tadawul prices require response identity, currency, finite price and actual timestamp',()=>{
 const parse=v=>m.parseTadawulPrice(JSON.stringify(v),source,ctx);
 assert.equal(parse(quote).value.volume,0);
 assert.equal(parse(quote).sourceTime,'2024-12-31T10:00:00.000Z');
 for(const change of [{symbol:undefined},{symbol:'3333'},{currency:undefined},{currency:'USD'},{lastPrice:-1},{lastPrice:'30junk'},{lastPrice:'Infinity'},{asOfDate:undefined},{asOfDate:'2024-02-30T10:00:00Z'},{asOfDate:'2024-12-31'},{asOfDate:'2026-01-01T10:00:00Z'},{volume:-1}])assert.throws(()=>parse({...quote,...change}));
 assert.equal(parse([{...quote,symbol:'3333'},quote]).value.symbol,'2222.SR');
 assert.throws(()=>parse([quote,quote]));
});
test('Tadawul financial statements preserve zero, reject empty/unknown scale/future/YTD, and keep source provenance',()=>{
 const base={symbol:'2222',currency:'SAR',unitScale:1,statements:[{fiscalEndDate:'2023-12-31',statementType:'annual',publishedDate:'2024-02-01',netIncome:0,capitalExpenditures:-10,totalDebt:0,cashAndEquivalents:5}]};
 const parse=v=>m.getParser('financials')(JSON.stringify(v),{id:'sahmk',official:false},ctx);
 const r=parse(base);assert.equal(r.value.lines.find(l=>l.key==='netIncome').value,0);assert.equal(r.value.lines.find(l=>l.key==='capex').value,10);assert.ok(r.value.lines.every(l=>l.source==='sahmk'));
 for(const v of [{...base,unitScale:undefined},{...base,statements:[]},{...base,statements:[{...base.statements[0],publishedDate:'2026-01-01'}]},{...base,statements:[{...base.statements[0],fiscalEndDate:'2023-02-30'}]},{...base,statements:[{...base.statements[0],statementType:'quarterly',periodType:'9M'}]}])assert.throws(()=>parse(v));
 const undated=parse({...base,statements:[{...base.statements[0],publishedDate:undefined}]});assert.equal(undated.sourceTime,null);assert.equal(m.isPitSafe(undated.value.lines),false);
 assert.equal(m.filterPitSafe(r.value.lines,'2024-01-01').length,0);
});
test('Yahoo requests and parses CapEx and direct FCF through the shared map without inventing publication dates',()=>{
 const url=m.fundamentalsURL('AAPL','2025-01-01');assert.match(url,/annualFreeCashFlow/);assert.match(url,/trailingCapitalExpenditure/);
 const raw=JSON.stringify({timeseries:{result:[{meta:{symbol:['AAPL']},annualCapitalExpenditure:[{asOfDate:'2023-12-31',currencyCode:'USD',reportedValue:{raw:-12}}],annualFreeCashFlow:[{asOfDate:'2023-12-31',currencyCode:'USD',reportedValue:{raw:0}}]}]}});
 const r=m.parseYahooFinancials(raw,{id:'yahoo'},{expectedSymbol:'AAPL',asOf:'2025-01-01'});assert.equal(r.value.lines.find(l=>l.key==='freeCashFlow').value,0);assert.ok(r.value.lines.every(l=>l.filedAt===null));
});
function migrate(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+file,'utf8'));return db;}
test('new read endpoints keep owner AND admin authentication and reject malformed bounds',async()=>{
 const sqlite=migrate();const db={prepare:sql=>({bind:(...args)=>({first:async()=>sqlite.prepare(sql).get(...args),all:async()=>({results:sqlite.prepare(sql).all(...args)})})})};
 const token='a'.repeat(64);sqlite.prepare('INSERT INTO admin_access(id,session_hash,expires_at) VALUES(1,?,?)').run(await m.tokenDigest(token),Date.now()+60000);
 m.testRuntime.DB=db;m.testRuntime.RECOMMENDATION_OWNER_EMAIL='owner@test.invalid';
 for(const route of [m.heartbeatGET,m.retentionGET,m.aggregateGET,m.backtestExportGET]){
  const req=(query='',extra={})=>new Request('https://mizan.test/api?'+query,{headers:{'oai-authenticated-user-email':'owner@test.invalid',cookie:'mizan_admin='+token,...extra}});
  assert.equal((await route(req('',{cookie:''}))).status,401);
  assert.equal((await route(req('',{origin:'https://evil.test'}))).status,403);
  assert.equal((await route(req('',{'oai-authenticated-user-email':'visitor@test.invalid'}))).status,403);
 }
 const request=query=>new Request('https://mizan.test/api?'+query,{headers:{'oai-authenticated-user-email':'owner@test.invalid',cookie:'mizan_admin='+token}});
 assert.equal((await m.aggregateGET(request('limit=Infinity'))).status,400);
 assert.equal((await m.retentionGET(request('days=NaN'))).status,400);
 assert.equal((await m.backtestExportGET(request('runId=bad%0D%0Aheader'))).status,400);
 assert.equal((await m.backtestExportGET(request('runId=absent'))).status,404);
 const aggregated=await m.aggregateGET(request(''));assert.equal(aggregated.status,200);assert.equal((await aggregated.json()).aggregate.runsUsed,0);
 sqlite.close();
});
test('migration backfills only supported stored reports without rewriting original data',()=>{
 const db=new DatabaseSync(':memory:');const files=readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort();
 for(const file of files.filter(f=>Number(f.slice(0,4))<9))db.exec(readFileSync('drizzle/'+file,'utf8'));
 const raw=JSON.stringify({kind:'mizan-issued-forecast-windows-v1',aggregate:{byHorizon:[{horizon:5,completed:7}]}});
 db.prepare('INSERT INTO backtest_runs(id,symbol,created_at,data) VALUES(?,?,?,?)').run('old','*','2025-01-01',raw);
 for(const file of files.filter(f=>Number(f.slice(0,4))>=9))db.exec(readFileSync('drizzle/'+file,'utf8'));
 assert.equal(db.prepare('SELECT data FROM backtest_runs WHERE id=?').get('old').data,raw);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM backtest_results').get().n,1);db.close();
});
test('schema migrations preserve old write contracts and atomically project per-horizon backtest results',()=>{
 const db=migrate();
 db.prepare('INSERT INTO forecast_outcomes(id,evaluated_at,data) VALUES(?,?,?)').run('f','2025-01-01','{}');
 db.prepare('INSERT INTO evaluation_revisions(id,forecast_id,revision,created_at,fingerprint,data) VALUES(?,?,?,?,?,?)').run('e','f',1,'2025-01-01','hash','{}');
 const insert=db.prepare('INSERT INTO backtest_runs(id,symbol,created_at,data) VALUES(?,?,?,?)');
 const data={kind:'mizan-issued-forecast-audit-v1',byHorizon:[{horizon:5,completed:3},{horizon:21,completed:2}]};insert.run('b','AAPL','2025-01-01',JSON.stringify(data));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM backtest_results').get().n,2);
 insert.run('bad','AAPL','2025-01-01','bad JSON');insert.run('scalar','AAPL','2025-01-01',JSON.stringify({...data,byHorizon:['oops',null,3]}));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM backtest_results').get().n,2);
 db.prepare('UPDATE backtest_runs SET data=? WHERE id=?').run(JSON.stringify({...data,byHorizon:[{horizon:63,completed:1}]}),'b');
 assert.equal(db.prepare('SELECT horizon FROM backtest_results WHERE run_id=?').get('b').horizon,63);
 db.prepare('DELETE FROM backtest_runs WHERE id=?').run('b');assert.equal(db.prepare('SELECT COUNT(*) n FROM backtest_results').get().n,0);
 db.close();
});
test('source telemetry increments atomically and does not call read success verified data',async()=>{
 const sqlite=migrate(),db={prepare:sql=>({bind:(...args)=>({run:async()=>sqlite.prepare(sql).run(...args)})})};
 await Promise.all(Array.from({length:10},(_,i)=>m.recordSourceRead(db,'yahoo',i<7,i*10,'2025-01-02T00:00:00Z')));
 let row=sqlite.prepare('SELECT * FROM source_health').get();assert.equal(row.success_count,7);assert.equal(row.failure_count,3);assert.equal(row.avg_latency_ms,45);assert.equal(row.state,'read_failed');
 await m.recordSourceRead(db,'yahoo',true,100,'2025-01-01T00:00:00Z');row=sqlite.prepare('SELECT * FROM source_health').get();assert.equal(row.state,'read_failed');assert.equal(row.success_count,8);sqlite.close();
});

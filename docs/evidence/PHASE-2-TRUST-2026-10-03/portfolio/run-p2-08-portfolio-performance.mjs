import assert from 'node:assert/strict';
import {createHash,randomInt} from 'node:crypto';
import {mkdtemp,readFile,rm,copyFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const BASELINE='18ba8f39f3399a7a27d4ad16c2ed1e9b5f6fa241';
const MANIFEST_SHA='5fdf6dd6273c7765252495f6f960f74ad82592e619f583a24bd4d5bec03923bb';
const SEED_ID='P2-TRUST-SEED-V1';
const SEED_SHA='ffe716976c5582eff379c989d11eaf731da538d328b9c6f5963f105a01f3be6d';
const root=resolve(new URL('..',import.meta.url).pathname);
const artifacts=resolve(new URL('.',import.meta.url).pathname);
const sourceRoot=join(root,'mizan-v45');
const seed=JSON.parse(await readFile(join(artifacts,'frozen-seed-v1.json'),'utf8'));
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`:JSON.stringify(value);
const seedDigest=createHash('sha256').update(canonical(seed)).digest('hex');
assert.equal(seedDigest,SEED_SHA,'Frozen seed digest changed');
const RealDate=globalThis.Date;
const fixedMs=RealDate.parse('2026-10-03T00:00:00.000Z');
class FixedDate extends RealDate {constructor(...args){super(...(args.length?args:[fixedMs]));}static now(){return fixedMs;}}
globalThis.Date=FixedDate;
const mod=await import(process.env.MIZAN_TEST_MODULE);
const {DatabaseSync}=await import('node:sqlite');
const digest=x=>createHash('sha256').update(x).digest('hex');
function deterministicUuid(logicalId){const b=createHash('sha256').update(`${SEED_ID}:${logicalId}`,'utf8').digest().subarray(0,16);b[6]=(b[6]&0x0f)|0x50;b[8]=(b[8]&0x3f)|0x80;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;}
function dbAdapter(sqlite){const prepare=(sql,values=[])=>({bind(...v){return prepare(sql,v);},async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)},changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid||0)};},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};}});return {prepare,async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};}
async function openDb(path,{migrate=false}={}){const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA foreign_keys=ON');if(migrate){const journal=JSON.parse(await readFile(join(sourceRoot,'drizzle/meta/_journal.json'),'utf8'));for(const entry of journal.entries)sqlite.exec(await readFile(join(sourceRoot,'drizzle',`${entry.tag}.sql`),'utf8'));}return {sqlite,db:dbAdapter(sqlite)};}
const ownerEmail='p2-perf-owner-fixture@example.test';
mod.testRuntime.RECOMMENDATION_OWNER_EMAIL=ownerEmail;
function request(body=null,token=null,method='POST',path='/api/research'){const headers={'origin':'http://127.0.0.1','content-type':'application/json','oai-authenticated-user-email':ownerEmail};if(token)headers['x-mizan-portfolio-token']=token;return new Request('http://127.0.0.1'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});}
async function responseJson(response){return {status:response.status,body:await response.json()};}
function baseSummaryHash(sqlite,portfolioId){
 const portfolio=sqlite.prepare('SELECT id,name,currency,created_at,updated_at,data FROM paper_portfolios WHERE id=?').all(portfolioId);
 const cash=sqlite.prepare('SELECT id,portfolio_id,cash_type,amount,currency,created_at,data FROM paper_cash_entries WHERE portfolio_id=? ORDER BY created_at,id').all(portfolioId);
 const trades=sqlite.prepare('SELECT id,portfolio_id,symbol,side,quantity,price,currency,created_at,data FROM paper_trades WHERE portfolio_id=? ORDER BY created_at,rowid').all(portfolioId);
 const clean=rows=>rows.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]]))).map(canonical).sort().join('\n');
 return {portfolio:digest(clean(portfolio)),cash:digest(clean(cash)),trades:digest(clean(trades)),counts:{portfolios:portfolio.length,cash:cash.length,trades:trades.length}};
}
const timing=()=>process.hrtime.bigint();
const elapsedMs=(start,end)=>Number(end-start)/1e6;
const round6=x=>Number(x.toFixed(6));
function summary(values){const a=[...values].sort((x,y)=>x-y);const median=a.length%2?a[Math.floor(a.length/2)]:(a[a.length/2-1]+a[a.length/2])/2;const p95=a[Math.ceil(.95*a.length)-1];return {count:a.length,p50Ms:round6(median),p95Ms:a.length>=30?round6(p95):null,p95Rule:a.length>=30?'nearest-rank, sorted[ceil(0.95*n)-1]':null,maxMs:round6(a.at(-1)),minMs:round6(a[0])};}
const tempRoot=await mkdtemp(join(tmpdir(),`mizan-p2-trust-perf-${process.pid}-`));
const templatePath=join(tempRoot,'portfolio-update-base.sqlite');
let template=null;let token=null;let portfolioId=null;
const mappedTradeIds=Object.fromEntries(seed.events.filter(e=>e.side==='buy'||e.side==='sell').slice(0,3).map(e=>[e.id,deterministicUuid(e.id)]));
const updateId=deterministicUuid('P2-TRUST-TRADE-004');
const result={evidenceId:'EVD-TRUST-P2-08-PERFORMANCE',component:'portfolio_update_only',requirementStatus:'PORTFOLIO_UPDATE_SLICE_MEASURED; overall P2-08 requires other workload contributions',baselineCommit:BASELINE,canonicalSourceManifestSha256:MANIFEST_SHA,capturedAt:new RealDate().toISOString(),fixture:{seedId:SEED_ID,seedSha256:SEED_SHA,logicalPortfolioId:seed.portfolioId,actualGeneratedPortfolioId:null,actualIdMapping:{...mappedTradeIds,'P2-TRUST-TRADE-004':updateId},instrument:seed.instrument,currency:seed.currency,portfolioStateBeforeTimedOperation:'SAR 10,000 opening cash; first two buys and partial sale from the frozen seed; exactly 3 existing trades'},workload:{name:'One synthetic full-sale update through researchPOST, followed by persisted-state researchGET/reload',operation:'Sell the remaining 11 units at manual SAR110 using P2-TRUST-TRADE-004; then load the portfolio summary/ledger',preUpdateState:{cash:8920,units:11,averageCost:1600/15,realizedPnl:280/3,unrealizedPnl:'not marked in GET'},postUpdateExpected:{httpStatus:200,tradeCount:4,cash:10130,units:0,realizedPnl:130,unrealizedPnl:0},sameBaselinePerSample:true,fixtureResetOutsideTimer:true,dbCopyAndOpenOutsideTimer:true,requestConstructionOutsideTimer:true,metricIncludes:['researchPOST handler and awaited persistence','POST response JSON parse','researchGET handler/reload','GET response JSON parse'],metricExcludes:['migration/setup','portfolio/session creation','three seed trades','database snapshot copy/open','bundle build/import','filesystem cleanup'],noNetwork:true},environment:{runtime:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,storage:'file-backed local SQLite via node:sqlite; full 16 canonical migrations',sourceManifestSha256:MANIFEST_SHA,externalNetworkUsed:false,productionOrCloudflareUsed:false,threshold:null,optimizationPerformed:false,clock:'test-only fixed application clock 2026-10-03T00:00:00.000Z; OS clock unchanged'},method:{timer:'process.hrtime.bigint() monotonic nanosecond clock; reported in milliseconds',cold:'first measured API cycle in this process after module import and fixture setup, before API warm-up; not a fresh process-start or OS-cache-cold measurement',warmupRuns:3,warmRuns:30,warm:'30 timed API cycles after warm-up, each from a fresh byte-identical local DB copy',percentiles:'p50 is median (average middle pair for even n); p95 nearest-rank ceil(0.95*n); maximum is observed max; no pass/fail latency threshold'},measurements:{cold:null,warmups:[],warm:[],warmSummary:null},harnessNotes:['An initial measurement-harness assertion compared the pre-update seed hash to the intentionally changed post-update ledger hash; the assertion was moved to the untimed pre-operation snapshot and the run was restarted with fresh isolated state. This was a harness-only mismatch, not an application result.'],state:{baselineDomainHashes:null},limitations:['This measures only the portfolio-update slice of P2-08. Saudi analysis, US analysis and forecast-save measurements are outside this contribution.','The benchmark exercises exact-baseline API handlers in Node with file-backed local SQLite, not the deployed Cloudflare/D1 runtime or browser network stack.','The single fixed workload has one named portfolio, one synthetic SAR instrument, and three pre-existing ledger trades; setup and restore overhead are excluded from the timed update cycle.','Synthetic auth PIN/session material is generated only in memory for local fixture setup, never written to evidence, logs or a database artifact; temporary DBs are deleted after the run.','Source migrations initialize their baseline legacy placeholder and other module bootstrap rows in the temporary database; no non-portfolio API was invoked and the temporary state was removed.']};
try{
 const pin=String(randomInt(0,1_000_000)).padStart(6,'0');
 template=await openDb(templatePath,{migrate:true});
 const created=await mod.createPaperPortfolio(template.db,{name:'P2 Trust Perf Synthetic 001',currency:seed.currency,pin,capital:seed.openingCash});
 portfolioId=created.portfolio.id;token=created.token.token;result.fixture.actualGeneratedPortfolioId=portfolioId;
 for(const e of seed.events.filter(v=>v.side==='buy'||v.side==='sell').slice(0,3)){
  await mod.appendPaperTrade(template.db,{id:deterministicUuid(e.id),portfolioId,symbol:seed.instrument,side:e.side,quantity:e.quantity,price:e.price,currency:seed.currency,createdAt:new Date(e.at).toISOString(),reason:'P2 synthetic performance setup',forecastId:null,confidence:null,source:'synthetic fixture',quoteTime:new Date(e.at).toISOString()});
 }
 const baseHashes=baseSummaryHash(template.sqlite,portfolioId);
 assert.equal(baseHashes.counts.cash,1);assert.equal(baseHashes.counts.trades,3);
 result.state.baselineDomainHashes=baseHashes;
 const baseBytes=template.sqlite.serialize();
 await writeFile(templatePath,baseBytes);
 template.sqlite.close();template=null;
 const event=seed.events.find(e=>e.id==='P2-TRUST-TRADE-004');
 const body={action:'trade',id:updateId,portfolioId,symbol:seed.instrument,side:event.side,quantity:event.quantity,price:event.price,currency:seed.currency,createdAt:event.at,reason:'P2 synthetic performance operation',forecastId:null,companyName:'Synthetic Test Instrument',exchange:'SYNTHETIC'};
 const runOne=async(label,ordinal)=>{
  const path=join(tempRoot,`${label}-${ordinal}.sqlite`);await copyFile(templatePath,path);
  const store=await openDb(path);mod.testRuntime.DB=store.db;
  const preOperationHashes=baseSummaryHash(store.sqlite,portfolioId);
  const preOperationHashesMatch=canonical(preOperationHashes)===canonical(baseHashes);
  assert.equal(preOperationHashesMatch,true,'Fresh sample does not match frozen pre-update baseline');
  const postRequest=request(body,token);const getRequest=request(null,token,'GET',`/api/research?portfolio=${encodeURIComponent(portfolioId)}`);
  const start=timing();
  const postResponse=await mod.researchPOST(postRequest);const postEnd=timing();const postBody=await postResponse.json();
  const getResponse=await mod.researchGET(getRequest);const getEnd=timing();const getBody=await getResponse.json();
  const sample={sample:ordinal,postMs:round6(elapsedMs(start,postEnd)),getMs:round6(elapsedMs(postEnd,getEnd)),cycleMs:round6(elapsedMs(start,getEnd)),postStatus:postResponse.status,getStatus:getResponse.status,tradeCount:getBody.trades?.length??null,cash:getBody.portfolioSummary?.cash??null,units:getBody.portfolioSummary?.positions?.find(p=>p.symbol===seed.instrument)?.quantity??0,realizedPnl:getBody.portfolioSummary?.realized??null,unrealizedPnl:getBody.portfolioSummary?.unrealized??null,preOperationStateHashesMatch:preOperationHashesMatch,postUpdateTradeCount:Number(store.sqlite.prepare('SELECT COUNT(*) AS n FROM paper_trades WHERE portfolio_id=?').get(portfolioId).n)};
  assert.equal(sample.postStatus,200,JSON.stringify(postBody));assert.equal(sample.getStatus,200);assert.equal(postBody.trade.id,updateId);assert.equal(sample.tradeCount,4);assert.equal(sample.cash,10130);assert.equal(sample.units,0);assert.ok(Math.abs(sample.realizedPnl-130)<1e-9);assert.equal(sample.unrealizedPnl,0);assert.equal(sample.preOperationStateHashesMatch,true);assert.equal(sample.postUpdateTradeCount,4);
  store.sqlite.close();await rm(path,{force:true});return sample;
 };
 result.measurements.cold=await runOne('cold',1);
 for(let i=1;i<=result.method.warmupRuns;i++)result.measurements.warmups.push(await runOne('warmup',i));
 for(let i=1;i<=result.method.warmRuns;i++)result.measurements.warm.push(await runOne('warm',i));
 result.measurements.warmSummary={post:summary(result.measurements.warm.map(s=>s.postMs)),get:summary(result.measurements.warm.map(s=>s.getMs)),updateCycle:summary(result.measurements.warm.map(s=>s.cycleMs))};
 result.measurements.coldSummary={sampleCount:1,postMs:result.measurements.cold.postMs,getMs:result.measurements.cold.getMs,updateCycleMs:result.measurements.cold.cycleMs,p95Ms:null,p95Reason:'n=1; not statistically supported'};
 result.result='MEASURED_NO_THRESHOLD';
}catch(error){result.result='FAILED_MEASUREMENT';result.failure={name:error instanceof Error?error.name:'Error',message:error instanceof Error?error.message:String(error)};}finally{try{template?.sqlite.close();}catch{};delete mod.testRuntime.DB;delete mod.testRuntime.RECOMMENDATION_OWNER_EMAIL;await rm(tempRoot,{recursive:true,force:true});}
const rawPath=join(artifacts,'p2-08-portfolio-update-raw-results.json');
const evidencePath=join(artifacts,'EVD-TRUST-P2-08-PORTFOLIO-UPDATE.json');
const evidence={evidenceId:'EVD-TRUST-P2-08-PERFORMANCE',component:'portfolio_update_only',requirementId:'P2-08',baselineCommit:BASELINE,capturedAt:result.capturedAt,environment:result.environment,safeSourceOrTargetIdentity:{canonicalSourceManifestSha256:MANIFEST_SHA,logicalLocalDatabaseId:'P2-TRUST-LOCAL-PERF-DB-2026-10-03-V1',storage:'fresh local file-backed SQLite'},procedure:['Verify the frozen P2-TRUST-SEED-V1 SHA-256 and exact baseline source manifest.','Create a fresh local SQLite database, apply baseline migrations, and seed the same portfolio plus the first three fixed trade events using app data-layer functions.','Save a quiescent local SQLite snapshot. For each measurement, copy/open a separate fresh DB from the identical pre-update state outside the timer.','Time a single manual-price full-sale update via researchPOST followed by researchGET/summary reload; include handler work and response JSON parsing, exclude fixture setup and copy/open.','Record one first-call sample before warm-up, three separately disclosed unmeasured warm-ups, and thirty warm measured samples. Verify the same baseline hashes and expected final ledger/balances for every sample.'],expected:result.workload,actual:result.measurements,result:result.result,limitations:result.limitations,artifactPathOrLink:'artifacts/p2-08-portfolio-update-raw-results.json',sha256:null,reviewer:null,reviewedAt:null};
await writeFile(rawPath,JSON.stringify(result,null,2)+'\n','utf8');
await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n','utf8');
console.log(JSON.stringify({result:result.result,evidence:evidencePath,rawResults:rawPath,cold:result.measurements.coldSummary,warm:result.measurements.warmSummary,failure:result.failure||null},null,2));
if(result.result!=='MEASURED_NO_THRESHOLD')process.exitCode=1;

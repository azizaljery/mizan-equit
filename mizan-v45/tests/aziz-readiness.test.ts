import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildReadiness,d1DataReader,assessData,DATA_SUMMARY_SQL,MIN_SESSIONS,type DataSummary} from '../lib/aziz/readiness';
import {AZIZ_MODE,AZIZ_MODEL_REGISTRY,checkModelUsable,latestModel,type AzizModelEntry,type UsabilityQuery} from '../lib/aziz/model-registry';

const NOW=new Date('2026-10-21T12:00:00Z');
const company={symbol:'2222.SR',name:'أرامكو'};
const summary=(o:Partial<DataSummary>={}):DataSummary=>({bars:1200,firstSession:'2021-10-20',lastSession:'2026-10-20',pointInTimeBars:0,lastRetrievedAt:'2026-10-20T18:00:00Z',...o});

/** Fake D1 that records every statement; any non-SELECT fails the test. */
function fakeDB(row:any){const seen:string[]=[];return {seen,DB:{prepare(sql:string){seen.push(sql);if(!/^\s*SELECT\s/i.test(sql))throw Error('write attempted: '+sql);return {bind:(..._v:unknown[])=>({first:async()=>row})};}}};}

test('readiness is read-only: one SELECT, no network, repeated calls identical',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('unexpected network request')};
 try{const f=fakeDB(summary());const a=await buildReadiness({market:'sa',company,restriction:null,reader:d1DataReader(f.DB),now:NOW});const b=await buildReadiness({market:'sa',company,restriction:null,reader:d1DataReader(f.DB),now:NOW});
  assert.deepEqual(a,b);assert.equal(f.seen.length,2);assert.ok(f.seen.every(s=>s===DATA_SUMMARY_SQL));
  assert.equal(a.recorded,false);assert.equal(a.forecast,null);}finally{globalThis.fetch=old;}
});

for(const market of ['sa','us'] as const)test(`full contract for ${market}: rejected model shown, never production`,async()=>{
 const r=await buildReadiness({market,company:market==='sa'?company:{symbol:'AAPL',name:'Apple'},restriction:null,reader:async()=>summary(),now:NOW});
 assert.equal(r.schemaVersion,2);assert.equal(r.status,'model_rejected');assert.equal(r.mode,'OFF');
 assert.equal(r.productionUseApproved,false);assert.equal(r.researchForecastAvailable,false);
 assert.deepEqual(r.readiness,{dataReady:false,modelReady:false,calibrationReady:false,monitorReady:false});
 assert.equal(r.dataEligibility,'exploratory_only');
 assert.ok(r.abstentionReasons.some(x=>x.code==='model_rejected'));assert.ok(r.abstentionReasons.some(x=>x.code==='availability_not_point_in_time'));
 assert.deepEqual(r.horizons.map(h=>[h.horizonSessions,h.issueType,h.status]),[[5,'direct','model_rejected'],[21,'direct','model_rejected'],[21,'bridge_5_to_21','model_missing']]);
 assert.ok(!('probabilityUp' in r)&&!('canForecast' in r));
});

test('data states: not imported, short history, stale, point-in-time, reader failure, no binding',async()=>{
 assert.equal(assessData(summary({bars:0}),NOW).eligibility,'not_imported');
 assert.equal(assessData(summary({bars:MIN_SESSIONS-1}),NOW).reasons[0].code,'insufficient_history');
 assert.equal(assessData(summary({lastSession:'2026-09-01'}),NOW).reasons[0].code,'data_stale');
 const pit=assessData(summary({pointInTimeBars:1200}),NOW);assert.equal(pit.eligibility,'eligible');assert.equal(pit.ready,true);
 const err=await buildReadiness({market:'sa',company,restriction:null,reader:async()=>{throw Error('no table')},now:NOW});
 assert.equal(err.status,'error');assert.equal(err.componentStatus.data,'error');assert.equal(err.data,null);
 const none=await buildReadiness({market:'sa',company,restriction:null,reader:null,now:NOW});assert.equal(none.dataEligibility,'unavailable');
 const restricted=await buildReadiness({market:'sa',company,restriction:{reason:'موقوف'},reader:async()=>summary(),now:NOW});assert.equal(restricted.abstentionReasons[0].code,'listing_restricted');
});

test('even eligible data never makes a forecast while the only model is rejected and mode is OFF',async()=>{
 const r=await buildReadiness({market:'sa',company,restriction:null,reader:async()=>summary({pointInTimeBars:1200}),now:NOW});
 assert.equal(r.readiness.dataReady,true);assert.equal(r.readiness.modelReady,false);assert.equal(r.forecast,null);assert.equal(r.productionUseApproved,false);
});

test('model gate rejects rejected, other market/horizon, future artifact, expired, unapproved production',()=>{
 assert.equal(AZIZ_MODE,'OFF');
 assert.ok(AZIZ_MODEL_REGISTRY.every(e=>e.status!=='active_approved'));
 const rej=latestModel('sa',5,'direct');assert.equal(checkModelUsable(rej,{market:'sa',horizonSessions:5,issueType:'direct',purpose:'research',asOf:'2026-10-21'}).usable,false);
 const ok:AzizModelEntry={...rej!,status:'shadow_approved',artifactId:'a1',artifactHash:'h',trainedThrough:'2026-06-30',validFrom:'2026-07-01',expiresAt:'2027-01-01',modelVersion:'t'};
 const q:UsabilityQuery={market:'sa',horizonSessions:5,issueType:'direct',purpose:'research',asOf:'2026-10-21'};
 assert.equal(checkModelUsable(ok,q).usable,true);
 const code=(e:AzizModelEntry,qq:UsabilityQuery=q)=>{const c=checkModelUsable(e,qq);return c.usable?'ok':c.code;};
 assert.equal(code(ok,{...q,market:'us'}),'model_identity_mismatch');
 assert.equal(code(ok,{...q,horizonSessions:21}),'model_identity_mismatch');
 assert.equal(code(ok,{...q,issueType:'bridge_5_to_21'}),'model_identity_mismatch');
 assert.equal(code({...ok,trainedThrough:'2026-11-01'}),'artifact_from_future');
 assert.equal(code({...ok,expiresAt:'2026-10-01'}),'artifact_expired');
 assert.equal(code({...ok,artifactHash:null}),'artifact_missing');
 assert.equal(code(ok,{...q,featureSchemaVersion:'other'}),'feature_schema_mismatch');
 assert.equal(code(ok,{...q,purpose:'production'}),'production_not_approved');
 assert.equal(code({...ok,status:'active_approved',approvedBy:'owner',approvedAt:'2026-10-21'},{...q,purpose:'production'}),'mode_not_active');
 assert.equal(code({...ok,status:'suspended'}),'model_suspended');
 assert.equal(checkModelUsable(null,q).usable,false);
});

test('route and panel wiring: GET only, no forecast persistence, panel accepts the new contract',()=>{
 const panel=readFileSync('app/aziz/request-panel.tsx','utf8'),route=readFileSync('app/api/aziz/readiness/route.ts','utf8'),lib=readFileSync('lib/aziz/readiness.ts','utf8');
 assert.ok(panel.includes('/api/aziz/readiness?'));assert.ok(panel.includes('فحص جاهزية عزيز'));
 assert.doesNotMatch(panel,/\/api\/company\/analyze|method:\s*['"]POST/);
 assert.doesNotMatch(panel,/canForecast!==false/);
 assert.doesNotMatch(route,/export async function (POST|PUT|PATCH|DELETE)|recordAnalysis|fetchCompany|forecast-journal|\.batch\(|\.run\(/);
 assert.doesNotMatch(lib,/\.run\(|\.batch\(|\.exec\(/);assert.match(DATA_SUMMARY_SQL,/^SELECT /);assert.doesNotMatch(DATA_SUMMARY_SQL,/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i);
});

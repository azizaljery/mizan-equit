import test from 'node:test';import assert from 'node:assert/strict';
import {executeFollowupStep,FOLLOWUP_STEP_VERSION} from '../lib/screener-followup-step-core.ts';

const config={enabled:false,intervalHours:24,scanPerMarket:20,resultCount:5,horizonSessions:5};
function fixture(options={}){
 let clock=Date.parse('2026-09-26T00:00:00Z'),saves=[],created=[],batches=[],finishes=[];
 const deps={
  now:()=>clock,
  create:async input=>{created.push(input.market);return {runId:'run-'+input.market,symbols:Array.from({length:input.scanLimit},(_,i)=>input.market+i),batchSize:2};},
  batch:async(id,index)=>{batches.push([id,index]);clock+=100;if(options.failOnce&&index===1&&!options.didFail){options.didFail=true;throw Error('transient');}return {scanned:2,analyzed:2,failed:0,eligible:0};},
  finish:async id=>{finishes.push(id);return {status:'complete',integrity:true,picks:[],fingerprint:'fp-'+id};},
  save:async p=>saves.push(JSON.parse(JSON.stringify(p))),
 };
 return {deps,saves,created,batches,finishes};
}
test('new step creates two server cohorts and processes only bounded work',async()=>{
 const f=fixture(),r=await executeFollowupStep(config,null,f.deps,2);
 assert.equal(r.version,FOLLOWUP_STEP_VERSION);assert.equal(r.status,'running');
 assert.deepEqual(f.created,['sa','us']);assert.equal(f.batches.length,2);
 assert.deepEqual(f.batches,[['run-sa',0],['run-us',0]]);assert.equal(r.markets.sa.scanned,2);assert.equal(r.markets.us.scanned,2);
 assert.equal(JSON.stringify(r).includes('token'),false);
});
test('a later invocation resumes exact next batch without recreating cohorts',async()=>{
 const f=fixture(),a=await executeFollowupStep(config,null,f.deps,2),b=await executeFollowupStep(config,a,f.deps,2);
 assert.deepEqual(f.created,['sa','us']);assert.deepEqual(f.batches,[['run-sa',0],['run-us',0],['run-sa',1],['run-us',1]]);
 assert.equal(b.markets.sa.scanned,4);assert.equal(b.markets.us.scanned,4);
});
test('enough bounded steps seal complete 20+20 cohorts',async()=>{
 const f=fixture();let p=null;for(let i=0;i<10;i++)p=await executeFollowupStep(config,p,f.deps,2);
 assert.equal(p.status,'completed');for(const m of ['sa','us']){assert.equal(p.markets[m].scanned,20);assert.equal(p.markets[m].state,'complete');assert.equal(p.markets[m].fingerprint,'fp-run-'+m);}
 assert.deepEqual(f.finishes.sort(),['run-sa','run-us']);
});
test('technical failure is retryable and does not advance the failed batch',async()=>{
 const opts={failOnce:true,didFail:false},f=fixture(opts),a=await executeFollowupStep(config,null,f.deps,3);
 assert.equal(a.status,'partial');assert.equal(a.markets.sa.state,'retryable');assert.equal(a.markets.sa.nextBatch,1);
 const b=await executeFollowupStep(config,a,f.deps,1);assert.equal(b.markets.us.nextBatch,2);
 const c=await executeFollowupStep(config,b,f.deps,1);assert.equal(c.markets.sa.nextBatch,2);assert.equal(c.markets.sa.state,'scanning');
});
test('source-level failed analyses remain counted but do not corrupt progression',async()=>{
 const f=fixture();f.deps.batch=async(id,index)=>{f.batches.push([id,index]);return {scanned:2,analyzed:1,failed:1,eligible:0};};
 const r=await executeFollowupStep(config,null,f.deps,1);
 assert.equal(r.status,'running');assert.equal(r.markets.sa.failed,1);assert.equal(r.markets.sa.analyzed,1);
});
test('counter inconsistencies fail closed and preserve the batch index',async()=>{
 const f=fixture();f.deps.batch=async()=>({scanned:2,analyzed:2,failed:1,eligible:0});
 const r=await executeFollowupStep(config,null,f.deps,1);
 assert.equal(r.status,'partial');assert.equal(r.markets.sa.nextBatch,0);assert.equal(r.markets.us.nextBatch,0);
});
test('completed state is idempotent and performs no new work',async()=>{
 const f=fixture();let p=null;for(let i=0;i<10;i++)p=await executeFollowupStep(config,p,f.deps,2);const before=f.batches.length;
 const again=await executeFollowupStep(config,p,f.deps,2);assert.equal(again.status,'completed');assert.equal(f.batches.length,before);
});
test('configuration changes cannot silently resume an old cohort',async()=>{
 const f=fixture(),p=await executeFollowupStep(config,null,f.deps,1);
 await assert.rejects(()=>executeFollowupStep({...config,horizonSessions:21},p,f.deps,1),/followup-state-mismatch/);
});
test('a failed final seal resumes the same cohort without reissuing any batch',async()=>{
 const f=fixture();let failSeal=true;
 const finish=f.deps.finish;
 f.deps.finish=async id=>{
  if(id==='run-sa'&&failSeal){failSeal=false;f.finishes.push(id);throw Error('transient-seal-read');}
  return finish(id);
 };
 let p=null;for(let i=0;i<10;i++)p=await executeFollowupStep(config,p,f.deps,2);
 assert.equal(p.status,'partial');assert.equal(p.markets.sa.state,'retryable');
 assert.equal(p.markets.sa.nextBatch,10);assert.equal(p.markets.sa.scanned,20);
 assert.equal(p.markets.us.state,'complete');
 const originalBatches=structuredClone(f.batches),originalCreated=structuredClone(f.created);
 const resumed=await executeFollowupStep(config,p,f.deps,1);
 assert.equal(resumed.status,'completed');assert.equal(resumed.markets.sa.state,'complete');
 assert.equal(resumed.markets.sa.runId,'run-sa');assert.equal(resumed.markets.sa.fingerprint,'fp-run-sa');
 assert.equal(resumed.markets.sa.scanned,20);assert.equal(resumed.markets.sa.analyzed,20);
 assert.deepEqual(f.batches,originalBatches);assert.deepEqual(f.created,originalCreated);
 assert.deepEqual(f.finishes,['run-sa','run-us','run-sa']);
 const again=await executeFollowupStep(config,resumed,f.deps,1);
 assert.equal(again.status,'completed');assert.equal(f.finishes.length,3);
});

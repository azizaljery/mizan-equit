import test from 'node:test';
import assert from 'node:assert/strict';
import {runAzizHybridReplay} from '../src/aziz-algorithm.mjs';
import {makeFixture,SMALL_POLICY} from './support/hybrid-fixture.mjs';

test('four layers run for SA and US, independently for full 5 and 21 sessions',()=>{
 for(const market of ['SA','US'])for(const horizon of [5,21]){
  const data=makeFixture(180,market);
  const result=runAzizHybridReplay(data,{horizon,evaluationAsOf:data.bars.at(-1).availableAt,options:SMALL_POLICY});
  assert.ok(result.evaluated.length>10);assert.ok(result.metrics.intervalCount>0);
  assert.equal(result.canActivate,false);assert.equal(result.promotion.approved,false);
  assert.equal(result.comparator,'historical_mean_return_not_live_mizan');
  for(const r of result.evaluated){
   assert.equal(r.targetAt,data.bars[r.index+horizon].observedAt);
   assert.equal(r.actualLogReturn,Math.log(data.bars[r.index+horizon].close/r.price));
   assert.ok(Date.parse(r.audit.lastTrainingOutcomeAvailableAt)<Date.parse(r.audit.trainCutoff));
   assert.equal(r.audit.embargoSessions,Math.ceil(.02*SMALL_POLICY.trainWindow));
   assert.ok(r.audit.lastTrainingTargetSessionIndex<r.index-r.audit.embargoSessions);
   assert.ok(r.audit.stackCount>=SMALL_POLICY.minStack);
   assert.equal(r.scale,Math.sqrt(r.varianceProxy));
  }
 }
});

test('unavailable middle bridge sessions are not collapsed into daily returns',()=>{
 const data=makeFixture(180),asOf=data.bars[130].availableAt;
 data.bridgeSeries[0].bars[120].availableAt=data.bars[160].availableAt;
 const result=runAzizHybridReplay(data,{horizon:5,evaluationAsOf:asOf,options:SMALL_POLICY});
 // At 121 the latest published contiguous prefix still ends at 119; 122 exposes the gap.
 assert.ok(result.issued.every(r=>r.index<=121));
 assert.equal(result.skipped.at(-1).reason,'insufficient_or_stale_features');
});

test('delayed archive ingestion cannot issue a forecast whose target already elapsed',()=>{
 const data=makeFixture(180);
 for(let i=0;i<data.bars.length;i++)data.bars[i].availableAt=new Date(Date.parse(data.bars[i].availableAt)+6*86400000).toISOString();
 const result=runAzizHybridReplay(data,{horizon:5,evaluationAsOf:data.bars[130].availableAt,options:SMALL_POLICY});
 assert.equal(result.issued.length,0);
 assert.ok(result.skipped.some(r=>r.reason==='stale_observation_at_issue'));
});

test('appending the future tail cannot retract a late historical issue',()=>{
 const data=makeFixture(180);
 for(const b of data.bars.slice(130))b.availableAt=new Date(Date.parse(b.availableAt)+10*86400000).toISOString();
 const short={...data,bars:data.bars.slice(0,131)};
 const args={horizon:5,evaluationAsOf:data.bars[130].availableAt,options:SMALL_POLICY};
 const a=runAzizHybridReplay(short,args),b=runAzizHybridReplay(data,args);
 assert.deepEqual(a.issued,b.issued);
 assert.ok(!a.issued.some(r=>r.index===130));
});

test('future values and future panel additions cannot change an issued forecast',()=>{
 const data=makeFixture(180),asOf=data.bars[130].availableAt;
 const a=runAzizHybridReplay(data,{horizon:5,evaluationAsOf:asOf,options:SMALL_POLICY});
 const changed=structuredClone(data);
 for(const b of changed.bars.slice(131)){b.close=999999;b.volume=1e12;}
 for(const s of changed.bridgeSeries)for(const b of s.bars)
  if(Date.parse(b.availableAt)>Date.parse(asOf)){b.close=999999;}
 const b=runAzizHybridReplay(changed,{horizon:5,evaluationAsOf:asOf,options:SMALL_POLICY});
 assert.deepEqual(a,b);
 const later=runAzizHybridReplay(changed,{horizon:5,evaluationAsOf:changed.bars[140].availableAt,options:SMALL_POLICY});
 assert.deepEqual(a.issued,later.issued.filter(r=>Date.parse(r.asOf)<=Date.parse(asOf)));
});

test('training, stacking and calibration honor maturity instead of row count',()=>{
 const data=makeFixture(180),asOf=data.bars[125].availableAt;
 const r=runAzizHybridReplay(data,{horizon:21,evaluationAsOf:asOf,options:SMALL_POLICY});
 assert.ok(r.pending>0);
 for(const p of r.issued){
  const count=r.issued.filter(x=>x.index+21<data.bars.length&&Date.parse(data.bars[x.index+21].availableAt)<Date.parse(p.asOf)).length;
  assert.equal(p.calibration.count,Math.min(count,SMALL_POLICY.calibrationWindow));
  const known=data.bridgeSeries[0].bars.filter(b=>Date.parse(b.availableAt)<=Date.parse(p.asOf));
  assert.equal(p.audit.bridgeProvenance[0].availableAt,known.at(-1).availableAt);
 }
});

test('rejects unknown PIT provenance and session gaps; stale bridge abstains',()=>{
 const data=makeFixture(180),args={horizon:5,evaluationAsOf:data.bars.at(-1).availableAt,options:SMALL_POLICY};
 assert.throws(()=>runAzizHybridReplay({...data,provenance:{...data.provenance,pointInTime:false}},args));
 const gap=structuredClone(data);gap.bars[50].sessionIndex=51;
 assert.throws(()=>runAzizHybridReplay(gap,args));
 const stale=structuredClone(data);stale.bridgeSeries[0].bars=stale.bridgeSeries[0].bars.slice(0,30);
 const r=runAzizHybridReplay(stale,args);assert.equal(r.issued.length,0);
 assert.throws(()=>runAzizHybridReplay(data,{...args,horizon:16}));
});

test('version separates configuration, horizon, market, and price basis',()=>{
 const data=makeFixture(180),args={horizon:5,evaluationAsOf:data.bars.at(-1).availableAt,options:SMALL_POLICY};
 const a=runAzizHybridReplay(data,args);
 const b=runAzizHybridReplay(data,{...args,horizon:21});
 const c=runAzizHybridReplay(data,{...args,options:{...SMALL_POLICY,lambda:2}});
 assert.notEqual(a.modelVersion,b.modelVersion);assert.notEqual(a.modelVersion,c.modelVersion);
 assert.deepEqual(data,makeFixture(180));
});
